import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RISKALPHA_LIVE_POLICY,
  createLiveRecommendationLifecycle,
  advanceLiveRecommendationLifecycle,
  summarizeLiveRecommendation,
} from '../src/liveRecommendationLifecycle.js';

const rec = Object.freeze({
  ticker: 'ARAB', signalDate: '2026-08-27', category: 'PRIMARY_1', score: 64.802,
  entryLow: 0.2591, entryHigh: 0.2609, stopLoss: 0.2498, target1: 0.2739,
});

function start() {
  return createLiveRecommendationLifecycle({ recommendation: rec, createdAt: '2026-08-29T15:33:25.551Z' });
}

function obs({ at, date = '2026-08-30', open, high, low, last, closed = false }) {
  return { observedAt: at, sessionDate: date, open, high, low, last, sessionClosed: closed };
}

test('policy is research-only and has zero authority', () => {
  assert.equal(RISKALPHA_LIVE_POLICY.productionAuthority, false);
  assert.equal(RISKALPHA_LIVE_POLICY.scoringImpact, 'NONE');
  assert.equal(RISKALPHA_LIVE_POLICY.alphaWeight, 0);
  assert.equal(RISKALPHA_LIVE_POLICY.outcomeRetuningAllowed, false);
});

test('original recommendation remains immutable in lifecycle summary', () => {
  let x = start();
  x = advanceLiveRecommendationLifecycle({ lifecycle: x, observation: obs({
    at: '2026-08-30T07:05:00Z', open: 0.2600, high: 0.2610, low: 0.2595, last: 0.2605,
  }) });
  const s = summarizeLiveRecommendation(x);
  assert.deepEqual(s.originalEntryZone, [0.2591, 0.2609]);
  assert.equal(s.originalStop, 0.2498);
  assert.equal(s.originalTarget1, 0.2739);
  assert.equal(s.originalRecommendationChanged, false);
});

test('gap-down recovery trap is vetoed before any later recovery fill', () => {
  const x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T07:01:00Z', open: 0.2580, high: 0.2605, low: 0.2570, last: 0.2600,
  }) });
  assert.equal(x.status, 'VETOED');
  assert.equal(x.action, 'VETO');
  assert.equal(x.entryPrice, null);
});

test('valid next open can wait for entry zone touch without inventing a fill', () => {
  const x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T07:02:00Z', open: 0.2630, high: 0.2640, low: 0.2620, last: 0.2635,
  }) });
  assert.equal(x.status, 'ALLOW');
  assert.equal(x.action, 'WAIT_ENTRY');
  assert.equal(x.entryPrice, null);
});

test('entry fill follows the frozen next-session zone rule', () => {
  const x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T08:00:00Z', open: 0.2630, high: 0.2640, low: 0.2600, last: 0.2610,
  }) });
  assert.equal(x.entryPrice, 0.2609);
  assert.ok(['ENTERED', 'PROTECT_PROFIT'].includes(x.status));
});

test('same observation target and stop resolves stop-first', () => {
  const x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T08:15:00Z', open: 0.2600, high: 0.2750, low: 0.2480, last: 0.2700,
  }) });
  assert.equal(x.status, 'STOP');
  assert.equal(x.reason, 'STOP_FIRST_SAME_OBSERVATION');
});

test('1R protection is not retroactively active inside the same observation', () => {
  let x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T07:10:00Z', open: 0.2600, high: 0.2705, low: 0.2595, last: 0.2680,
  }) });
  assert.equal(x.status, 'PROTECT_PROFIT');
  assert.equal(x.managedStop, 0.2498);
  assert.equal(x.protectionActiveFromObservation, 'NEXT_OBSERVATION');

  x = advanceLiveRecommendationLifecycle({ lifecycle: x, observation: obs({
    at: '2026-08-30T07:20:00Z', open: 0.2680, high: 0.2690, low: 0.2590, last: 0.2600,
  }) });
  assert.equal(x.status, 'EXIT_PROTECT');
  assert.equal(x.managedStop, 0.26);
});

test('observations must be monotonic to prevent time-travel rewriting', () => {
  let x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T08:00:00Z', open: 0.2600, high: 0.2610, low: 0.2595, last: 0.2605,
  }) });
  assert.throws(() => advanceLiveRecommendationLifecycle({ lifecycle: x, observation: obs({
    at: '2026-08-30T07:59:59Z', open: 0.2600, high: 0.2610, low: 0.2595, last: 0.2605,
  }) }), /NON_MONOTONIC_OBSERVATION/);
});

test('entry window expires after next session only', () => {
  let x = advanceLiveRecommendationLifecycle({ lifecycle: start(), observation: obs({
    at: '2026-08-30T08:00:00Z', open: 0.2630, high: 0.2640, low: 0.2620, last: 0.2630,
  }) });
  x = advanceLiveRecommendationLifecycle({ lifecycle: x, observation: obs({
    at: '2026-08-31T08:00:00Z', date: '2026-08-31', open: 0.2600, high: 0.2610, low: 0.2595, last: 0.2600,
  }) });
  assert.equal(x.status, 'NO_ENTRY');
  assert.equal(x.action, 'EXPIRED');
});
