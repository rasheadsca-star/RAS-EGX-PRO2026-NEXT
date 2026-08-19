import { POLICY } from './policy.js';
import { analyzeTicker, rankAnalyses } from './engine.js';
import { summarizeBacktest } from './backtest.js';
import { normalizeBars } from './quality.js';
import { round } from './math.js';

const keyOf = (date, ticker) => `${date}|${String(ticker ?? '').trim().toUpperCase()}`;
const hasNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function normalizePlan(plan = {}) {
  const entryLow = Number(plan.entryLow);
  const entryHigh = Number(plan.entryHigh);
  const stop = Number(plan.stop);
  const target1 = Number(plan.target1 ?? plan.target);
  if (![entryLow, entryHigh, stop, target1].every(Number.isFinite)) return null;
  if (!(entryLow > 0 && entryHigh >= entryLow && stop > 0 && stop < entryHigh && target1 > entryLow)) return null;
  return { entryLow, entryHigh, stop, target1 };
}

function fill(bar, plan) {
  if (bar.open >= plan.entryLow && bar.open <= plan.entryHigh) return bar.open;
  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) return plan.entryHigh;
  if (bar.open < plan.entryLow) return null;
  if (bar.low <= plan.entryHigh && bar.high >= plan.entryLow) return plan.entryHigh;
  return null;
}

export function evaluateRecordedPlan({ ticker, rows, signalDate, plan, holdSessions = 10 }) {
  const bars = normalizeBars(rows).bars;
  const p = normalizePlan(plan);
  if (!p) return { status: 'PLAN_UNAVAILABLE', trade: null, expired: null };
  const signalIndex = bars.findIndex((x) => x.date === signalDate);
  if (signalIndex < 0 || signalIndex >= bars.length - 1) return { status: 'SIGNAL_BAR_UNAVAILABLE', trade: null, expired: null };

  let entry = null;
  const entryEnd = Math.min(bars.length - 1, signalIndex + POLICY.entryExpirySessions);
  for (let j = signalIndex + 1; j <= entryEnd; j += 1) {
    const price = fill(bars[j], p);
    if (price != null) { entry = { j, price }; break; }
  }
  if (!entry) return { status: 'ENTRY_EXPIRED', trade: null, expired: { ticker, signalDate } };

  const maxExit = Math.min(bars.length - 1, entry.j + Math.max(1, holdSessions) - 1);
  let exit = null;
  for (let j = entry.j; j <= maxExit; j += 1) {
    const bar = bars[j];
    const stop = bar.low <= p.stop;
    const target = bar.high >= p.target1;
    if (stop && target) { exit = { j, price: p.stop, outcome: 'STOP_SAME_BAR' }; break; }
    if (stop) { exit = { j, price: p.stop, outcome: 'STOP' }; break; }
    if (target) { exit = { j, price: p.target1, outcome: 'TARGET1' }; break; }
  }
  if (!exit) exit = { j: maxExit, price: bars[maxExit].close, outcome: 'TIME_EXIT' };

  return {
    status: 'ENTERED',
    expired: null,
    trade: {
      ticker,
      signalDate,
      entryDate: bars[entry.j].date,
      exitDate: bars[exit.j].date,
      outcome: exit.outcome,
      netPct: round((exit.price - entry.price) / entry.price * 100 - POLICY.roundTripCostPct, 2),
    },
  };
}

function isRecordedV17Evidence(evidence = '') {
  const e = String(evidence).toUpperCase();
  return e === 'NATIVE_V17_LIVE' || e.includes('RECORDED');
}

function evidenceRank(evidence = '') {
  const e = String(evidence).toUpperCase();
  if (e.includes('NOT_NATIVE_V17_LIVE')) return 2;
  if (e === 'NATIVE_V17_LIVE') return 5;
  if (e.includes('EXACT_METHOD_RECORDED_LIVE')) return 4;
  if (e.includes('RECORDED_ORIGINAL')) return 3;
  if (e.includes('RECORDED')) return 2;
  return 0;
}

