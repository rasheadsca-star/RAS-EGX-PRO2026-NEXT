import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRegisteredMetaCandidate } from '../src/meta-pipeline.js';

const plan = { entryLow: 99, entryHigh: 101, stop: 95, target1: 106, target2: 110, structuralNetRR: 1.5, alignmentState: 'IN_ENTRY_RANGE' };
const quality = { score: 95, state: 'READY', staleData: false };
const liquidity = { score: 90 };
const market = { regime: 'BULL', confidence: 90 };

test('canonical pipeline excludes Triple composite from voting', () => {
  const result = evaluateRegisteredMetaCandidate({
    ticker: 'AAA', quality, liquidity, market, tradePlan: plan,
    experts: [
      { id: 'V16_9', signal: 'BUY', score: 85 },
      { id: 'SEPA_X', signal: 'BUY', score: 85 },
      { id: 'TRIPLE_ENGINE', signal: 'BUY', score: 100 },
    ],
  });
  assert.deepEqual(result.evidenceRegistry.excludedCompositeExperts, ['TRIPLE_ENGINE']);
  assert.equal(result.independentFamilyCount, 2);
});

test('unknown data quality fails closed', () => {
  const result = evaluateRegisteredMetaCandidate({
    ticker: 'AAA', quality: { state: 'READY' }, liquidity, market, tradePlan: plan,
    experts: [{ id: 'V16_9', signal: 'BUY' }, { id: 'SEPA_X', signal: 'BUY' }],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('DATA_QUALITY_UNKNOWN'));
});

test('unknown liquidity fails closed', () => {
  const result = evaluateRegisteredMetaCandidate({
    ticker: 'AAA', quality, liquidity: {}, market, tradePlan: plan,
    experts: [{ id: 'V16_9', signal: 'BUY' }, { id: 'SEPA_X', signal: 'BUY' }],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('LIQUIDITY_UNKNOWN'));
});

test('missing trade plan fails closed', () => {
  const result = evaluateRegisteredMetaCandidate({
    ticker: 'AAA', quality, liquidity, market,
    experts: [{ id: 'V16_9', signal: 'BUY' }, { id: 'SEPA_X', signal: 'BUY' }],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('TRADE_PLAN_UNAVAILABLE'));
});

test('unknown structural RR fails closed', () => {
  const result = evaluateRegisteredMetaCandidate({
    ticker: 'AAA', quality, liquidity, market, tradePlan: { ...plan, structuralNetRR: undefined },
    experts: [{ id: 'V16_9', signal: 'BUY' }, { id: 'SEPA_X', signal: 'BUY' }],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('STRUCTURAL_RR_UNKNOWN'));
});
