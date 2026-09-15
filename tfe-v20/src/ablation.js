import { POLICY } from './policy.js';
import { analyzeTicker, analyzeTickerBase, rankAnalyses } from './engine.js';
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

export function rankResearchOnly(items) {
  return items.filter((x) => x?.eligible).sort((a, b) =>
    (b.scores?.research ?? -1) - (a.scores?.research ?? -1)
    || (b.scores?.core ?? -1) - (a.scores?.core ?? -1)
    || (b.scores?.supportResistance ?? -1) - (a.scores?.supportResistance ?? -1)
    || (b.scores?.liquidity ?? -1) - (a.scores?.liquidity ?? -1)
    || String(a.ticker).localeCompare(String(b.ticker))
  ).map((x, i) => ({ ...x, rank: i + 1 }));
}

function normalizedHistoryMap(histories) {
  const out = {};
  for (const [ticker, rows] of Object.entries(histories)) {
    const bars = normalizeBars(rows).bars;
    if (bars.length) out[String(ticker).toUpperCase()] = bars;
  }
  return out;
}

function selectionsForSessions({ signalDates, histories, universeTickers, selectionBudget, analyzer, ranker }) {
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
      const analysis = analyzer({
        ticker,
        rows: bars.slice(0, signalIndex + 1),
        historyMeta: { warnings: [] },
        expectedSessionDate: null,
      });
      if (analysis?.eligible && analysis?.tradePlan) analyses.push(analysis);
    }
    const ranked = ranker(analyses).slice(0, selectionBudget);
    for (const analysis of ranked) {
      selected.push({
        ticker: analysis.ticker,
        signalDate,
        plan: analysis.tradePlan,
        researchScore: analysis.scores?.research ?? null,
        fusionRankScore: analysis.scores?.fusionRank ?? null,
      });
    }
    sessions.push({
      signalDate,
      universeWithBar: dateAvailable,
      universeWithSufficientHistory: sufficientHistory,
      eligible: analyses.length,
      selected: ranked.map((x) => ({ ticker: x.ticker, research: x.scores?.research ?? null, fusionRank: x.scores?.fusionRank ?? null })),
    });
  }
  return { selected, sessions };
}

