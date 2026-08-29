import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMetaCandidate, expertReliability, rankMetaCandidates } from '../src/meta-engine.js';

const plan = { entryLow: 99, entryHigh: 101, stop: 95, target1: 106, target2: 110, structuralNetRR: 1.5, alignmentState: 'IN_ENTRY_RANGE' };
const quality = { score: 95, state: 'READY', staleData: false };
const liquidity = { score: 90 };
const market = { regime: 'BULL', confidence: 90 };

function expert(id, signal, evidenceClass, score = 85, oos = {}) {
  return { id, signal, evidenceClass, score, dataQuality: 95, oos };
}

test('hard data-quality block cannot be bypassed by unanimous bullish experts', () => {
  const result = evaluateMetaCandidate({
    ticker: 'AAA', quality: { score: 100, state: 'BLOCKED' }, liquidity, market, tradePlan: plan,
    experts: [
      expert('TFE', 'BUY', 'FRESH_INDEPENDENT_FORWARD'),
      expert('SEPA', 'BUY', 'EXACT_WALK_FORWARD'),
      expert('GANN', 'BUY', 'NATIVE_RECORDED_LIVE'),
    ],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('DATA_QUALITY_BLOCKED'));
});

test('structural RR below policy floor blocks otherwise strong consensus', () => {
  const result = evaluateMetaCandidate({
    ticker: 'AAA', quality, liquidity, market,
    tradePlan: { ...plan, structuralNetRR: 0.4 },
    experts: [expert('TFE', 'BUY', 'FRESH_INDEPENDENT_FORWARD'), expert('SEPA', 'BUY', 'EXACT_WALK_FORWARD')],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('STRUCTURAL_RR_LOW'));
});

test('fresh forward evidence outweighs conflicting proxy evidence', () => {
  const result = evaluateMetaCandidate({
    ticker: 'AAA', quality, liquidity, market, tradePlan: plan,
    experts: [
      expert('TFE', 'BUY', 'FRESH_INDEPENDENT_FORWARD', 92, { entered: 40, targetHits: 24, stopHits: 8, profitFactor: 1.8, avgNetPct: 1.4 }),
      expert('GANN_PROXY', 'SELL', 'PROXY_RECONSTRUCTION', 95, { entered: 5, targetHits: 1, stopHits: 3, profitFactor: 0.7, avgNetPct: -0.8 }),
    ],
  });
  assert.ok(result.edgeScore > 0);
  const tfe = result.experts.find((x) => x.id === 'TFE');
  const gann = result.experts.find((x) => x.id === 'GANN_PROXY');
  assert.ok(tfe.reliability > gann.reliability);
});

test('missing OOS fields are omitted rather than converted to fabricated zero performance', () => {
  const withMissing = expertReliability(expert('SEPA', 'BUY', 'SNAPSHOT_CURRENT_ONLY', 80, {}));
  const explicitlyBad = expertReliability(expert('SEPA', 'BUY', 'SNAPSHOT_CURRENT_ONLY', 80, { entered: 30, targetHits: 0, stopHits: 30, profitFactor: 0, avgNetPct: -5 }));
  assert.equal(withMissing.statisticalReliability, null);
  assert.ok(withMissing.reliability > explicitlyBad.reliability);
});

test('high expert disagreement forces abstention', () => {
  const result = evaluateMetaCandidate({
    ticker: 'AAA', quality, liquidity, market, tradePlan: plan,
    experts: [
      expert('TFE', 'BUY', 'EXACT_WALK_FORWARD', 90),
      expert('SEPA', 'SELL', 'EXACT_WALK_FORWARD', 90),
    ],
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.blocks.includes('EXPERT_DISAGREEMENT_HIGH') || result.blocks.includes('NON_POSITIVE_CONSENSUS_EDGE'));
});

test('missing third engine is not treated as a negative vote', () => {
  const two = evaluateMetaCandidate({
    ticker: 'AAA', quality, liquidity, market, tradePlan: plan,
    experts: [expert('TFE', 'BUY', 'FRESH_INDEPENDENT_FORWARD', 95), expert('SEPA', 'BUY', 'EXACT_WALK_FORWARD', 90)],
  });
  const three = evaluateMetaCandidate({
    ticker: 'AAA', quality, liquidity, market, tradePlan: plan,
    experts: [expert('TFE', 'BUY', 'FRESH_INDEPENDENT_FORWARD', 95), expert('SEPA', 'BUY', 'EXACT_WALK_FORWARD', 90), expert('GANN', 'UNKNOWN', 'UNKNOWN', 0)],
  });
  assert.equal(two.edgeScore, three.edgeScore);
  assert.equal(two.agreement, three.agreement);
});

test('ranking favors actionable decision then edge/confidence', () => {
  const ranked = rankMetaCandidates([
    { ticker: 'BBB', quality, liquidity, market: { regime: 'NEUTRAL', confidence: 70 }, tradePlan: plan, experts: [expert('TFE', 'READY', 'EXACT_WALK_FORWARD', 75), expert('SEPA', 'READY', 'REUSED_HOLDOUT', 72)] },
    { ticker: 'AAA', quality, liquidity, market, tradePlan: plan, experts: [expert('TFE', 'BUY', 'FRESH_INDEPENDENT_FORWARD', 98), expert('SEPA', 'BUY', 'EXACT_WALK_FORWARD', 95)] },
  ]);
  assert.equal(ranked[0].ticker, 'AAA');
  assert.equal(ranked[0].rank, 1);
});
