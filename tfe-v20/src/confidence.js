import { POLICY } from './policy.js';
import { round, avg } from './math.js';

function fill(bar, plan) {
  if (bar.open >= plan.entryLow && bar.open <= plan.entryHigh) return bar.open;
  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) return plan.entryHigh;
  if (bar.open < plan.entryLow) return null;
  if (bar.low <= plan.entryHigh && bar.high >= plan.entryLow) return plan.entryHigh;
  return null;
}

export function wilsonLowerBound95(hits, n) {
  if (!n) return null;
  const p = hits / n;
  const z = 1.96;
  const den = 1 + z * z / n;
  return Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / den);
}

export function summarizeConfidence(trades) {
  const n = trades.length;
  const reliability = Math.min(1, n / POLICY.minHistoricalTrades);
  if (!n) return {
    historicalTradeCount: 0,
    target1HitRatePct: null,
    stopRatePct: null,
    positivePct: null,
    avgNetPct: null,
    profitFactor: null,
    confidenceWilsonLower95Pct: null,
    sampleReliability: 0,
    hasEnoughSample: false,
    effectiveHistoricalScore: null,
  };
  const t1 = trades.filter((t) => t.outcome === 'TARGET1').length;
  const stops = trades.filter((t) => t.outcome.startsWith('STOP')).length;
  const wins = trades.filter((t) => t.netPct > 0);
  const losses = trades.filter((t) => t.netPct < 0);
  const gp = wins.reduce((s, t) => s + t.netPct, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));
  const wilson = wilsonLowerBound95(t1, n) * 100;
  return {
    historicalTradeCount: n,
    target1HitRatePct: round(t1 / n * 100, 1),
    stopRatePct: round(stops / n * 100, 1),
    positivePct: round(wins.length / n * 100, 1),
    avgNetPct: round(avg(trades.map((t) => t.netPct)), 2),
    profitFactor: gl ? round(gp / gl, 2) : gp > 0 ? 'INF' : null,
    confidenceWilsonLower95Pct: round(wilson, 1),
    sampleReliability: round(reliability, 2),
    hasEnoughSample: n >= POLICY.minHistoricalTrades,
    effectiveHistoricalScore: round(wilson, 1),
  };
}

export function simulateHistoricalConfidence({ ticker, bars, analyzeBase, minBars = POLICY.minBars }) {
  const trades = [];
  let i = minBars - 1;
  while (i < bars.length - 1) {
    const a = analyzeBase({
      ticker,
      rows: bars.slice(0, i + 1),
      historyMeta: { warnings: [] },
      expectedSessionDate: null,
      includeOverlay: false,
    });
    if (!a.eligible || !a.tradePlan) { i += 1; continue; }

    let entry = null;
    const end = Math.min(bars.length - 1, i + POLICY.entryExpirySessions);
    for (let j = i + 1; j <= end; j += 1) {
      const p = fill(bars[j], a.tradePlan);
      if (p != null) { entry = { j, price: p }; break; }
    }
    if (!entry) { i = end + 1; continue; }

    const maxExit = Math.min(bars.length - 1, entry.j + POLICY.maxHoldSessions - 1);
    let exit = null;
    for (let j = entry.j; j <= maxExit; j += 1) {
      const b = bars[j];
      const stop = b.low <= a.tradePlan.stop;
      const t1 = b.high >= a.tradePlan.target1;
      if (stop && t1) { exit = { j, price: a.tradePlan.stop, outcome: 'STOP_SAME_BAR' }; break; }
      if (stop) { exit = { j, price: a.tradePlan.stop, outcome: 'STOP' }; break; }
      if (t1) { exit = { j, price: a.tradePlan.target1, outcome: 'TARGET1' }; break; }
    }
    if (!exit) exit = { j: maxExit, price: bars[maxExit].close, outcome: 'TIME_EXIT' };

    trades.push({
      ticker,
      signalDate: bars[i].date,
      entryDate: bars[entry.j].date,
      exitDate: bars[exit.j].date,
      outcome: exit.outcome,
      netPct: round((exit.price - entry.price) / entry.price * 100 - POLICY.roundTripCostPct, 2),
      signalResearchScore: a.scores.research,
      signalTechnicalScore: a.scores.core,
      structuralNetRR: a.tradePlan.structuralNetRR,
    });
    i = exit.j + 1;
  }
  return { ...summarizeConfidence(trades), trades };
}
