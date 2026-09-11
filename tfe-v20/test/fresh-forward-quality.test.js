import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFreshForwardSourceQuality } from '../sidecars/fresh-forward-quality.js';

const aligned = {
  signalSessionDate: '2026-08-27',
  sources: {
    v16: { sessionDate: '2026-08-27' },
    regime: { sessionDate: '2026-08-27' },
    triple: { sessionDate: '2026-08-27' },
    v20: { sessionDate: '2026-08-27' },
  },
};

test('all aligned inputs are eligible for later algorithmic attribution', () => {
  const quality = analyzeFreshForwardSourceQuality(aligned);
  assert.equal(quality.lookaheadDetected, false);
  assert.equal(quality.degradedInputs, false);
  assert.equal(quality.allRequiredAligned, true);
  assert.equal(quality.algorithmicAttributionEligible, true);
  assert.equal(quality.promotionEvidenceEligible, false);
});

test('stale source remains valid operational shadow evidence but blocks algorithmic attribution', () => {
  const quality = analyzeFreshForwardSourceQuality({
    ...aligned,
    sources: { ...aligned.sources, v20: { sessionDate: '2026-08-16' } },
  });
  assert.deepEqual(quality.staleSources, ['v20']);
  assert.equal(quality.degradedInputs, true);
  assert.equal(quality.lookaheadDetected, false);
  assert.equal(quality.operationalShadowEvidenceEligible, true);
  assert.equal(quality.algorithmicAttributionEligible, false);
  assert.equal(quality.interpretation, 'VALID_OPERATIONAL_SHADOW_BUT_DEGRADED_INPUT_ATTRIBUTION');
});

test('future-dated source is explicit lookahead and invalid for forward attribution', () => {
  const quality = analyzeFreshForwardSourceQuality({
    ...aligned,
    sources: { ...aligned.sources, triple: { sessionDate: '2026-08-28' } },
  });
  assert.deepEqual(quality.futureSources, ['triple']);
  assert.equal(quality.lookaheadDetected, true);
  assert.equal(quality.operationalShadowEvidenceEligible, false);
  assert.equal(quality.algorithmicAttributionEligible, false);
  assert.equal(quality.interpretation, 'INVALID_FOR_FORWARD_ATTRIBUTION_FUTURE_DATED_SOURCE');
});
