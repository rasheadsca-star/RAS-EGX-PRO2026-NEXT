#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const v20 = read('data/v20/current.json');
const v17Gate = read('data/v17/resilient-session-status.json');
const failures = [];
function check(ok, code) { if (!ok) failures.push(code); }
check(v20.governance.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'CHAMPION_CHANGED');
check(v20.governance.automaticPromotion === false, 'AUTOMATIC_PROMOTION_ENABLED');
check(v20.governance.promotionAllowed === false, 'PROMOTION_ALLOWED_WITHOUT_REVIEW');
check(v20.portfolio.recommendedExposurePct <= v20.portfolio.maximumTotalAllocationPct, 'ALLOCATION_EXCEEDS_MAXIMUM');
check(v20.portfolio.recommendedExposurePct >= 0 && v20.portfolio.cashPct >= 0, 'NEGATIVE_PORTFOLIO_COMPONENT');
check(Math.abs((v20.portfolio.recommendedExposurePct + v20.portfolio.cashPct) - 100) < 0.01, 'EXPOSURE_CASH_NOT_100');
check(v20.dataStatus.coveragePct === null || (v20.dataStatus.coveragePct >= 0 && v20.dataStatus.coveragePct <= 100), 'IMPOSSIBLE_COVERAGE');
check(v20.dataStatus.freshnessPct === null || (v20.dataStatus.freshnessPct >= 0 && v20.dataStatus.freshnessPct <= 100), 'IMPOSSIBLE_FRESHNESS');
check(v20.dataStatus.criticalFieldsPct === null || (v20.dataStatus.criticalFieldsPct >= 0 && v20.dataStatus.criticalFieldsPct <= 100), 'IMPOSSIBLE_CRITICAL_FIELDS');
const actionable = v20.opportunities.filter(x => x.status === 'ACTIONABLE');
if (v17Gate.executionGrade !== true) {
  check(v20.executionStatus !== 'EXECUTION_GRADE', 'EXECUTION_GRADE_TRUE_WHILE_V17_GATE_FAILED');
  check(actionable.length === 0, 'ACTIONABLE_ROWS_WHILE_GLOBAL_GATE_FAILED');
  check(v20.portfolio.recommendedExposurePct === 0, 'NONZERO_EXPOSURE_WHILE_GLOBAL_GATE_FAILED');
}
for (const row of v20.opportunities) {
  const p = row.tradePlan || {};
  if (row.status === 'ACTIONABLE') {
    check(Number.isFinite(p.entryLow) && Number.isFinite(p.entryHigh) && Number.isFinite(p.stop) && Number.isFinite(p.target1), `MISSING_TRADE_PLAN_${row.ticker}`);
    check(p.stop < p.entryLow && p.target1 > p.entryHigh, `INVALID_TRADE_RELATION_${row.ticker}`);
    check(row.liquidityExecutionEligible === true, `ACTIONABLE_WITHOUT_LIQUIDITY_${row.ticker}`);
    check(row.supportResistance?.executionEligible === true, `ACTIONABLE_WITHOUT_SR_${row.ticker}`);
  }
  check(row.suggestedPositionWeightPct >= 0, `NEGATIVE_WEIGHT_${row.ticker}`);
}
const report = {
  schemaVersion: '20.0.0-regression-1',
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
  },
};
fs.mkdirSync(path.join(root, 'data/v20'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/v20/regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
