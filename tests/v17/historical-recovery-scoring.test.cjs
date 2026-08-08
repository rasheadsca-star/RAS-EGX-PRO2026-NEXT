'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateIndicators } = require('../../scripts/v17/historical-recovery/indicators.cjs');
const { classifyBottomLocation, scoreMetrics } = require('../../scripts/v17/historical-recovery/scoring.cjs');

function sessions(prices, volumes = prices.map(() => 1000)) {
  return prices.map((price, i) => ({ adjustedClose: price, close: price, open: price, high: price, low: price, volume: volumes[i], date: String(i) }));
}
function baseMetrics(overrides = {}) {
  return { drawdownFromAvailableWindowAdjustedHighPct: 30, maximumPeakToTroughDrawdownPct: 35, distanceFromAvailableWindowAdjustedLowPct: 10, repeatedLowCount: 3, bottomDurationSessions: 8, higherLowConfirmation: false, rsiRecovery: false, aboveSma20: false, aboveSma50: false, trendRecovery20Over50: false, momentum5Pct: -2, momentum20Pct: -5, momentum60Pct: -10, volumeConfirmation: false, rsi14: 42, ...overrides };
}
test('false rebound does not become confirmed recovery', () => {
  const prices = [...Array.from({ length: 60 }, (_, i) => 100 - i), 42, 43, 44, 42, 43];
  const metrics = calculateIndicators(sessions(prices));
  assert.notEqual(scoreMetrics(metrics).stage, 'RECOVERY_CONFIRMED');
});
test('higher-low recovery is detected', () => {
  const prices = [...Array.from({ length: 35 }, (_, i) => 100 - i * 1.5), ...Array.from({ length: 25 }, (_, i) => 52 + i * 0.9), ...Array.from({ length: 15 }, (_, i) => 68 + i * 1.1)];
  const metrics = calculateIndicators(sessions(prices));
  assert.equal(metrics.higherLowConfirmation, true);
  assert.equal(metrics.aboveSma20, true);
});
test('volume confirmation requires deterministic expansion', () => {
  const prices = Array.from({ length: 70 }, (_, i) => 50 + i * 0.2);
  const volumes = prices.map((_, i) => i >= 65 ? 2000 : 1000);
  assert.equal(calculateIndicators(sessions(prices, volumes), { volumeExpansionMinimum: 1.2 }).volumeConfirmation, true);
});
test('scoring is deterministic', () => {
  const prices = Array.from({ length: 70 }, (_, i) => i < 35 ? 100 - i : 65 + (i - 35) * 0.8);
  const metrics = calculateIndicators(sessions(prices));
  assert.deepEqual(scoreMetrics(metrics, { relativeRecoveryStrength: 75 }), scoreMetrics(metrics, { relativeRecoveryStrength: 75 }));
});
test('nullable momentum remains safe and deterministic', () => {
  const metrics = calculateIndicators(sessions(Array.from({ length: 60 }, (_, i) => 100 - i * 0.2)));
  const result = scoreMetrics(metrics);
  assert.equal(typeof result.recoveryStage, 'string');
  assert.ok(Number.isFinite(result.recoveryScore));
});
test('current at available-window high has zero drawdown and is not bottoming', () => {
  const metrics = calculateIndicators(sessions(Array.from({ length: 70 }, (_, i) => 50 + i)));
  assert.equal(metrics.drawdownFromAvailableWindowAdjustedHighPct, 0);
  assert.notEqual(scoreMetrics(metrics).recoveryStage, 'BOTTOMING');
});
test('distance above seventy percent cannot be bottoming or early recovery', () => {
  const result = scoreMetrics(baseMetrics({ distanceFromAvailableWindowAdjustedLowPct: 71, higherLowConfirmation: true, rsiRecovery: true, aboveSma20: true, momentum20Pct: 8 }));
  assert.equal(result.bottomClassification, 'ABOVE_BOTTOM_ZONE');
  assert.ok(!['BOTTOMING', 'EARLY_RECOVERY'].includes(result.recoveryStage));
});
test('high strength does not change bottom-location classification', () => {
  const result = scoreMetrics(baseMetrics({ drawdownFromAvailableWindowAdjustedHighPct: 2, maximumPeakToTroughDrawdownPct: 10, distanceFromAvailableWindowAdjustedLowPct: 80, higherLowConfirmation: true, rsiRecovery: true, aboveSma20: true, aboveSma50: true, trendRecovery20Over50: true, momentum5Pct: 15, momentum20Pct: 30, momentum60Pct: 50, volumeConfirmation: true, rsi14: 92 }));
  assert.equal(result.bottomClassification, 'ABOVE_BOTTOM_ZONE');
});
test('deep decline near low without reversal evidence remains deep or bottoming', () => {
  const result = scoreMetrics(baseMetrics());
  assert.ok(['NO_RECOVERY', 'BOTTOMING'].includes(result.recoveryStage));
});
test('deep decline with higher low RSI improvement and volume becomes early recovery', () => {
  const result = scoreMetrics(baseMetrics({ distanceFromAvailableWindowAdjustedLowPct: 18, higherLowConfirmation: true, rsiRecovery: true, aboveSma20: true, momentum5Pct: 5, momentum20Pct: 8, volumeConfirmation: true, rsi14: 58 }));
  assert.equal(result.recoveryStage, 'EARLY_RECOVERY');
});
test('valid recovery extended from low is classified as extended', () => {
  const result = scoreMetrics(baseMetrics({ distanceFromAvailableWindowAdjustedLowPct: 50, higherLowConfirmation: true, rsiRecovery: true, aboveSma20: true, momentum20Pct: 12, volumeConfirmation: true }));
  assert.equal(result.recoveryStage, 'RECOVERY_EXTENDED');
});
test('bottom classification boundaries are independent and deterministic', () => {
  assert.equal(classifyBottomLocation(5), 'EXTREME_BOTTOM');
  assert.equal(classifyBottomLocation(5.01), 'NEAR_BOTTOM');
  assert.equal(classifyBottomLocation(15), 'NEAR_BOTTOM');
  assert.equal(classifyBottomLocation(15.01), 'BOTTOM_ZONE');
  assert.equal(classifyBottomLocation(30), 'BOTTOM_ZONE');
  assert.equal(classifyBottomLocation(30.01), 'ABOVE_BOTTOM_ZONE');
});
