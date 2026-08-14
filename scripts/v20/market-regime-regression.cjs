#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const out = read('data/v20/market-regime.json');
const snapshot = read('data/v20/current-market-snapshot.json');
const universe = read('data/v20/master-universe.json');
const policy = read('data/v20/policy-registry.json');
const v16 = read('data/stable/v16-market-regime.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const minParticipation = Number(policy.marketRegime?.minimumVerifiedParticipationPct);
const tolerance = Number(policy.marketRegime?.maximumCurrentPriceDifferencePct);
const minSessions = Number(policy.marketRegime?.minimumTrustedSessionsPerSymbol);

check(out.schemaVersion === '20.0.0-market-regime-evidence-1', 'SCHEMA_VERSION_UNEXPECTED');
check(out.asOfSessionDate === snapshot.sessionDate, 'REGIME_SESSION_MISMATCH_SNAPSHOT');
check(out.asOfSessionDate === universe.sessionDate, 'REGIME_SESSION_MISMATCH_UNIVERSE');
check(out.methodology?.v16ReferenceMethodology === 'EGX_PRO_MARKET_REGIME_BREADTH_1.0', 'V16_METHOD_REFERENCE_MISSING');
check(out.methodology?.fullUniverseScope === true, 'FULL_UNIVERSE_SCOPE_NOT_DECLARED');
check(out.methodology?.sectorInputsUsed === false, 'UNVERIFIED_SECTOR_INPUT_USED');
check(out.methodology?.futureRowsAllowed === false, 'FUTURE_ROWS_POLICY_DRIFT');
check(out.methodology?.missingOhlcMayBeSynthesized === false, 'SYNTHETIC_OHLC_POLICY_DRIFT');
check(out.methodology?.productionRiskBudgetInfluence === false, 'MARKET_REGIME_SILENTLY_INFLUENCES_PRODUCTION_RISK');
check(out.methodology?.executionGateInfluence === false, 'MARKET_REGIME_SILENTLY_INFLUENCES_EXECUTION_GATE');
check(policy.marketRegime?.staleV16RegimeMayBePromotedToCurrent === false, 'STALE_V16_PROMOTION_POLICY_DRIFT');
check(out.priorV16Reference?.allowedToPromoteAsCurrent === false, 'STALE_V16_REFERENCE_ALLOWED_AS_CURRENT');
check((out.symbols || []).length === universe.count, 'REGIME_SYMBOL_COUNT_NOT_FULL_UNIVERSE');
check(out.metrics?.universeCount === universe.count, 'REGIME_UNIVERSE_COUNT_MISMATCH');
check(finite(out.metrics?.participationPct), 'PARTICIPATION_PCT_MISSING');
check(minParticipation === 60, 'MINIMUM_PARTICIPATION_POLICY_DRIFT');
check(tolerance === 5, 'PRICE_RECONCILIATION_TOLERANCE_DRIFT');
check(minSessions === 50, 'MINIMUM_TRUSTED_SESSION_POLICY_DRIFT');

for (const row of out.symbols || []) {
  check(!row.lastSession || row.lastSession <= out.asOfSessionDate, `FUTURE_SESSION_LEAK_${row.ticker}`);
  if (row.eligibleForVerifiedRegime === true) {
    check(row.lastSession === out.asOfSessionDate, `ELIGIBLE_SESSION_NOT_ALIGNED_${row.ticker}`);
    check(row.currentSnapshotSemanticComplete === true, `ELIGIBLE_SNAPSHOT_NOT_SEMANTIC_${row.ticker}`);
    check(row.currentSnapshotSessionAligned === true, `ELIGIBLE_SNAPSHOT_SESSION_NOT_ALIGNED_${row.ticker}`);
    check(row.sourceConflict === false, `ELIGIBLE_SOURCE_CONFLICT_${row.ticker}`);
    check(row.sessionAligned === true, `ELIGIBLE_HISTORY_SESSION_NOT_ALIGNED_${row.ticker}`);
    check(row.priceReconciled === true, `ELIGIBLE_PRICE_NOT_RECONCILED_${row.ticker}`);
    check(Number(row.rowsAccepted) >= minSessions, `ELIGIBLE_HISTORY_TOO_SHORT_${row.ticker}`);
    check(finite(row.stats?.sma20) && finite(row.stats?.sma50), `ELIGIBLE_TREND_NOT_READY_${row.ticker}`);
    check(finite(row.stats?.return20Pct), `ELIGIBLE_RETURN20_NOT_READY_${row.ticker}`);
    check(finite(row.stats?.volatility20AnnualizedPct), `ELIGIBLE_VOLATILITY_NOT_READY_${row.ticker}`);
    check(Number(row.currentPriceDifferencePct) <= tolerance, `ELIGIBLE_PRICE_DIFF_OVER_TOLERANCE_${row.ticker}`);
  }
}

const eligibleCount = (out.symbols || []).filter(row => row.eligibleForVerifiedRegime === true).length;
check(eligibleCount === out.metrics?.analyzedCount, 'ANALYZED_COUNT_MISMATCH');
const recomputedParticipation = universe.count ? Math.round((eligibleCount / universe.count * 100) * 100) / 100 : 0;
check(recomputedParticipation === out.metrics?.participationPct, 'PARTICIPATION_RECOMPUTE_MISMATCH');

if (out.verified === true) {
  check(out.metrics.participationPct >= minParticipation, 'VERIFIED_BELOW_PARTICIPATION_THRESHOLD');
  check(['BULLISH', 'NEUTRAL', 'BEARISH'].includes(out.regime), 'VERIFIED_REGIME_NOT_CANONICAL');
  check(out.marketConfidencePct === out.metrics.participationPct, 'VERIFIED_MARKET_CONFIDENCE_NOT_EVIDENCE_COVERAGE');
  check(out.decisionUse === 'CURRENT_MARKET_CONTEXT_ONLY', 'VERIFIED_DECISION_USE_DRIFT');
} else {
  check(out.metrics.participationPct < minParticipation, 'UNVERIFIED_DESPITE_SUFFICIENT_PARTICIPATION');
  check(out.regime === 'UNVERIFIED_CURRENT_REGIME', 'UNVERIFIED_REGIME_LABEL_DRIFT');
  check(out.marketConfidencePct === 0, 'UNVERIFIED_MARKET_CONFIDENCE_NONZERO');
  check(out.decisionUse === 'RESEARCH_DIAGNOSTIC_ONLY', 'UNVERIFIED_DECISION_USE_DRIFT');
}

const priorDate = v16?.metrics?.sessionDate || null;
if (priorDate && priorDate !== out.asOfSessionDate) {
  check(out.priorV16Reference?.staleForCurrentSession === true, 'STALE_V16_REFERENCE_NOT_MARKED_STALE');
  check((out.warnings || []).includes('STALE_V16_REGIME_REFERENCE_NOT_USED_AS_CURRENT'), 'STALE_V16_WARNING_MISSING');
}

const report = {
  schemaVersion: '20.0.0-market-regime-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  evidence: {
    asOfSessionDate: out.asOfSessionDate,
    verified: out.verified,
    regime: out.regime,
    diagnosticRegime: out.diagnosticRegime,
    classificationScore: out.classificationScore,
    participationPct: out.metrics?.participationPct,
    analyzedCount: out.metrics?.analyzedCount,
    universeCount: out.metrics?.universeCount,
    priorV16SessionDate: priorDate,
    staleV16ReferencePromoted: false,
  },
};
fs.writeFileSync(P('data/v20/market-regime-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
