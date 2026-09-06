import { assessNextOpenRecoveryTrap } from './downsideFragilityExpert.js';

export const RISKALPHA_LIVE_POLICY = Object.freeze({
  schemaVersion: 'egx.riskalpha-live-lifecycle.1',
  researchOnly: true,
  originalRecommendationImmutable: true,
  entryRule: 'NEXT_SESSION_ONLY',
  entryFillRule: 'ENTRY_ZONE_TOUCH_NO_GAP_DOWN_FILL',
  sameBarTargetStop: 'STOP_FIRST',
  maxHoldSessions: 3,
  protectionTriggerR: 1.0,
  protectionStopRule: 'BREAKEVEN_FROM_NEXT_OBSERVATION_ONLY',
  outcomeRetuningAllowed: false,
  scoringImpact: 'NONE',
  alphaWeight: 0,
  productionAuthority: false,
});

const TERMINAL = new Set(['VETOED', 'NO_ENTRY', 'TARGET', 'STOP', 'EXIT_PROTECT', 'TIME_EXIT', 'EXPIRED']);
const round = (v, d = 4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const finite = (v) => Number.isFinite(Number(v));

function validIso(value) {
  return Number.isFinite(Date.parse(String(value || '')));
}

function geometry(input = {}) {
  const ticker = String(input.ticker || '').trim().toUpperCase();
  const entryLow = Number(input.entryLow);
  const entryHigh = Number(input.entryHigh);
  const stopLoss = Number(input.stopLoss ?? input.stop);
  const target1 = Number(input.target1);
  if (!ticker || !(entryLow > 0) || !(entryHigh >= entryLow) || !(stopLoss > 0) || !(target1 > entryHigh)) {
    throw new Error('INVALID_FROZEN_RECOMMENDATION_GEOMETRY');
  }
  return Object.freeze({
    ticker,
    category: input.category ?? null,
    score: finite(input.score) ? Number(input.score) : null,
    signalDate: input.signalDate ?? input.sessionDate ?? null,
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    stopLoss: round(stopLoss),
    target1: round(target1),
  });
}

function normalizeObservation(input = {}) {
  const observedAt = String(input.observedAt || '');
  const sessionDate = String(input.sessionDate || input.date || '').slice(0, 10);
  const open = Number(input.open);
  const high = Number(input.high);
  const low = Number(input.low);
  const last = Number(input.last ?? input.close);
  const sessionClosed = input.sessionClosed === true;
  if (!validIso(observedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new Error('INVALID_OBSERVATION_TIME');
  if (![open, high, low, last].every((v) => Number.isFinite(v) && v > 0)) throw new Error('INVALID_OBSERVATION_PRICES');
  if (high < low || high < open || high < last || low > open || low > last) throw new Error('INCONSISTENT_OBSERVATION_BAR');
  return Object.freeze({ observedAt, sessionDate, open, high, low, last, sessionClosed });
}

function event(type, obs, extra = {}) {
  return Object.freeze({ type, observedAt: obs.observedAt, sessionDate: obs.sessionDate, ...extra });
}

function fillPrice(obs, rec) {
  if (obs.open >= rec.entryLow && obs.open <= rec.entryHigh) return obs.open;
  if (obs.open > rec.entryHigh && obs.low <= rec.entryHigh) return rec.entryHigh;
  if (obs.open < rec.entryLow) return null;
  if (obs.low <= rec.entryHigh && obs.high >= rec.entryLow) return rec.entryHigh;
  return null;
}

function baseState(rec, createdAt) {
  return Object.freeze({
    schemaVersion: RISKALPHA_LIVE_POLICY.schemaVersion,
    policy: RISKALPHA_LIVE_POLICY,
    original: rec,
    createdAt,
    status: 'WAIT',
    action: 'WAIT',
    reason: 'AWAITING_NEXT_SESSION_OBSERVATION',
    entryPrice: null,
    entryDate: null,
    managedStop: rec.stopLoss,
    protectionArmedAt: null,
    protectionActiveFromObservation: null,
    sessionsObserved: 0,
    lastObservedAt: null,
    lastSessionDate: null,
    events: Object.freeze([]),
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
  });
}

export function createLiveRecommendationLifecycle({ recommendation, createdAt } = {}) {
  if (!validIso(createdAt)) throw new Error('INVALID_LIFECYCLE_CREATED_AT');
  return baseState(geometry(recommendation), new Date(Date.parse(createdAt)).toISOString());
}

function withEvent(state, patch, evt) {
  return Object.freeze({
    ...state,
    ...patch,
    events: Object.freeze([...(state.events || []), evt]),
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
  });
}

export function advanceLiveRecommendationLifecycle({ lifecycle, observation } = {}) {
  if (!lifecycle || lifecycle.schemaVersion !== RISKALPHA_LIVE_POLICY.schemaVersion) throw new Error('INVALID_LIFECYCLE');
  const obs = normalizeObservation(observation);
  const rec = lifecycle.original;
  const prevMs = lifecycle.lastObservedAt ? Date.parse(lifecycle.lastObservedAt) : null;
  const nowMs = Date.parse(obs.observedAt);
  if (Number.isFinite(prevMs) && nowMs <= prevMs) throw new Error('NON_MONOTONIC_OBSERVATION');
  if (TERMINAL.has(lifecycle.status)) {
    return Object.freeze({ ...lifecycle, lastObservedAt: obs.observedAt, lastSessionDate: obs.sessionDate });
  }

  const isNewSession = lifecycle.lastSessionDate !== obs.sessionDate;
  const sessionsObserved = lifecycle.sessionsObserved + (isNewSession ? 1 : 0);

  if (!lifecycle.entryPrice) {
    if (sessionsObserved > 1) {
      return withEvent(lifecycle, {
        status: 'NO_ENTRY', action: 'EXPIRED', reason: 'NEXT_SESSION_ONLY_WINDOW_CLOSED',
        lastObservedAt: obs.observedAt, lastSessionDate: obs.sessionDate, sessionsObserved,
      }, event('NO_ENTRY', obs, { reason: 'NEXT_SESSION_ONLY_WINDOW_CLOSED' }));
    }

    const guard = assessNextOpenRecoveryTrap({ frozenEntryLow: rec.entryLow, nextOpen: obs.open });
    if (guard.decision === 'VETO_GAP_DOWN_RECOVERY_ENTRY') {
      return withEvent(lifecycle, {
        status: 'VETOED', action: 'VETO', reason: guard.reason,
        lastObservedAt: obs.observedAt, lastSessionDate: obs.sessionDate, sessionsObserved,
      }, event('VETO', obs, { reason: guard.reason, nextOpen: round(obs.open), entryLow: rec.entryLow }));
    }

    const fill = fillPrice(obs, rec);
    if (fill == null) {
      return withEvent(lifecycle, {
        status: 'ALLOW', action: 'WAIT_ENTRY', reason: 'VALID_NEXT_OPEN_BUT_ENTRY_ZONE_NOT_TOUCHED_YET',
        lastObservedAt: obs.observedAt, lastSessionDate: obs.sessionDate, sessionsObserved,
      }, event('ALLOW', obs, { reason: 'ENTRY_WINDOW_OPEN' }));
    }

    const stopHit = obs.low <= rec.stopLoss;
    const targetHit = obs.high >= rec.target1;
    if (stopHit || targetHit) {
      const status = stopHit ? 'STOP' : 'TARGET';
      const exitPrice = stopHit ? rec.stopLoss : rec.target1;
      return withEvent(lifecycle, {
        status, action: status, reason: stopHit && targetHit ? 'STOP_FIRST_SAME_OBSERVATION' : `${status}_HIT_ON_ENTRY_OBSERVATION`,
        entryPrice: round(fill), entryDate: obs.sessionDate, managedStop: rec.stopLoss,
        lastObservedAt: obs.observedAt, lastSessionDate: obs.sessionDate, sessionsObserved,
      }, event(status, obs, { entryPrice: round(fill), exitPrice, stopFirstApplied: stopHit && targetHit }));
    }

    const r = fill - rec.stopLoss;
    const hitProtection = r > 0 && obs.high >= fill + r;
    return withEvent(lifecycle, {
      status: hitProtection ? 'PROTECT_PROFIT' : 'ENTERED',
      action: hitProtection ? 'PROTECT_PROFIT' : 'HOLD',
      reason: hitProtection ? 'ONE_R_REACHED_PROTECTION_ARMED_NEXT_OBSERVATION' : 'ENTRY_FILLED_WITHIN_FROZEN_ZONE',
      entryPrice: round(fill), entryDate: obs.sessionDate, managedStop: rec.stopLoss,
      protectionArmedAt: hitProtection ? obs.observedAt : null,
      protectionActiveFromObservation: hitProtection ? 'NEXT_OBSERVATION' : null,
      lastObservedAt: obs.observedAt, lastSessionDate: obs.sessionDate, sessionsObserved,
    }, event(hitProtection ? 'PROTECTION_ARMED' : 'ENTERED', obs, { entryPrice: round(fill), managedStop: rec.stopLoss }));
  }

  const entry = Number(lifecycle.entryPrice);
  const riskR = entry - rec.stopLoss;
  const protectionWasArmed = Boolean(lifecycle.protectionArmedAt);
  const protectionActive = protectionWasArmed && nowMs > Date.parse(lifecycle.protectionArmedAt);
  const effectiveStop = protectionActive ? Math.max(rec.stopLoss, entry) : rec.stopLoss;

  const stopHit = obs.low <= effectiveStop;
  const targetHit = obs.high >= rec.target1;
  if (stopHit || targetHit) {
    const targetAndStop = stopHit && targetHit;
    const useStop = stopHit;
    const status = useStop ? (protectionActive && effectiveStop >= entry ? 'EXIT_PROTECT' : 'STOP') : 'TARGET';
    const exitPrice = useStop ? effectiveStop : rec.target1;
    return withEvent(lifecycle, {
      status, action: status, reason: targetAndStop ? 'STOP_FIRST_SAME_OBSERVATION' : `${status}_TRIGGERED`,
      managedStop: round(effectiveStop), lastObservedAt: obs.observedAt,
      lastSessionDate: obs.sessionDate, sessionsObserved,
    }, event(status, obs, { exitPrice: round(exitPrice), managedStop: round(effectiveStop), stopFirstApplied: targetAndStop }));
  }

  if (sessionsObserved >= RISKALPHA_LIVE_POLICY.maxHoldSessions && obs.sessionClosed) {
    return withEvent(lifecycle, {
      status: 'TIME_EXIT', action: 'EXIT', reason: 'THIRD_OBSERVED_SESSION_CLOSE',
      managedStop: round(effectiveStop), lastObservedAt: obs.observedAt,
      lastSessionDate: obs.sessionDate, sessionsObserved,
    }, event('TIME_EXIT', obs, { exitPrice: round(obs.last), sessionsObserved }));
  }

  const protectionHitNow = !protectionWasArmed && riskR > 0 && obs.high >= entry + riskR;
  if (protectionHitNow) {
    return withEvent(lifecycle, {
      status: 'PROTECT_PROFIT', action: 'PROTECT_PROFIT', reason: 'ONE_R_REACHED_PROTECTION_ARMED_NEXT_OBSERVATION',
      managedStop: rec.stopLoss, protectionArmedAt: obs.observedAt,
      protectionActiveFromObservation: 'NEXT_OBSERVATION', lastObservedAt: obs.observedAt,
      lastSessionDate: obs.sessionDate, sessionsObserved,
    }, event('PROTECTION_ARMED', obs, { triggerR: 1.0, futureManagedStop: round(entry) }));
  }

  return withEvent(lifecycle, {
    status: protectionActive ? 'PROTECT_PROFIT' : 'HOLD',
    action: protectionActive ? 'PROTECT_PROFIT' : 'HOLD',
    reason: protectionActive ? 'BREAKEVEN_PROTECTION_ACTIVE' : 'POSITION_WITHIN_FROZEN_STOP_TARGET',
    managedStop: round(effectiveStop), lastObservedAt: obs.observedAt,
    lastSessionDate: obs.sessionDate, sessionsObserved,
  }, event('OBSERVED', obs, { action: protectionActive ? 'PROTECT_PROFIT' : 'HOLD', managedStop: round(effectiveStop) }));
}

export function summarizeLiveRecommendation(lifecycle) {
  if (!lifecycle || lifecycle.schemaVersion !== RISKALPHA_LIVE_POLICY.schemaVersion) throw new Error('INVALID_LIFECYCLE');
  return Object.freeze({
    ticker: lifecycle.original.ticker,
    originalEntryZone: [lifecycle.original.entryLow, lifecycle.original.entryHigh],
    originalStop: lifecycle.original.stopLoss,
    originalTarget1: lifecycle.original.target1,
    status: lifecycle.status,
    action: lifecycle.action,
    managedStop: lifecycle.managedStop,
    entryPrice: lifecycle.entryPrice,
    sessionsObserved: lifecycle.sessionsObserved,
    lastObservedAt: lifecycle.lastObservedAt,
    reason: lifecycle.reason,
    originalRecommendationChanged: false,
    researchOnly: true,
    scoringImpact: 'NONE',
    productionAuthority: false,
  });
}
