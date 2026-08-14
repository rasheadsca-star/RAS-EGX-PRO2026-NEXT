#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const finite = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };

const current = read('data/v20/current.json');
const audit = read('data/v20/trade-plan-audit.json');
const policy = read('data/v20/policy-registry.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const cfg = policy?.tradePlan?.currentPriceAlignment || {};
check(cfg.enabled === true, 'ALIGNMENT_POLICY_DISABLED');
check(cfg.actionableRequiresCurrentPriceInsideEntryRange === true, 'ACTIONABLE_ENTRY_RANGE_REQUIREMENT_DISABLED');
check(audit.policy?.causeDiagnosisClaimed === false, 'UNVERIFIED_CAUSE_DIAGNOSED');
check(audit.rowCount === (current.opportunities || []).length, 'AUDIT_ROW_COUNT_MISMATCH');
check(audit.eligibleForActionableCount === (audit.rows || []).filter(x => x.eligibleForActionable === true).length, 'ELIGIBLE_COUNT_MISMATCH');
check(audit.rebuildRequiredCount === (audit.rows || []).filter(x => x.state === 'REBUILD_REQUIRED').length, 'REBUILD_COUNT_MISMATCH');
check(audit.invalidRelationCount === (audit.rows || []).filter(x => x.state === 'INVALID_RELATION').length, 'INVALID_RELATION_COUNT_MISMATCH');

const auditByTicker = new Map((audit.rows || []).map(row => [row.ticker, row]));
for (const row of current.opportunities || []) {
  const a = auditByTicker.get(row.ticker);
  check(Boolean(a), `MISSING_TRADE_PLAN_AUDIT_${row.ticker}`);
  if (!a) continue;
  const alignment = row.tradePlan?.alignment;
  check(Boolean(alignment), `MISSING_ALIGNMENT_${row.ticker}`);
  if (!alignment) continue;
  check(alignment.state === a.state, `ALIGNMENT_STATE_DRIFT_${row.ticker}`);
  check(alignment.eligibleForActionable === a.eligibleForActionable, `ALIGNMENT_ELIGIBILITY_DRIFT_${row.ticker}`);
  check(alignment.causeVerified === false, `UNVERIFIED_CAUSE_MARKED_VERIFIED_${row.ticker}`);

  const appliedWeight = finite(row.suggestedPositionWeightPct) || 0;
  if (row.status === 'ACTIONABLE') {
    check(alignment.eligibleForActionable === true, `ACTIONABLE_OUTSIDE_ENTRY_ALIGNMENT_${row.ticker}`);
    check(alignment.state === 'IN_ENTRY_RANGE', `ACTIONABLE_NOT_IN_ENTRY_RANGE_${row.ticker}`);
    check(alignment.relationshipValid === true, `ACTIONABLE_INVALID_RELATION_${row.ticker}`);
  }
  if (alignment.eligibleForActionable !== true) {
    check(row.status !== 'ACTIONABLE', `NON_ELIGIBLE_MARKED_ACTIONABLE_${row.ticker}`);
    check(appliedWeight === 0, `NON_ELIGIBLE_HAS_APPLIED_WEIGHT_${row.ticker}`);
    check((finite(row.confidence?.executionConfidencePct) || 0) === 0, `NON_ELIGIBLE_HAS_EXECUTION_CONFIDENCE_${row.ticker}`);
  }
  if (alignment.state === 'REBUILD_REQUIRED') {
    check(row.status === 'WAIT' || row.status === 'AVOID', `REBUILD_REQUIRED_NOT_WAIT_OR_AVOID_${row.ticker}`);
    check(alignment.hardReviewCause === 'PRICE_SCALE_OR_STALENESS_UNVERIFIED', `REBUILD_CAUSE_POLICY_DRIFT_${row.ticker}`);
    check((row.reasons || []).includes('TRADE_PLAN_REBUILD_REQUIRED_PRICE_SCALE_OR_STALENESS_UNVERIFIED'), `REBUILD_REASON_MISSING_${row.ticker}`);
  }
  if (alignment.state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') {
    check(row.status === 'WAIT' || row.status === 'AVOID', `ABOVE_ENTRY_NOT_WAIT_OR_AVOID_${row.ticker}`);
    check((row.reasons || []).includes('PRICE_ABOVE_ENTRY_RANGE_DO_NOT_CHASE'), `DO_NOT_CHASE_REASON_MISSING_${row.ticker}`);
  }
  if (alignment.state === 'BELOW_ENTRY_RANGE_WAITING') {
    check(row.status === 'WAIT' || row.status === 'AVOID', `BELOW_ENTRY_NOT_WAIT_OR_AVOID_${row.ticker}`);
    check((row.reasons || []).includes('PRICE_BELOW_ENTRY_RANGE_WAIT_FOR_ZONE'), `WAIT_FOR_ZONE_REASON_MISSING_${row.ticker}`);
  }
  if (alignment.state === 'INVALID_RELATION') {
    check(row.status === 'WAIT' || row.status === 'AVOID', `INVALID_RELATION_NOT_WAIT_OR_AVOID_${row.ticker}`);
    check((row.reasons || []).includes('TRADE_PLAN_RELATION_INVALID'), `INVALID_RELATION_REASON_MISSING_${row.ticker}`);
  }
}

const report = {
  schemaVersion: '20.0.0-trade-plan-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    actionableRequiresCurrentPriceInsideEntryRange: true,
    doNotChaseAboveEntryRange: true,
    rebuildHardPriceMismatchBeforeActionable: true,
    unverifiedCauseNeverDiagnosed: true,
    invalidLongRelationsFailClosed: true,
    nonEligibleRowsHaveZeroAppliedWeight: true,
    nonEligibleRowsHaveZeroExecutionConfidence: true
  }
};

fs.writeFileSync(P('data/v20/trade-plan-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
