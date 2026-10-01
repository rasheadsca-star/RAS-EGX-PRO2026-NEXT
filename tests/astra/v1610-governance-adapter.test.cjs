'use strict';

const assert = require('assert');
const {
  resolveDecision,
  V1610_ENGINE_ID,
  V169_ENGINE_ID,
  MAX_V1610_AGE_MINUTES,
} = require('../../scripts/stable/v16-main-app-decision-adapter.cjs');

const decision = resolveDecision();
const engine = decision?.selectedModel?.id;
assert.ok([V1610_ENGINE_ID, V169_ENGINE_ID].includes(engine), 'Unexpected resolved engine');

if (engine === V1610_ENGINE_ID) {
  assert.strictEqual(decision.governanceResolution.selectedByResolver, true);
  assert.strictEqual(decision.governanceResolution.shadowOnly, true);
  assert.strictEqual(decision.governanceResolution.automaticPromotionAllowed, false);
  assert.ok(decision.governanceResolution.reportAgeMinutes <= MAX_V1610_AGE_MINUTES);
  assert.ok(['V16_10_READY_PENDING_OPEN', 'V16_10_CASH_MODE'].includes(decision.status));
  assert.strictEqual(decision.productionRecommendationCount, decision.recommendations.length);
  assert.ok(decision.researchCandidateCount >= 0);
  assert.strictEqual(decision.basketPlan.totalAllocationPct <= 50, true);
  if (decision.status === 'V16_10_CASH_MODE') {
    assert.strictEqual(decision.recommendations.length, 0);
    assert.strictEqual(decision.basketPlan.totalAllocationPct, 0);
    assert.strictEqual(decision.basketPlan.cashReservePct, 100);
  }
} else {
  assert.strictEqual(decision.governanceResolution.selectedByResolver, false);
  assert.strictEqual(decision.governanceResolution.engineId, V169_ENGINE_ID);
  assert.ok(decision.governanceResolution.fallbackReason);
}

console.log(JSON.stringify({
  ok: true,
  engine,
  status: decision.status,
  productionRecommendationCount: decision.productionRecommendationCount ?? decision.recommendations?.length ?? 0,
  researchCandidateCount: decision.researchCandidateCount ?? decision.researchWatchlist?.length ?? 0,
  resolver: decision.governanceResolution,
}, null, 2));