export function collectV17SignalKeys(trackRecord) {
  const signals = new Map();
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const date = node.signalDate ?? node.recommendationDate ?? null;
    const evidenceClass = String(node.evidenceClass ?? node.provenance ?? '');
    const tickers = Array.isArray(node.tickers) ? node.tickers : node.ticker ? [node.ticker] : [];
    if (date && tickers.length && isRecordedV17Evidence(evidenceClass)) {
      for (const ticker of tickers) {
        const key = keyOf(date, ticker);
        const prev = signals.get(key);
        if (!prev || evidenceRank(evidenceClass) > evidenceRank(prev.evidenceClass)) {
          signals.set(key, { date, ticker: String(ticker).toUpperCase(), evidenceClass });
        }
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(trackRecord);
  return signals;
}

export function extractV20ReplayEvents(v20Replay) {
  const events = [];
  for (const session of v20Replay?.sessions ?? []) {
    for (const member of session?.members ?? []) {
      if (!member?.ticker || !session?.signalDate) continue;
      events.push({
        ticker: String(member.ticker).toUpperCase(),
        signalDate: session.signalDate,
        plan: member.tradePlan ?? null,
        nativeScore: member.score ?? null,
      });
    }
  }
  return events;
}

function sequenceMaxDrawdownPct(trades) {
  if (!trades.length) return null;
  const ordered = [...trades].sort((a, b) =>
    String(a.exitDate).localeCompare(String(b.exitDate))
    || String(a.signalDate).localeCompare(String(b.signalDate))
    || String(a.ticker).localeCompare(String(b.ticker))
  );
  let equity = 1, peak = 1, worst = 0;
  for (const trade of ordered) {
    equity *= 1 + Number(trade.netPct ?? 0) / 100;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, (equity / peak - 1) * 100);
  }
  return round(worst, 2);
}

function newState() {
  return { accepted: 0, trades: [], expired: [] };
}

function addResult(state, result) {
  if (!result || result.status === 'PLAN_UNAVAILABLE' || result.status === 'SIGNAL_BAR_UNAVAILABLE') return false;
  state.accepted += 1;
  if (result.trade) state.trades.push(result.trade);
  if (result.expired) state.expired.push(result.expired);
  return true;
}

function summarizeState(state, capacity) {
  const summary = summarizeBacktest(state.trades, state.expired).summary;
  const timeExit = state.trades.filter((x) => x.outcome === 'TIME_EXIT').length;
  return {
    selectedSignals: state.accepted,
    selectionCoveragePct: capacity ? round(state.accepted / capacity * 100, 1) : null,
    entered: summary.entered,
    entryCoveragePct: state.accepted ? round(summary.entered / state.accepted * 100, 1) : null,
    target1Pct: summary.target1Pct,
    stopPct: summary.stopPct,
    noHitPct: summary.entered ? round(timeExit / summary.entered * 100, 1) : null,
    positivePct: summary.positivePct,
    avgNetPct: summary.avgNetPct,
    profitFactor: summary.profitFactor,
    maxDrawdownPct: sequenceMaxDrawdownPct(state.trades),
    wilson95LowerTarget1Pct: summary.wilson95LowerTarget1Pct,
    entryExpired: state.expired.length,
    sampleClass: summary.entered >= 30 ? 'MINIMUM_COMPARATIVE_SAMPLE_REACHED' : 'LOW_SAMPLE_DIAGNOSTIC',
  };
}

export function metricDelta(value, base) {
  if (!hasNumber(value) || !hasNumber(base)) return null;
  return round(Number(value) - Number(base), 2);
}

function deltas(summary, base) {
  return {
    target1Pct: metricDelta(summary.target1Pct, base.target1Pct),
    stopPct: metricDelta(summary.stopPct, base.stopPct),
    avgNetPct: metricDelta(summary.avgNetPct, base.avgNetPct),
    profitFactor: metricDelta(summary.profitFactor, base.profitFactor),
    maxDrawdownPct: metricDelta(summary.maxDrawdownPct, base.maxDrawdownPct),
  };
}

function normalizedHistoryMap(histories) {
  const out = {};
  for (const [ticker, rows] of Object.entries(histories)) {
    const bars = normalizeBars(rows).bars;
    if (bars.length) out[String(ticker).toUpperCase()] = bars;
  }
  return out;
}

function tfeSelectionsForSessions({ signalDates, histories, universeTickers, selectionBudget }) {
  const normalized = normalizedHistoryMap(histories);
  const selected = [];
  const sessions = [];
  for (const signalDate of signalDates) {
    const analyses = [];
    let dateAvailable = 0;
    let sufficientHistory = 0;
    for (const tickerRaw of universeTickers) {
      const ticker = String(tickerRaw).toUpperCase();
      const bars = normalized[ticker];
      if (!bars?.length) continue;
      const signalIndex = bars.findIndex((x) => x.date === signalDate);
      if (signalIndex < 0) continue;
      dateAvailable += 1;
      if (signalIndex < POLICY.minBars - 1) continue;
      sufficientHistory += 1;
      const analysis = analyzeTicker({
        ticker,
        rows: bars.slice(0, signalIndex + 1),
        historyMeta: { warnings: [] },
        expectedSessionDate: null,
      });
      if (analysis?.eligible && analysis?.tradePlan) analyses.push(analysis);
    }
    const ranked = rankAnalyses(analyses).slice(0, selectionBudget);
    for (const analysis of ranked) {
      selected.push({
        ticker: analysis.ticker,
        signalDate,
        plan: analysis.tradePlan,
        researchScore: analysis.scores?.research ?? null,
      });
    }
    sessions.push({
      signalDate,
      universeWithBar: dateAvailable,
      universeWithSufficientHistory: sufficientHistory,
      tfeEligible: analyses.length,
      selected: ranked.map((x) => x.ticker),
    });
  }
  return { selected, sessions };
}

function sameDateTickerOverlap(a, b) {
  const bKeys = new Set(b.map((x) => keyOf(x.signalDate, x.ticker)));
  return a.filter((x) => bKeys.has(keyOf(x.signalDate, x.ticker))).length;
}

function unavailableMetrics() {
  return {
    selectedSignals: null,
    selectionCoveragePct: null,
    entered: null,
    entryCoveragePct: null,
    target1Pct: null,
    stopPct: null,
    noHitPct: null,
    positivePct: null,
    avgNetPct: null,
    profitFactor: null,
    maxDrawdownPct: null,
    wilson95LowerTarget1Pct: null,
    entryExpired: null,
    sampleClass: 'NOT_COMPARABLE',
  };
}

export function buildAblationBenchmark({ v20Replay, v17TrackRecord, histories = {}, universeTickers = [], historyErrors = [] }) {
  const v20Events = extractV20ReplayEvents(v20Replay);
  const signalDates = [...new Set(v20Events.map((x) => x.signalDate))].sort();
  const selectionBudget = Math.max(1, Number(v20Replay?.comparisonContract?.selectedPerSession ?? 3) || 3);
  const capacity = signalDates.length * selectionBudget;
  const v20State = newState();
  const diagnostics = {
    missingHistory: 0,
    v20PlanUnavailable: 0,
    v20SignalBarUnavailable: 0,
  };

  for (const event of v20Events) {
    const rows = histories[event.ticker];
    if (!Array.isArray(rows) || !rows.length) { diagnostics.missingHistory += 1; continue; }
    const result = evaluateRecordedPlan({ ticker: event.ticker, rows, signalDate: event.signalDate, plan: event.plan, holdSessions: 10 });
    if (result.status === 'PLAN_UNAVAILABLE') diagnostics.v20PlanUnavailable += 1;
    if (result.status === 'SIGNAL_BAR_UNAVAILABLE') diagnostics.v20SignalBarUnavailable += 1;
    addResult(v20State, result);
  }

  const effectiveUniverse = [...new Set((universeTickers.length ? universeTickers : Object.keys(histories)).map((x) => String(x).toUpperCase()).filter(Boolean))];
  const tfeReplay = tfeSelectionsForSessions({ signalDates, histories, universeTickers: effectiveUniverse, selectionBudget });
  const tfeState = newState();
  for (const event of tfeReplay.selected) {
    addResult(tfeState, evaluateRecordedPlan({ ticker: event.ticker, rows: histories[event.ticker] ?? [], signalDate: event.signalDate, plan: event.plan, holdSessions: 10 }));
  }

  const v20Summary = summarizeState(v20State, capacity);
  const tfeSummary = summarizeState(tfeState, capacity);
  const fusionSummary = { ...tfeSummary };
  const v17Signals = collectV17SignalKeys(v17TrackRecord);
  const windowSet = new Set(signalDates);
  const v17RecordedSignalsInWindow = [...v17Signals.values()].filter((x) => windowSet.has(x.date)).length;
  const overlap = sameDateTickerOverlap(v20Events, tfeReplay.selected);

  const variants = [
    {
      id: 'V20_NATIVE_ONLY',
      label: 'V20 Native',
      decisionRole: 'NATIVE_SELECTION_ENGINE',
      comparisonStatus: 'COMPARABLE_DIAGNOSTIC',
      evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME_RECONSTRUCTION',
      historicalAttribution: 'POINT_IN_TIME_DIAGNOSTIC',
      ...v20Summary,
      deltaVsV20: deltas(v20Summary, v20Summary),
    },
    {
      id: 'TFE_STANDALONE',
      label: 'TFE standalone',
      decisionRole: 'INDEPENDENT_FULL_MARKET_SCORING_ENGINE',
      comparisonStatus: 'COMPARABLE_DIAGNOSTIC',
      evidenceClass: 'POINT_IN_TIME_FULL_MARKET_REPLAY_ON_COMMON_SESSION_SET',
      historicalAttribution: 'RECONSTRUCTED_CURRENT_UNIVERSE_POINT_IN_TIME',
      ...tfeSummary,
      deltaVsV20: deltas(tfeSummary, v20Summary),
    },
    {
      id: 'FULL_FUSION_RC1',
      label: 'Full Fusion RC1',
      decisionRole: 'TFE_DECISION_PLUS_NON_SCORING_V20_DISCOVERY_AND_V17_SAFETY_METADATA',
      comparisonStatus: 'DECISION_EQUIVALENT_TO_TFE_STANDALONE_IN_RC1',
      evidenceClass: 'RC1_SOURCE_PATH_ATTRIBUTION',
      historicalAttribution: 'SAME_RESEARCH_DECISION_PATH_AS_TFE_STANDALONE',
      decisionEquivalentTo: 'TFE_STANDALONE',
      ...fusionSummary,
      deltaVsV20: deltas(fusionSummary, v20Summary),
    },
    {
      id: 'V17_SAFETY_OVERLAY',
      label: 'V17 Safety overlay',
      decisionRole: 'SAFETY_AND_EXECUTION_METADATA_OVERLAY',
      comparisonStatus: 'NOT_COMPARABLE_EXACT_HISTORICAL_OVERLAY_STATE_NOT_ARCHIVED',
      evidenceClass: 'RECORDED_V17_EVIDENCE_PARTIAL_ONLY',
      historicalAttribution: 'NO_PERFORMANCE_CLAIM',
      ...unavailableMetrics(),
      deltaVsV20: { target1Pct: null, stopPct: null, avgNetPct: null, profitFactor: null, maxDrawdownPct: null },
    },
  ];

  return {
    benchmarkId: 'TFE_V20_EVIDENCE_AWARE_ABLATION_V2',
    status: 'RESEARCH_DIAGNOSTIC_ONLY',
    promotionEligible: false,
    commonCohort: {
      sessionSetSource: v20Replay?.engineId ?? 'V20_RETROSPECTIVE_REPLAY',
      sessions: signalDates.length,
      signalDates,
      from: signalDates[0] ?? null,
      to: signalDates.at(-1) ?? null,
      selectionBudgetPerSession: selectionBudget,
      maximumComparableSelections: capacity,
      fullMarketUniverseTickers: effectiveUniverse.length,
      v20RecordedSelections: v20Events.length,
      tfeReconstructedSelections: tfeReplay.selected.length,
      sameDateTickerOverlap: overlap,
      historyErrors,
    },
    methodology: {
      noLookahead: true,
      sessionSetFrozenBeforeOutcomeEvaluation: true,
      selectionBudgetPerSession: selectionBudget,
      entryTiming: 'NEXT_SESSION_OR_LATER_ONLY',
      entryExpirySessions: POLICY.entryExpirySessions,
      maxHoldSessions: 10,
      sameBarAmbiguity: 'STOP_FIRST',
      roundTripCostPct: POLICY.roundTripCostPct,
      target: 'TARGET1',
      minimumComparativeEnteredSample: 30,
      tfeSelection: 'REPLAY_FULL_MARKET_AT_EACH_COMMON_SIGNAL_DATE_THEN_RANK_AND_TAKE_TOP_N',
      maxDrawdown: 'COMPOUNDED_TRADE_SEQUENCE_DIAGNOSTIC_NOT_CONCURRENT_PORTFOLIO_DRAWDOWN',
    },
    architectureFinding: {
      v20DiscoveryAffectsTfeScoreInRc1: false,
      v20DiscoveryAffectsResearchEligibilityInRc1: false,
      v17OverlayAffectsResearchEligibilityInRc1: false,
      v17OverlayAffectsResearchRankInRc1: false,
      fullFusionResearchDecisionEquivalentTo: 'TFE_STANDALONE',
      interpretation: 'RC1 V20 and V17 layers add discovery/provenance/safety context but do not change the TFE research scoring or ranking path.',
    },
    diagnostics: {
      ...diagnostics,
      v17RecordedSignalsInWindow,
      tfeSessions: tfeReplay.sessions,
    },
    variants,
    limitations: [
      'V20 is retrospective point-in-time reconstruction, not fresh forward evidence.',
      'TFE is replayed on the same session set using the currently reconstructable full-market history universe; exact historical market membership is not archived, so survivorship bias remains possible.',
      'Exact historical V17 Safety Overlay state is not archived for the full window, so V17 is shown as NOT COMPARABLE rather than assigning fabricated returns.',
      'Full Fusion RC1 research performance equals TFE standalone by construction because the RC1 V20 discovery and V17 overlay fields do not alter research eligibility, score, trade plan, or ranking.',
      'Samples below 30 entered trades remain LOW_SAMPLE_DIAGNOSTIC and cannot support promotion claims.',
    ],
  };
}
