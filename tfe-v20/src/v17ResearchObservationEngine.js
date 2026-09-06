import {
  createLiveRecommendationLifecycle,
  advanceLiveRecommendationLifecycle,
  summarizeLiveRecommendation,
} from './liveRecommendationLifecycle.js';
import { V17_RESEARCH_GOVERNANCE, assessV17ResearchReadiness } from './v17ResearchGovernance.js';

const ACTIVE = new Set(['ENTERED', 'HOLD', 'PROTECT_PROFIT']);
const finite = (v) => Number.isFinite(Number(v));

function priorityIndex(category) {
  const idx = V17_RESEARCH_GOVERNANCE.priorityOrder.indexOf(String(category || ''));
  return idx < 0 ? 999 : idx;
}

function normalizeSignal(signal = {}, signalDate = null) {
  const ticker = String(signal.ticker || '').trim().toUpperCase();
  const entryLow = Number(signal.entryLow);
  const entryHigh = Number(signal.entryHigh);
  const stopLoss = Number(signal.stopLoss ?? signal.stop);
  const target1 = Number(signal.target1);
  if (!ticker || !(entryLow > 0) || !(entryHigh >= entryLow) || !(stopLoss > 0) || !(target1 > entryHigh)) {
    throw new Error('V17_INVALID_FROZEN_SIGNAL');
  }
  return Object.freeze({
    ticker,
    rank: finite(signal.rank) ? Number(signal.rank) : 999,
    category: signal.category ?? null,
    score: finite(signal.score) ? Number(signal.score) : null,
    entryLow,
    entryHigh,
    stopLoss,
    target1,
    signalDate,
    currentSessionEligible: signal.currentSessionEligible !== false,
    referenceOnly: signal.referenceOnly === true,
    metaShadow: signal.metaShadow ?? null,
  });
}

export function createV17ResearchObservationState({ snapshot, createdAt } = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('V17_SNAPSHOT_REQUIRED');
  const readiness = assessV17ResearchReadiness(snapshot);
  const created = createdAt || snapshot.capturedAt;
  if (!Number.isFinite(Date.parse(String(created || '')))) throw new Error('V17_CREATED_AT_INVALID');

  const signals = (snapshot.v16Signals || [])
    .map((x) => normalizeSignal(x, snapshot.signalSessionDate))
    .filter((x) => x.currentSessionEligible && !x.referenceOnly)
    .sort((a, b) => priorityIndex(a.category) - priorityIndex(b.category) || a.rank - b.rank || a.ticker.localeCompare(b.ticker));

  const lifecycles = Object.fromEntries(signals.map((signal) => [signal.ticker, createLiveRecommendationLifecycle({
    recommendation: signal,
    createdAt: created,
  })]));

  return Object.freeze({
    schemaVersion: 'egx.v17-research-observation-state.1',
    governance: V17_RESEARCH_GOVERNANCE,
    snapshotHash: snapshot.snapshotHash ?? null,
    sourceBundleHash: snapshot.sourceBundleHash ?? null,
    signalSessionDate: snapshot.signalSessionDate,
    nextTradingSessionDate: snapshot?.marketCalendar?.nextTradingSessionDate ?? null,
    createdAt: new Date(Date.parse(created)).toISOString(),
    readiness,
    signals: Object.freeze(signals),
    lifecycles: Object.freeze(lifecycles),
    observationsProcessed: 0,
    lastObservedAt: null,
    researchDecisions: Object.freeze([]),
    productionAuthority: false,
    scoringImpact: 'NONE',
    alphaWeight: 0,
  });
}

function normalizeObservations(observations) {
  const list = Array.isArray(observations) ? observations : Object.values(observations || {});
  const out = new Map();
  for (const observation of list) {
    const ticker = String(observation?.ticker || '').trim().toUpperCase();
    if (ticker) out.set(ticker, observation);
  }
  return out;
}

