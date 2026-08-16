import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from '../src/domain/backtest.mjs';

function syntheticHistory(days = 1100) {
  const start = new Date('2021-01-01T00:00:00Z');
  let close = 100;
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    close *= 1 + (0.0009 + Math.sin(i / 17) * 0.003);
    return {
      date: date.toISOString().slice(0, 10),
      open: close * 0.998,
      high: close * 1.012,
      low: close * 0.988,
      close,
      volume: 100000 + i,
    };
  });
}

test('backtest enforces multi-year span and produces confidence interval', () => {
  const result = runBacktest(syntheticHistory(), { minYears: 2.5, minTrades: 20, transactionCostBps: 10 });
  assert.equal(result.validated, true);
  assert.ok(result.spanYears >= 2.5);
  assert.ok(result.directionalTrades >= 20);
  assert.ok(result.confidenceInterval95Pct);
});

test('short history is blocked', () => {
  const result = runBacktest(syntheticHistory(200), { minYears: 3, minTrades: 20 });
  assert.equal(result.validated, false);
  assert.ok(result.reasonCodes.includes('BACKTEST_SPAN_TOO_SHORT'));
});