function overlapCount(a, b) {
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

function evaluateSelection(selection, histories) {
  const state = newState();
  for (const event of selection) {
    addResult(state, evaluateRecordedPlan({
      ticker: event.ticker,
      rows: histories[event.ticker] ?? [],
      signalDate: event.signalDate,
      plan: event.plan,
      holdSessions: 10,
    }));
  }
  return state;
}

export function buildAblationBenchmark({ v20Replay, v17TrackRecord, histories = {}, universeTickers = [], historyErrors = [] }) {
  const v20Events = extractV20ReplayEvents(v20Replay);
  const signalDates = [...new Set(v20Events.map((x) => x.signalDate))].sort();
  const selectionBudget = Math.max(1, Number(v20Replay?.comparisonContract?.selectedPerSession ?? 3) || 3);
  const capacity = signalDates.length * selectionBudget;
  const v20State = newState();
  const diagnostics = { missingHistory: 0, v20PlanUnavailable: 0, v20SignalBarUnavailable: 0 };

  for (const event of v20Events) {
    const rows = histories[event.ticker];
    if (!Array.isArray(rows) || !rows.length) { diagnostics.missingHistory += 1; continue; }
    const result = evaluateRecordedPlan({ ticker: event.ticker, rows, signalDate: event.signalDate, plan: event.plan, holdSessions: 10 });
    if (result.status === 'PLAN_UNAVAILABLE') diagnostics.v20PlanUnavailable += 1;
    if (result.status === 'SIGNAL_BAR_UNAVAILABLE') diagnostics.v20SignalBarUnavailable += 1;
    addResult(v20State, result);
  }

  const effectiveUniverse = [...new Set((universeTickers.length ? universeTickers : Object.keys(histories)).map((x) => String(x).toUpperCase()).filter(Boolean))];
  const coreReplay = selectionsForSessions({
    signalDates,
    histories,
    universeTickers: effectiveUniverse,
    selectionBudget,
    analyzer: (args) => analyzeTickerBase({ ...args, includeOverlay: false }),
    ranker: rankResearchOnly,
  });
  const fusionReplay = selectionsForSessions({
    signalDates,
    histories,
    universeTickers: effectiveUniverse,
    selectionBudget,
    analyzer: (args) => analyzeTicker({ ...args, v17: null }),
    ranker: rankAnalyses,
  });

  const coreState = evaluateSelection(coreReplay.selected, histories);
  const fusionState = evaluateSelection(fusionReplay.selected, histories);
  const v20Summary = summarizeState(v20State, capacity);
  const coreSummary = summarizeState(coreState, capacity);
  const fusionSummary = summarizeState(fusionState, capacity);

  const v17Signals = collectV17SignalKeys(v17TrackRecord);
  const windowSet = new Set(signalDates);
  const v17RecordedSignalsInWindow = [...v17Signals.values()].filter((x) => windowSet.has(x.date)).length;

  const variants = [
    {
      id: 'V20_NATIVE_ONLY', label: 'V20 Native', decisionRole: 'NATIVE_SELECTION_ENGINE',
      comparisonStatus: 'COMPARABLE_DIAGNOSTIC', evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME_RECONSTRUCTION', historicalAttribution: 'POINT_IN_TIME_DIAGNOSTIC',
      ...v20Summary, deltaVsV20: deltas(v20Summary, v20Summary),
    },
    {
      id: 'TFE_CORE_STANDALONE', label: 'TFE Core standalone', decisionRole: 'TECHNICAL_RESEARCH_SCORE_AFTER_HARD_GATES',
      comparisonStatus: 'COMPARABLE_DIAGNOSTIC', evidenceClass: 'POINT_IN_TIME_FULL_MARKET_REPLAY_RESEARCH_RANK', historicalAttribution: 'RECONSTRUCTED_CURRENT_UNIVERSE_POINT_IN_TIME',
      ...coreSummary, deltaVsV20: deltas(coreSummary, v20Summary),
    },
    {
      id: 'FULL_FUSION_RC2', label: 'Full Fusion RC2', decisionRole: 'TFE_CORE_PLUS_WILSON_HISTORICAL_CONFIDENCE_AFTER_HARD_GATES',
      comparisonStatus: 'COMPARABLE_DIAGNOSTIC', evidenceClass: 'POINT_IN_TIME_FULL_MARKET_REPLAY_FUSION_RANK', historicalAttribution: 'RECONSTRUCTED_CURRENT_UNIVERSE_POINT_IN_TIME',
      ...fusionSummary, deltaVsV20: deltas(fusionSummary, v20Summary),
      deltaVsTfeCore: deltas(fusionSummary, coreSummary),
    },
    {
      id: 'V17_SAFETY_OVERLAY', label: 'V17 Safety overlay', decisionRole: 'SAFETY_AND_EXECUTION_METADATA_OVERLAY',
      comparisonStatus: 'NOT_COMPARABLE_EXACT_HISTORICAL_OVERLAY_STATE_NOT_ARCHIVED', evidenceClass: 'RECORDED_V17_EVIDENCE_PARTIAL_ONLY', historicalAttribution: 'NO_PERFORMANCE_CLAIM',
      ...unavailableMetrics(), deltaVsV20: { target1Pct: null, stopPct: null, avgNetPct: null, profitFactor: null, maxDrawdownPct: null },
    },
  ];

  return {
    benchmarkId: 'TFE_V20_EVIDENCE_AWARE_ABLATION_V3_RC2',
    status: 'RESEARCH_DIAGNOSTIC_ONLY',
    engineUnderTest: POLICY.engineId,
    promotionEligible: false,
    commonCohort: {
      sessionSetSource: v20Replay?.engineId ?? 'V20_RETROSPECTIVE_REPLAY',
      sessions: signalDates.length, signalDates, from: signalDates[0] ?? null, to: signalDates.at(-1) ?? null,
      selectionBudgetPerSession: selectionBudget, maximumComparableSelections: capacity,
      fullMarketUniverseTickers: effectiveUniverse.length,
      v20RecordedSelections: v20Events.length,
      tfeCoreReconstructedSelections: coreReplay.selected.length,
      fusionRc2ReconstructedSelections: fusionReplay.selected.length,
      overlapV20VsTfeCore: overlapCount(v20Events, coreReplay.selected),
      overlapV20VsFusionRc2: overlapCount(v20Events, fusionReplay.selected),
      overlapTfeCoreVsFusionRc2: overlapCount(coreReplay.selected, fusionReplay.selected),
      historyErrors,
    },
    methodology: {
      noLookahead: true,
      sessionSetFrozenBeforeOutcomeEvaluation: true,
      selectionBudgetPerSession: selectionBudget,
      entryTiming: 'NEXT_SESSION_OR_LATER_ONLY', entryExpirySessions: POLICY.entryExpirySessions,
      maxHoldSessions: 10, sameBarAmbiguity: 'STOP_FIRST', roundTripCostPct: POLICY.roundTripCostPct,
      target: 'TARGET1', minimumComparativeEnteredSample: 30,
      tfeCoreSelection: 'HARD_GATES_THEN_RESEARCH_SCORE_RANK_TOP_N',
      fusionRc2Selection: 'SAME_HARD_GATES_THEN_EVIDENCE_AWARE_FUSION_RANK_TOP_N',
      historicalConfidence: 'WILSON_95_LOWER_BOUND_WEIGHTED_BY_SAMPLE_RELIABILITY',
      historicalConfidenceCanBypassHardGates: false,
      missingHistoricalEvidence: 'NEUTRAL_NOT_ZERO',
      maxDrawdown: 'COMPOUNDED_TRADE_SEQUENCE_DIAGNOSTIC_NOT_CONCURRENT_PORTFOLIO_DRAWDOWN',
    },
    architectureFinding: {
      v20DiscoveryAffectsTfeCoreScore: false,
      v20DiscoveryAffectsResearchEligibility: false,
      v17OverlayAffectsResearchEligibility: false,
      v17OverlayAffectsFusionRank: false,
      rc2HistoricalConfidenceAffectsRankAfterHardGates: true,
      rc2HistoricalConfidenceCanRescueRejectedCandidate: false,
      interpretation: 'RC2 keeps V20 discovery and V17 safety as non-scoring overlays, but unlike RC1 it can reorder already-eligible TFE candidates using Wilson historical confidence after the hard gates.',
    },
    diagnostics: {
      ...diagnostics,
      v17RecordedSignalsInWindow,
      tfeCoreSessions: coreReplay.sessions,
      fusionRc2Sessions: fusionReplay.sessions,
    },
    variants,
    limitations: [
      'V20 is retrospective point-in-time reconstruction, not fresh forward evidence.',
      'TFE Core and RC2 Fusion are replayed on the same session set using the currently reconstructable full-market universe; exact historical market membership is not archived, so survivorship bias remains possible.',
      'Historical confidence is recomputed point-in-time from bars visible at each signal date; it never bypasses the hard gates.',
      'Exact historical V17 Safety Overlay state is not archived for the full window, so V17 remains NOT COMPARABLE rather than receiving fabricated returns.',
      'Samples below 30 entered trades remain LOW_SAMPLE_DIAGNOSTIC and cannot support promotion claims.',
    ],
  };
}
