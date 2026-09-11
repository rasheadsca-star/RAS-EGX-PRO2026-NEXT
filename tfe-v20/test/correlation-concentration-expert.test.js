import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRELATION_CONCENTRATION_POLICY,
  pearsonCorrelation,
  assessCorrelationConcentration,
} from '../src/correlationConcentrationExpert.js';

function series(values, start = 1) {
  return values.map((returnPct, i) => ({ date: `2026-01-${String(start + i).padStart(2, '0')}`, returnPct }));
}

test('policy is zero-authority and frozen', () => {
  assert.equal(CORRELATION_CONCENTRATION_POLICY.lookbackReturns, 20);
  assert.equal(CORRELATION_CONCENTRATION_POLICY.minimumCommonReturnsPerPair, 15);
  assert.equal(CORRELATION_CONCENTRATION_POLICY.medianPairwiseCorrelationWatchThreshold, 0.60);
  assert.equal(CORRELATION_CONCENTRATION_POLICY.scoringImpact, 'NONE');
  assert.equal(CORRELATION_CONCENTRATION_POLICY.alphaWeight, 0);
  assert.equal(CORRELATION_CONCENTRATION_POLICY.productionAuthority, false);
  assert.equal(CORRELATION_CONCENTRATION_POLICY.retuningAllowedAfterOutcome, false);
});

test('pearson correlation recognizes perfect same and inverse paths', () => {
  assert.ok(Math.abs(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
  assert.ok(Math.abs(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12);
});

test('highly correlated three-stock basket is watched', () => {
  const base = Array.from({ length: 20 }, (_, i) => ((i % 5) - 2) * 0.7 + i * 0.03);
  const result = assessCorrelationConcentration({
    returnSeriesByTicker: {
      AAA: series(base),
      BBB: series(base.map((x, i) => x * 1.05 + (i % 2 ? 0.02 : -0.02))),
      CCC: series(base.map((x, i) => x * 0.95 + (i % 3 ? 0.01 : -0.01))),
    },
  });
  assert.equal(result.decision, 'CORRELATED_BASKET_WATCH');
  assert.ok(result.medianPairwiseCorrelation >= 0.60);
  assert.equal(result.eligiblePairs, 3);
});

test('mixed basket passes when median correlation is below threshold', () => {
  const a = Array.from({ length: 20 }, (_, i) => Math.sin(i));
  const b = Array.from({ length: 20 }, (_, i) => Math.cos(i * 1.7));
  const c = Array.from({ length: 20 }, (_, i) => ((i * 7) % 11) - 5);
  const result = assessCorrelationConcentration({
    returnSeriesByTicker: { AAA: series(a), BBB: series(b), CCC: series(c) },
  });
  assert.equal(result.decision, 'PASS');
  assert.ok(result.medianPairwiseCorrelation < 0.60);
});

test('insufficient common observations returns unavailable', () => {
  const result = assessCorrelationConcentration({
    returnSeriesByTicker: {
      AAA: series(Array.from({ length: 10 }, (_, i) => i)),
      BBB: series(Array.from({ length: 10 }, (_, i) => i + 1)),
      CCC: series(Array.from({ length: 10 }, (_, i) => i + 2)),
    },
  });
  assert.equal(result.decision, 'UNAVAILABLE');
});
