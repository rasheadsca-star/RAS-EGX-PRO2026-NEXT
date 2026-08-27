import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_STRUCTURE_V3_DEFINITION } from '../src/strategy-lab-v3.js';

const FROZEN_EXPECTED = {
  id: 'FULL_STRUCTURE_V3',
  researchOnly: true,
  promotionAllowed: false,
  automaticEligibilityImpact: 'NONE',
  discoveredAfterHistoricalHoldoutReview: true,
  independentForwardValidationRequired: true,
  thresholds: {
    minBreakoutVolumeRatio: 1.40,
    maxRetestVolumeVsBreakout: 0.75,
    maxRetestDepthAtr: 0.45,
    minReclaimVolumeRatio: 0.95,
    minResistanceTouches: 3,
    minRiskPct: 3,
    maxRiskPct: 7,
  },
};

test('FULL_STRUCTURE V3 definition is immutable and exactly frozen for forward OOS', () => {
  assert.deepEqual(FULL_STRUCTURE_V3_DEFINITION, FROZEN_EXPECTED);
  assert.equal(Object.isFrozen(FULL_STRUCTURE_V3_DEFINITION), true);
  assert.equal(Object.isFrozen(FULL_STRUCTURE_V3_DEFINITION.thresholds), true);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.promotionAllowed, false);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.automaticEligibilityImpact, 'NONE');
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.independentForwardValidationRequired, true);
});

test('FULL_STRUCTURE V3 thresholds cannot be changed during forward validation', () => {
  assert.throws(() => {
    FULL_STRUCTURE_V3_DEFINITION.thresholds.minBreakoutVolumeRatio = 1.39;
  }, TypeError);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.minBreakoutVolumeRatio, 1.40);
});
