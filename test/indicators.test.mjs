import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatures, labelFromScore, WEIGHTS } from '../src/domain/indicators.mjs';

function bars(count, step = 0.3) {
  let close = 100;
  return Array.from({ length: count }, (_, i) => {
    close += step + Math.sin(i / 5) * 0.08;
    return { date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`, open: close - .2, high: close + .6, low: close - .6, close };
  });
}

test('weights sum to exactly 1', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 1);
});

test('feature builder returns bounded, transparent component scores', () => {
  const result = buildFeatures(bars(100));
  assert.ok(Number.isFinite(result.finalScore));
  for (const score of Object.values(result.componentScores)) {
    assert.ok(score >= -100 && score <= 100);
  }
  assert.deepEqual(result.weights, WEIGHTS);
});

test('decision thresholds are fixed', () => {
  assert.equal(labelFromScore(35), 'BUY');
  assert.equal(labelFromScore(-35), 'SELL');
  assert.equal(labelFromScore(0), 'HOLD');
});
