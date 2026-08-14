#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));

const explorer = read('data/v20/market-explorer.json');
const universe = read('data/v20/master-universe.json');
const current = read('data/v20/current.json');
const regime = read('data/v20/market-regime.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(explorer.schemaVersion === '20.0.0-market-explorer-3', 'MARKET_EXPLORER_SCHEMA_NOT_V3');
check(explorer.policy?.fullMarketSearch === true, 'FULL_MARKET_SEARCH_POLICY_MISSING');
check(explorer.policy?.currentSessionPriceOnly === true, 'CURRENT_SESSION_PRICE_ONLY_POLICY_MISSING');
check(explorer.policy?.stalePriceFallbackDisplayedAsCurrent === false, 'STALE_PRICE_FALLBACK_ALLOWED');
check(explorer.policy?.marketOnlyIsRecommendation === false, 'MARKET_ONLY_RECOMMENDATION_POLICY_DRIFT');
check(explorer.policy?.marketTrendContextIsNotFullTechnicalSet === true, 'MARKET_TREND_CONTEXT_MISLABELED_FULL_TECHNICAL');
check(explorer.policy?.marketTrendContextMayCreateRecommendationOrScore === false, 'MARKET_TREND_CONTEXT_SCORE_LEAK_POLICY');
check(explorer.policy?.marketTrendContextExecutionInfluence === false, 'MARKET_TREND_CONTEXT_EXECUTION_LEAK_POLICY');
check(explorer.summary?.universeCount === universe.count, 'UNIVERSE_COUNT_MISMATCH');
check((explorer.rows || []).length === universe.count, 'EXPLORER_ROW_COUNT_MISMATCH');
check(explorer.sessionDate === current.sessionDate, 'EXPLORER_SESSION_MISMATCH');
check(regime.asOfSessionDate === current.sessionDate, 'REGIME_SESSION_MISMATCH_FOR_TREND_CONTEXT');

const tickers = new Set();
let trendContextCount = 0;
let marketOnlyTrendContextCount = 0;
for (const row of explorer.rows || []) {
  check(!tickers.has(row.ticker), `DUPLICATE_TICKER_${row.ticker}`);
  tickers.add(row.ticker);
  if (row.currentSessionAvailable === true) {
    check(row.marketDataState === 'CURRENT_SESSION_AVAILABLE', `CURRENT_ROW_STATE_MISMATCH_${row.ticker}`);
    check(row.provenance?.sourceSession === current.sessionDate, `CURRENT_ROW_SESSION_MISMATCH_${row.ticker}`);
    check(Number.isFinite(Number(row.price)), `CURRENT_ROW_PRICE_MISSING_${row.ticker}`);
  } else {
    check(row.price === null, `STALE_OR_MISSING_ROW_PRICE_EXPOSED_${row.ticker}`);
    check(row.open === null && row.high === null && row.low === null, `STALE_OHLC_EXPOSED_${row.ticker}`);
  }
  if (row.decision?.scope === 'MARKET_ONLY') {
    check(row.decision.status === null, `MARKET_ONLY_HAS_RECOMMENDATION_STATUS_${row.ticker}`);
    check(row.decision.opportunityScore === null, `MARKET_ONLY_HAS_OPPORTUNITY_SCORE_${row.ticker}`);
  }
  if (row.technical?.state === 'CURRENT_READY') {
    check(row.technical.usedForCurrentDecision === true, `CURRENT_TECH_NOT_MARKED_USED_${row.ticker}`);
    check(row.technical.asOfSession === current.sessionDate, `CURRENT_TECH_SESSION_MISMATCH_${row.ticker}`);
  }
  if (row.technical?.usedForCurrentDecision === true) {
    check(row.technical.state === 'CURRENT_READY', `NONCURRENT_TECH_USED_${row.ticker}`);
  }
  if (row.technical?.state === 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE') {
    check(row.technical.usedForCurrentDecision === false, `UNEVALUATED_TECH_USED_${row.ticker}`);
  }
  const ctx = row.marketTrendContext || {};
  check(ctx.fullTechnicalIndicatorSet === false, `TREND_CONTEXT_FALSE_FULL_TECHNICAL_FLAG_MISSING_${row.ticker}`);
  check(ctx.usedForDecisionScore === false, `TREND_CONTEXT_SCORE_LEAK_${row.ticker}`);
  check(ctx.usedForExecutionGate === false, `TREND_CONTEXT_EXECUTION_LEAK_${row.ticker}`);
  check(ctx.usedForRecommendationStatus === false, `TREND_CONTEXT_RECOMMENDATION_LEAK_${row.ticker}`);
  check(ctx.decisionUse === 'MARKET_CONTEXT_ONLY_NOT_RESEARCH_SCORE_OR_EXECUTION_PERMISSION', `TREND_CONTEXT_DECISION_USE_DRIFT_${row.ticker}`);
  if (ctx.available === true) {
    trendContextCount += 1;
    if (row.decision?.scope === 'MARKET_ONLY') marketOnlyTrendContextCount += 1;
    check(ctx.state === 'CURRENT_VERIFIED_TREND_CONTEXT', `TREND_CONTEXT_STATE_DRIFT_${row.ticker}`);
    check(ctx.asOfSession === current.sessionDate, `TREND_CONTEXT_SESSION_MISMATCH_${row.ticker}`);
    check(ctx.provenance === 'data/v20/market-regime.json', `TREND_CONTEXT_PROVENANCE_MISSING_${row.ticker}`);
    check(ctx.rowsUsed >= 50, `TREND_CONTEXT_TOO_FEW_ROWS_${row.ticker}`);
    check(Number.isFinite(Number(ctx.sma20)) && Number.isFinite(Number(ctx.sma50)), `TREND_CONTEXT_SMA_MISSING_${row.ticker}`);
    check(Number.isFinite(Number(ctx.return5Pct)) && Number.isFinite(Number(ctx.return20Pct)), `TREND_CONTEXT_MOMENTUM_MISSING_${row.ticker}`);
  }
  check(String(row.searchText || '').includes(String(row.ticker || '').toLowerCase()), `SEARCH_TEXT_MISSING_TICKER_${row.ticker}`);
}

check(explorer.summary.currentSnapshotCount <= explorer.summary.universeCount, 'CURRENT_COUNT_EXCEEDS_UNIVERSE');
check(explorer.summary.opportunityCount === (current.opportunities || []).length, 'OPPORTUNITY_COUNT_MISMATCH');
check(explorer.summary.marketOnlyCount + explorer.summary.opportunityCount === explorer.summary.universeCount, 'SCOPE_COUNTS_DO_NOT_SUM_TO_UNIVERSE');
check(explorer.summary.marketTrendContextReadyCount === trendContextCount, 'TREND_CONTEXT_COUNT_MISMATCH');
check(explorer.summary.marketOnlyTrendContextReadyCount === marketOnlyTrendContextCount, 'MARKET_ONLY_TREND_CONTEXT_COUNT_MISMATCH');
check(explorer.summary.marketTrendContextCoverageOfUniversePct === Math.round(trendContextCount / universe.count * 10000) / 100, 'TREND_CONTEXT_COVERAGE_MISMATCH');
check(trendContextCount === Number(regime.metrics?.analyzedCount || 0), 'TREND_CONTEXT_NOT_ALIGNED_WITH_VERIFIED_REGIME_UNIVERSE');

const report = {
  schemaVersion: '20.0.0-market-explorer-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    fullUniverseRepresented: true,
    noStalePriceAsCurrent: true,
    marketOnlyNeverRecommendation: true,
    technicalReadinessExplicit: true,
    nonEvaluatedTechnicalNotMisrepresented: true,
    verifiedTrendContextSeparatedFromFullTechnical: true,
    trendContextNeverCreatesScoreRecommendationOrExecution: true,
    trendContextSessionAndProvenanceVerified: true,
    searchIndexIncludesTicker: true
  },
  evidence: {trendContextCount, marketOnlyTrendContextCount}
};

fs.writeFileSync(P('data/v20/market-explorer-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;