function researchDecision({ signal, previous, candidate, observation, acceptedForStudy }) {
  if (!acceptedForStudy) {
    return Object.freeze({
      ticker: signal.ticker,
      rank: signal.rank,
      category: signal.category,
      label: 'OBSERVE_PORTFOLIO_CAP',
      reason: 'MAX_TWO_CONCURRENT_OBSERVED_POSITIONS',
      observedAt: observation.observedAt,
      sessionDate: observation.sessionDate,
      productionAuthority: false,
    });
  }

  const summary = summarizeLiveRecommendation(candidate);
  let label = 'OBSERVE_WAIT';
  let reason = summary.reason;

  if (candidate.status === 'VETOED') label = 'OBSERVE_GAP_VETO';
  else if (!previous.entryPrice && candidate.entryPrice) label = 'OBSERVE_ENTRY_ELIGIBLE';
  else if (candidate.status === 'NO_ENTRY') label = 'OBSERVE_NO_ENTRY';
  else if (['TARGET', 'STOP', 'EXIT_PROTECT', 'TIME_EXIT'].includes(candidate.status)) label = `OBSERVE_${candidate.status}`;
  else if (ACTIVE.has(candidate.status)) label = 'OBSERVE_POSITION_ACTIVE';
  else if (!candidate.entryPrice && candidate.action === 'WAIT_ENTRY' && Number(observation.open) > signal.entryHigh && Number(observation.low) > signal.entryHigh) {
    label = 'OBSERVE_NO_CHASE';
    reason = 'OPEN_ABOVE_ENTRY_ZONE_WITHOUT_RETRACE';
  }

  return Object.freeze({
    ticker: signal.ticker,
    rank: signal.rank,
    category: signal.category,
    label,
    lifecycleStatus: summary.status,
    reason,
    observedAt: observation.observedAt,
    sessionDate: observation.sessionDate,
    simulatedEntryPrice: summary.entryPrice,
    frozenStop: signal.stopLoss,
    frozenTarget1: signal.target1,
    sessionsObserved: summary.sessionsObserved,
    productionAuthority: false,
  });
}

export function observeV17ResearchBatch({ state, observations } = {}) {
  if (!state || state.schemaVersion !== 'egx.v17-research-observation-state.1') throw new Error('V17_STATE_INVALID');
  if (!state.readiness?.ready) {
    return Object.freeze({
      ...state,
      researchDecisions: Object.freeze(state.signals.map((signal) => Object.freeze({
        ticker: signal.ticker,
        rank: signal.rank,
        category: signal.category,
        label: 'OBSERVE_DATA_BLOCKED',
        reason: state.readiness.blockers.join('|') || 'DATA_READINESS_BLOCKED',
        productionAuthority: false,
      }))),
      productionAuthority: false,
    });
  }

  const obsMap = normalizeObservations(observations);
  const startingActive = Object.values(state.lifecycles).filter((x) => ACTIVE.has(x.status)).length;
  let newlyAccepted = 0;
  let lastObservedAt = state.lastObservedAt;
  const nextLifecycles = { ...state.lifecycles };
  const researchDecisions = [];

  for (const signal of state.signals) {
    const previous = state.lifecycles[signal.ticker];
    const observation = obsMap.get(signal.ticker);
    if (!observation) {
      researchDecisions.push(Object.freeze({
        ticker: signal.ticker,
        rank: signal.rank,
        category: signal.category,
        label: 'OBSERVE_WAIT_DATA',
        reason: 'NO_OBSERVATION_FOR_TICKER',
        productionAuthority: false,
      }));
      continue;
    }

    if (lastObservedAt && Date.parse(observation.observedAt) < Date.parse(lastObservedAt)) throw new Error('V17_NON_MONOTONIC_BATCH');
    lastObservedAt = observation.observedAt;

    const candidate = advanceLiveRecommendationLifecycle({ lifecycle: previous, observation });
    const createsObservedPosition = !previous.entryPrice && Boolean(candidate.entryPrice);
    const hasStudySlot = startingActive + newlyAccepted < V17_RESEARCH_GOVERNANCE.maxConcurrentObservedPositions;
    const acceptedForStudy = !createsObservedPosition || hasStudySlot;

    if (createsObservedPosition && acceptedForStudy) newlyAccepted += 1;
    if (acceptedForStudy) nextLifecycles[signal.ticker] = candidate;

    researchDecisions.push(researchDecision({ signal, previous, candidate, observation, acceptedForStudy }));
  }

  return Object.freeze({
    ...state,
    lifecycles: Object.freeze(nextLifecycles),
    observationsProcessed: Number(state.observationsProcessed || 0) + 1,
    lastObservedAt,
    researchDecisions: Object.freeze(researchDecisions),
    productionAuthority: false,
    scoringImpact: 'NONE',
    alphaWeight: 0,
  });
}

export function summarizeV17ResearchObservationState(state) {
  if (!state || state.schemaVersion !== 'egx.v17-research-observation-state.1') throw new Error('V17_STATE_INVALID');
  return Object.freeze({
    schemaVersion: state.schemaVersion,
    championCore: V17_RESEARCH_GOVERNANCE.championCore,
    snapshotHash: state.snapshotHash,
    signalSessionDate: state.signalSessionDate,
    nextTradingSessionDate: state.nextTradingSessionDate,
    readiness: state.readiness,
    maxConcurrentObservedPositions: V17_RESEARCH_GOVERNANCE.maxConcurrentObservedPositions,
    researchDecisions: state.researchDecisions,
    lifecycle: Object.values(state.lifecycles).map(summarizeLiveRecommendation),
    researchOnly: true,
    productionAuthority: false,
    automaticOrders: false,
    scoringImpact: 'NONE',
    alphaWeight: 0,
  });
}
