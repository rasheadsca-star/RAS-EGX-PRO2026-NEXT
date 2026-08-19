import { POLICY } from './policy.js';
import { analyzeTicker } from './engine.js';
import { summarizeBacktest } from './backtest.js';
import { normalizeBars } from './quality.js';
import { round } from './math.js';

const keyOf = (date, ticker) => `${date}|${String(ticker ?? '').trim().toUpperCase()}`;

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

function evidenceRank(evidence = '') {
  if (evidence.includes('NATIVE_V17_LIVE')) return 5;
  if (evidence.includes('EXACT_METHOD_RECORDED_LIVE')) return 4;
  if (evidence.includes('HISTORICAL_BLOCKED_WALK_FORWARD')) return 3;
  if (evidence.includes('RECORDED')) return 2;
  return 1;
}

export function collectV17SignalKeys(trackRecord) {
  const signals = new Map();
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const date = node.signalDate ?? node.recommendationDate ?? null;
    const evidenceClass = String(node.evidenceClass ?? node.provenance ?? 'V17_RECORDED_SIGNAL');
    const tickers = Array.isArray(node.tickers) ? node.tickers : node.ticker ? [node.ticker] : [];
    if (date && tickers.length) {
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

function summarizeVariant(state, baseCount) {
  const summary = summarizeBacktest(state.trades, state.expired).summary;
  const timeExit = state.trades.filter((x) => x.outcome === 'TIME_EXIT').length;
  return {
    selectedSignals: state.accepted,
    gateCoveragePct: baseCount ? round(state.accepted / baseCount * 100, 1) : null,
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
  };
}

function delta(value, base) {
  return Number.isFinite(Number(value)) && Number.isFinite(Number(base)) ? round(Number(value) - Number(base), 2) : null;
}

export function buildAblationBenchmark({ v20Replay, v17TrackRecord, histories = {}, historyErrors = [] }) {
  const events = extractV20ReplayEvents(v20Replay);
  const v17Signals = collectV17SignalKeys(v17TrackRecord);
  const states = {
    V20_NATIVE_ONLY: { accepted: 0, trades: [], expired: [] },
    V20_PLUS_TFE: { accepted: 0, trades: [], expired: [] },
    V20_PLUS_V17_SAFETY: { accepted: 0, trades: [], expired: [] },
    FULL_FUSION: { accepted: 0, trades: [], expired: [] },
  };
  const diagnostics = { missingHistory: 0, nativePlanUnavailable: 0, tfeRejected: 0, tfePlanUnavailable: 0, v17Unconfirmed: 0 };

  const add = (state, result) => {
    state.accepted += 1;
    if (result.trade) state.trades.push(result.trade);
    if (result.expired) state.expired.push(result.expired);
  };

  for (const event of events) {
    const rows = histories[event.ticker];
    if (!Array.isArray(rows) || !rows.length) { diagnostics.missingHistory += 1; continue; }

    const nativeResult = evaluateRecordedPlan({ ticker: event.ticker, rows, signalDate: event.signalDate, plan: event.plan, holdSessions: 10 });
    if (nativeResult.status === 'PLAN_UNAVAILABLE') diagnostics.nativePlanUnavailable += 1;
    else add(states.V20_NATIVE_ONLY, nativeResult);

    const bars = normalizeBars(rows).bars;
    const signalIndex = bars.findIndex((x) => x.date === event.signalDate);
    let tfe = null;
    if (signalIndex >= POLICY.minBars - 1) {
      tfe = analyzeTicker({ ticker: event.ticker, rows: bars.slice(0, signalIndex + 1), historyMeta: { warnings: [] }, expectedSessionDate: null });
    }
    const tfeAccepted = Boolean(tfe?.eligible && tfe?.tradePlan);
    if (!tfeAccepted) diagnostics.tfeRejected += 1;
    else {
      const tfeResult = evaluateRecordedPlan({ ticker: event.ticker, rows, signalDate: event.signalDate, plan: tfe.tradePlan, holdSessions: 10 });
      if (tfeResult.status === 'PLAN_UNAVAILABLE') diagnostics.tfePlanUnavailable += 1;
      else add(states.V20_PLUS_TFE, tfeResult);
    }

    const v17Confirmed = v17Signals.has(keyOf(event.signalDate, event.ticker));
    if (!v17Confirmed) diagnostics.v17Unconfirmed += 1;
    else if (nativeResult.status !== 'PLAN_UNAVAILABLE') add(states.V20_PLUS_V17_SAFETY, nativeResult);

    if (tfeAccepted && v17Confirmed) {
      const fullResult = evaluateRecordedPlan({ ticker: event.ticker, rows, signalDate: event.signalDate, plan: tfe.tradePlan, holdSessions: 10 });
      if (fullResult.status !== 'PLAN_UNAVAILABLE') add(states.FULL_FUSION, fullResult);
    }
  }

  const baseEventCount = events.length;
  const summaries = Object.fromEntries(Object.entries(states).map(([id, state]) => [id, summarizeVariant(state, baseEventCount)]));
  const base = summaries.V20_NATIVE_ONLY;
  const variants = [
    ['V20_NATIVE_ONLY', 'V20 Native only', 'RETROSPECTIVE_POINT_IN_TIME_RECONSTRUCTION'],
    ['V20_PLUS_TFE', 'V20 + TFE', 'RETROSPECTIVE_V20_COHORT_WITH_POINT_IN_TIME_TFE'],
    ['V20_PLUS_V17_SAFETY', 'V20 + V17 Safety', 'RECORDED_V17_CONFIRMATION_PROXY'],
    ['FULL_FUSION', 'V20 + TFE + V17 Safety', 'RECORDED_V17_CONFIRMATION_PROXY'],
  ].map(([id, label, evidenceClass]) => ({
    id,
    label,
    evidenceClass,
    historicalAttribution: id.includes('V17') || id === 'FULL_FUSION'
      ? 'PARTIAL_PROXY_V17_EXACT_SAFETY_ARCHIVE_NOT_AVAILABLE'
      : 'POINT_IN_TIME_DIAGNOSTIC',
    ...summaries[id],
    deltaVsV20: {
      target1Pct: delta(summaries[id].target1Pct, base.target1Pct),
      stopPct: delta(summaries[id].stopPct, base.stopPct),
      avgNetPct: delta(summaries[id].avgNetPct, base.avgNetPct),
      profitFactor: delta(summaries[id].profitFactor, base.profitFactor),
      maxDrawdownPct: delta(summaries[id].maxDrawdownPct, base.maxDrawdownPct),
    },
  }));

  const uniqueDates = [...new Set(events.map((x) => x.signalDate))].sort();
  const v17Matched = events.filter((x) => v17Signals.has(keyOf(x.signalDate, x.ticker))).length;
  return {
    benchmarkId: 'TFE_V20_EVIDENCE_AWARE_ABLATION_V1',
    status: 'RESEARCH_DIAGNOSTIC_ONLY',
    promotionEligible: false,
    commonCohort: {
      source: v20Replay?.engineId ?? 'V20_RETROSPECTIVE_REPLAY',
      signalEvents: baseEventCount,
      sessions: uniqueDates.length,
      from: uniqueDates[0] ?? null,
      to: uniqueDates.at(-1) ?? null,
      v17MatchedSignalEvents: v17Matched,
      historyErrors,
    },
    methodology: {
      noLookahead: true,
      cohortFrozenBeforeOutcomeEvaluation: true,
      entryTiming: 'NEXT_SESSION_OR_LATER_ONLY',
      entryExpirySessions: POLICY.entryExpirySessions,
      maxHoldSessions: 10,
      sameBarAmbiguity: 'STOP_FIRST',
      roundTripCostPct: POLICY.roundTripCostPct,
      target: 'TARGET1',
      maxDrawdown: 'COMPOUNDED_TRADE_SEQUENCE_DIAGNOSTIC_NOT_CONCURRENT_PORTFOLIO_DRAWDOWN',
      v17Treatment: 'RECORDED_SAME_DATE_TICKER_CONFIRMATION_PROXY; DOES_NOT CLAIM EXACT HISTORICAL SAFETY-OVERLAY REPLAY',
    },
    diagnostics,
    variants,
    limitations: [
      'V20 cohort is retrospective point-in-time reconstruction, not fresh forward evidence.',
      'Exact historical V17 safety-overlay state is not archived for the full window; V17 variants use recorded same-date/ticker confirmation as an explicit proxy.',
      'Ablation is isolated from production eligibility and cannot promote a Champion or enable execution.',
    ],
  };
}
