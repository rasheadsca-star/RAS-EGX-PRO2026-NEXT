import { POLICY } from '../src/policy.js';
import { analyzeTickerBase } from '../src/engine.js';
import { backtestHistory, summarizeBacktest } from '../src/backtest.js';
import { loadUniverse, loadHistory } from '../src/repository.js';

const scenario = {
  minCoreScore: POLICY.minCoreScore,
  minResearchScore: POLICY.minResearchScore,
  minLiquidityScore: POLICY.minLiquidityScore,
  minSrScore: POLICY.minSrScore,
  minStructuralNetRR: POLICY.minStructuralNetRR,
};

const { candidates, expectedSessionDate, universeMode } = await loadUniverse();
const allTrades = [];
const allExpired = [];
const current = [];
const errors = [];

for (let i = 0; i < candidates.length; i += 12) {
  const batch = candidates.slice(i, i + 12);
  const settled = await Promise.allSettled(batch.map(async (candidate) => {
    const h = await loadHistory(candidate.ticker);
    const bt = backtestHistory({ ticker: candidate.ticker, rows: h.rows });
    const live = analyzeTickerBase({
      ticker: candidate.ticker,
      nameAr: candidate.nameAr,
      nameEn: candidate.nameEn,
      rows: h.rows,
      historyMeta: h.meta,
      expectedSessionDate,
      includeOverlay: false,
    });
    return { ticker: candidate.ticker, bt, live };
  }));

  settled.forEach((item, index) => {
    const ticker = batch[index].ticker;
    if (item.status !== 'fulfilled') {
      errors.push({ ticker, error: String(item.reason?.message || item.reason) });
      return;
    }
    const { bt, live } = item.value;
    allTrades.push(...bt.trades);
    allExpired.push(...bt.expired.map(x => ({ ticker, ...x })));
    current.push({
      ticker,
      eligible: Boolean(live.eligible),
      research: live.scores?.research ?? null,
      core: live.scores?.core ?? null,
      liquidity: live.scores?.liquidity ?? null,
      sr: live.scores?.supportResistance ?? null,
      structuralNetRR: live.tradePlan?.structuralNetRR ?? null,
      alignmentState: live.tradePlan?.alignmentState ?? null,
      qualityState: live.quality?.state ?? null,
      publicationHold: Boolean(live.quality?.publicationHold),
      reasons: live.reasonCodes ?? [],
    });
  });
}

const aggregate = summarizeBacktest(allTrades, allExpired).summary;
const currentEligible = current
  .filter(x => x.eligible)
  .sort((a,b) => (b.research ?? -1) - (a.research ?? -1) || (b.core ?? -1) - (a.core ?? -1) || a.ticker.localeCompare(b.ticker));
const currentPublishable = currentEligible.filter(x => !x.publicationHold);

const grossProfit = allTrades.filter(x => x.netPct > 0).reduce((s,x) => s + x.netPct, 0);
const grossLoss = Math.abs(allTrades.filter(x => x.netPct < 0).reduce((s,x) => s + x.netPct, 0));
const avgWinner = allTrades.filter(x => x.netPct > 0).length
  ? allTrades.filter(x => x.netPct > 0).reduce((s,x) => s + x.netPct, 0) / allTrades.filter(x => x.netPct > 0).length
  : null;
const avgLoser = allTrades.filter(x => x.netPct < 0).length
  ? allTrades.filter(x => x.netPct < 0).reduce((s,x) => s + x.netPct, 0) / allTrades.filter(x => x.netPct < 0).length
  : null;

const report = {
  schemaVersion: 'rc2-rr-calibration-scenario/v1',
  generatedAt: new Date().toISOString(),
  researchOnly: true,
  sourceCommit: process.env.GITHUB_SHA || null,
  scenario,
  universeMode,
  expectedSessionDate,
  symbolsRequested: candidates.length,
  symbolsCompleted: current.length,
  errors: errors.slice(0, 20),
  currentSession: {
    eligible: currentEligible.length,
    publishable: currentPublishable.length,
    candidates: currentEligible.slice(0, 20),
  },
  historical: {
    issuedSignals: allTrades.length + allExpired.length,
    entered: aggregate.entered,
    expired: allExpired.length,
    target1Pct: aggregate.target1Pct,
    stopPct: aggregate.stopPct,
    positivePct: aggregate.positivePct,
    avgNetPct: aggregate.avgNetPct,
    profitFactor: aggregate.profitFactor,
    wilson95LowerTarget1Pct: aggregate.wilson95LowerTarget1Pct,
    grossProfitPctPoints: Number(grossProfit.toFixed(2)),
    grossLossPctPoints: Number(grossLoss.toFixed(2)),
    avgWinnerPct: avgWinner == null ? null : Number(avgWinner.toFixed(3)),
    avgLoserPct: avgLoser == null ? null : Number(avgLoser.toFixed(3)),
  },
  safety: {
    productionMutation: false,
    executionAllowed: false,
    automaticOrders: false,
    purpose: 'Historical sensitivity analysis for the structural net RR hard gate.',
  },
};

console.log('RC2_RR_CALIBRATION_SCENARIO:' + JSON.stringify(report));
