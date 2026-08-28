import test from 'node:test';
import assert from 'node:assert/strict';
import { FROZEN_RUNTIME_CONTRACT } from '../stability/frozen-runtime-contract.js';

test('frozen contract keeps price reconciliation evidence-only and fail-closed', () => {
  const r = FROZEN_RUNTIME_CONTRACT.priceReconciliationRules;
  assert.equal(r.mode, 'EVIDENCE_BACKED_SESSION_TRUTH_ONLY');
  assert.equal(r.minimumReportedConflictPct, 20);
  assert.equal(r.minimumConfidence, 80);
  assert.equal(r.maximumCloseDifferencePct, 0.25);
  assert.equal(r.requiredSessionMatch, true);
  assert.equal(r.officiallyVerifiedSessionMayBeOverridden, false);
  assert.equal(r.mayChangeTechnicalScore, false);
  assert.equal(r.mayChangeFusionWeights, false);
  assert.equal(r.mayBypassHardWarnings, false);
  assert.equal(r.staleOrMismatchedTruthFailsClosed, true);
  assert.equal(FROZEN_RUNTIME_CONTRACT.policy.permissions.executionAllowed, false);
  assert.equal(FROZEN_RUNTIME_CONTRACT.policy.permissions.automaticOrders, false);
});
