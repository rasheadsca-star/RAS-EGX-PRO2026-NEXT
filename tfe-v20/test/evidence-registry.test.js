import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_EVIDENCE_REGISTRY, enrichExpertWithEvidence, prepareMetaExperts } from '../src/evidence-registry.js';

test('V16.9 receives exact walk-forward evidence and audited counts', () => {
  const expert = enrichExpertWithEvidence({ id: 'MAIN_APP_V16_9', signal: 'BUY', score: 80 });
  assert.equal(expert.id, 'V16_9');
  assert.equal(expert.family, 'V16_9');
  assert.equal(expert.evidenceClass, 'EXACT_WALK_FORWARD');
  assert.equal(expert.oos.entered, 55);
  assert.equal(expert.oos.targetHits, 22);
  assert.equal(expert.oos.stopHits, 21);
});

test('V20 native and TFE core share one family', () => {
  assert.equal(ENGINE_EVIDENCE_REGISTRY.V20_NATIVE.family, ENGINE_EVIDENCE_REGISTRY.TFE_CORE.family);
});

test('Triple Engine is visible diagnostically but excluded from independent voting', () => {
  const prepared = prepareMetaExperts([
    { id: 'V16_9', signal: 'BUY' },
    { id: 'SEPA_X', signal: 'WATCH' },
    { id: 'GANN_FUSION_X', signal: 'BUY' },
    { id: 'TRIPLE_ENGINE', signal: 'BUY' },
  ]);
  assert.equal(prepared.allExperts.length, 4);
  assert.equal(prepared.votingExperts.length, 3);
  assert.equal(prepared.excludedCompositeExperts.length, 1);
  assert.equal(prepared.excludedCompositeExperts[0].id, 'TRIPLE_ENGINE');
});

test('unknown engine remains unmatched instead of receiving invented evidence', () => {
  const expert = enrichExpertWithEvidence({ id: 'MYSTERY_ENGINE', signal: 'BUY' });
  assert.equal(expert.registryMatched, false);
  assert.equal(expert.evidenceClass, undefined);
  assert.equal(expert.oos, undefined);
});
