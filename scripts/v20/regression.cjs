#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const v20 = read('data/v20/current.json');
const v17Gate = read('data/v17/resilient-session-status.json');
const policy = read('data/v20/policy-registry.json');
const modelRegistry = read('data/v20/model-registry.json');
const portfolioRisk = read('data/v20/portfolio-risk.json');
const sourceHealth = read('data/v20/source-health.json');
const currentSnapshot = read('data/v20/current-market-snapshot.json');
const masterUniverse = read('data/v20/master-universe.json');

const failures = [];
function check(ok, code) { if (!ok) failures.push(code); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

check(v20.governance.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'CHAMPION_CHANGED');
check(modelRegistry.activeProductionChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'MODEL_REGISTRY_CHAMPION_CHANGED');
check(v20.governance.automaticPromotion === false, 'AUTOMATIC_PROMOTION_ENABLED');
check(v20.governance.promotionAllowed === false, 'PROMOTION_ALLOWED_WITHOUT_REVIEW');
check(modelRegistry.automaticPromotion === false, 'MODEL_REGISTRY_AUTOMATIC_PROMOTION_ENABLED');
check(policy?.principles?.localRowExecutionFlagsCannotOverrideGlobalGate === true, 'FAIL_CLOSED_POLICY_DISABLED');
check(policy?.portfolio?.adaptiveWeightingProductionAllowed === false, 'ADAPTIVE_WEIGHTING_LEAKED_TO_PRODUCTION_POLICY');
check(v20.portfolio.adaptiveWeightingProductionAllowed === false, 'ADAPTIVE_WEIGHTING_LEAKED_TO_PRODUCTION');

check(v20.portfolio.recommendedExposurePct <= v20.portfolio.maximumTotalAllocationPct + 1e-9, 'ALLOCATION_EXCEEDS_MAXIMUM');
check(v20.portfolio.recommendedExposurePct >= 0 && v20.portfolio.cashPct >= 0, 'NEGATIVE_PORTFOLIO_COMPONENT');
check(Math.abs((v20.portfolio.recommendedExposurePct + v20.portfolio.cashPct) - 100) < 0.01, 'EXPOSURE_CASH_NOT_100');
check(v20.portfolio.appliedPositionCount <= policy.portfolio.maximumPositions, 'TOO_MANY_APPLIED_POSITIONS');
check(portfolioRisk.appliedExposurePct === v20.portfolio.recommendedExposurePct, 'PORTFOLIO_REPORT_EXPOSURE_MISMATCH');

check(v20.dataStatus.coveragePct === null || (v20.dataStatus.coveragePct >= 0 && v20.dataStatus.coveragePct <= 100), 'IMPOSSIBLE_COVERAGE');
check(v20.dataStatus.freshnessPct === null || (v20.dataStatus.freshnessPct >= 0 && v20.dataStatus.freshnessPct <= 100), 'IMPOSSIBLE_FRESHNESS');
check(v20.dataStatus.criticalFieldsPct === null || (v20.dataStatus.criticalFieldsPct >= 0 && v20.dataStatus.criticalFieldsPct <= 100), 'IMPOSSIBLE_CRITICAL_FIELDS');
check(sourceHealth.executionGrade === (v17Gate.executionGrade === true), 'SOURCE_HEALTH_EXECUTION_GRADE_DRIFT');
check(currentSnapshot.sessionDate === v20.sessionDate, 'CURRENT_SNAPSHOT_SESSION_MISMATCH');
check(masterUniverse.count >= currentSnapshot.rowCount, 'MASTER_UNIVERSE_SMALLER_THAN_CURRENT_SNAPSHOT');

const actionable = v20.opportunities.filter(x => x.status === 'ACTIONABLE');
const appliedWeightSum = v20.opportunities.reduce((sum, row) => sum + (finite(row.suggestedPositionWeightPct) || 0), 0);
check(Math.abs(appliedWeightSum - v20.portfolio.recommendedExposurePct) < 0.01, 'ROW_WEIGHTS_DO_NOT_MATCH_PORTFOLIO_EXPOSURE');

if (v17Gate.executionGrade !== true) {
  check(v20.executionStatus !== 'EXECUTION_GRADE', 'EXECUTION_GRADE_TRUE_WHILE_V17_GATE_FAILED');
  check(actionable.length === 0, 'ACTIONABLE_ROWS_WHILE_GLOBAL_GATE_FAILED');
  check(v20.portfolio.recommendedExposurePct === 0, 'NONZERO_EXPOSURE_WHILE_GLOBAL_GATE_FAILED');
  check(portfolioRisk.globalExecutionOpen === false, 'PORTFOLIO_ENGINE_OVERRULED_V17_GATE');
  check(portfolioRisk.appliedPositions.length === 0, 'APPLIED_POSITIONS_WHILE_GLOBAL_GATE_FAILED');
}

for (const row of v20.opportunities) {
  const p = row.tradePlan || {};
  const t1 = p.target1Metrics || {};
  const appliedWeight = finite(row.suggestedPositionWeightPct) || 0;
  const shadowWeight = finite(row.shadowPositionWeightPct) || 0;

  check(appliedWeight >= 0, `NEGATIVE_WEIGHT_${row.ticker}`);
  check(shadowWeight >= 0, `NEGATIVE_SHADOW_WEIGHT_${row.ticker}`);
  check(appliedWeight <= policy.portfolio.maximumSinglePositionPct + 1e-9, `POSITION_WEIGHT_EXCEEDS_CAP_${row.ticker}`);
  if (row.status !== 'ACTIONABLE') check(appliedWeight === 0, `NON_ACTIONABLE_HAS_APPLIED_WEIGHT_${row.ticker}`);

  if (row.status === 'ACTIONABLE') {
    check(Number.isFinite(Number(p.entryLow)) && Number.isFinite(Number(p.entryHigh)) && Number.isFinite(Number(p.stop)) && Number.isFinite(Number(p.target1)), `MISSING_TRADE_PLAN_${row.ticker}`);
    check(Number(p.stop) < Number(p.entryLow) && Number(p.target1) > Number(p.entryHigh), `INVALID_TRADE_RELATION_${row.ticker}`);
    check(row.liquidityExecutionEligible === true, `ACTIONABLE_WITHOUT_LIQUIDITY_${row.ticker}`);
    check(row.supportResistance?.executionEligible === true, `ACTIONABLE_WITHOUT_SR_${row.ticker}`);
    check(row.supportResistance?.sessionAligned === true, `ACTIONABLE_WITH_SR_SESSION_MISMATCH_${row.ticker}`);
    check(v20.dataStatus.sessionAligned === true, `ACTIONABLE_WITH_GLOBAL_SESSION_MISMATCH_${row.ticker}`);
  }

  if (t1.valid === true) {
    const gross = finite(t1.grossRiskReward);
    const net = finite(t1.netRiskReward);
    check(gross !== null && net !== null, `MISSING_NET_RR_${row.ticker}`);
    check(net <= gross + 1e-9, `NET_RR_EXCEEDS_GROSS_RR_${row.ticker}`);
    check(Number(p.transactionCostRoundTripPct) === Number(policy.transactionCosts.roundTripPct), `COST_POLICY_DRIFT_${row.ticker}`);
  }

  check(row.confidence?.executionConfidencePct === 0 || row.status === 'ACTIONABLE', `EXECUTION_CONFIDENCE_ON_NON_ACTIONABLE_${row.ticker}`);
}

check(v20.portfolio.shadowResearch?.appliedToProductionPortfolio === false, 'SHADOW_WEIGHTS_APPLIED_TO_PRODUCTION');
check(portfolioRisk.shadowResearchPlan.researchOnly === true, 'SHADOW_PLAN_NOT_MARKED_RESEARCH_ONLY');
check(portfolioRisk.invariants.adaptiveProductionWeighting === false, 'PORTFOLIO_ENGINE_ADAPTIVE_PRODUCTION_WEIGHTING');

const report = {
  schemaVersion: '20.0.0-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  invariants: {
    championProtected: true,
    automaticPromotionDisabled: true,
    failClosedExecution: true,
    allocationGuard: true,
    noFalseCoverageAbove100: true,
    netRiskRewardCostAware: true,
    localExecutionCannotOverrideGlobalGate: true,
    shadowWeightingSeparatedFromProduction: true,
    dataTruthSessionChecked: true
  }
};

fs.mkdirSync(path.join(root, 'data/v20'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/v20/regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
