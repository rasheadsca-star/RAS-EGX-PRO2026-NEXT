import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_FORWARD_POLICY,
  buildFreshForwardSnapshot,
  summarizeFreshForward,
  verifyFreshForwardSnapshot,
} from '../sidecars/fresh-forward-ledger.js';

const input = {
  signalSessionDate: '2026-08-27',
  capturedAt: '2026-08-29T15:19:00.000Z',
  nextSessionOpenAt: '2026-08-30T07:00:00.000Z',
  sourceCommit: '666a3738f634fb86e4d93e3360cd84a027aa1830',
  sources: {
    v16: { url: 'https://example.test/v16.json', digestSha256: 'a'.repeat(64), sessionDate: '2026-08-27' },
    meta: { url: 'file:meta-live-shadow.json', digestSha256: 'b'.repeat(64), sessionDate: '2026-08-27' },
  },
  v16Payload: {
    sessionDate: '2026-08-27',
    recommendations: [{ ticker: 'TEST', rank: 1, category: 'PRIMARY_1', entryLow: 100, entryHigh: 101, stopLoss: 95, target1: 110 }],
  },
  metaShadowPayload: {
    sessionDate: '2026-08-27',
    rows: [{ ticker: 'TEST', decision: 'READY', metaScore: 77, gates: { blocking: [] } }],
  },
};

test('fresh-forward policy is immutable research-only evidence', () => {
  assert.equal(FRESH_FORWARD_POLICY.entryRule, 'NEXT_SESSION_ONLY');
  assert.equal(FRESH_FORWARD_POLICY.maxHoldSessions, 3);
  assert.equal(FRESH_FORWARD_POLICY.roundTripCostPct, 0.60);
  assert.equal(FRESH_FORWARD_POLICY.sameBarTargetStop, 'STOP_FIRST');
  assert.equal(FRESH_FORWARD_POLICY.scoringImpact, 'NONE');
  assert.equal(FRESH_FORWARD_POLICY.productionAuthority, false);
});

test('snapshot verifies before any mutation', () => {
  const snapshot = buildFreshForwardSnapshot(input);
  assert.deepEqual(verifyFreshForwardSnapshot(snapshot), { ok: true, errors: [] });
});

test('post-capture mutation is detected', () => {
  const snapshot = structuredClone(buildFreshForwardSnapshot(input));
  snapshot.v16Signals[0].target1 = 999;
  const verdict = verifyFreshForwardSnapshot(snapshot);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.includes('SNAPSHOT_HASH'));
});

test('capture at or after next-session open is rejected', () => {
  assert.throws(() => buildFreshForwardSnapshot({ ...input, capturedAt: input.nextSessionOpenAt }), /CAPTURE_NOT_PRE_OUTCOME/);
});

test('NO_TRADE veto value is measured as avoided loss minus missed gain and grants no promotion', () => {
  const summary = summarizeFreshForward([
    { ticker: 'LOSS', category: 'PRIMARY_1', metaDecision: 'NO_TRADE', status: 'STOP', resolved: true, netReturnPct: -4 },
    { ticker: 'GAIN', category: 'PRIMARY_2', metaDecision: 'NO_TRADE', status: 'TARGET1', resolved: true, netReturnPct: 2 },
    { ticker: 'READY', category: 'PRIMARY_3', metaDecision: 'READY', status: 'TARGET1', resolved: true, netReturnPct: 3 },
    { ticker: 'COND', category: 'CONDITIONAL', metaDecision: 'NO_TRADE', status: 'STOP', resolved: true, netReturnPct: -5 },
  ]);
  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.resolvedVetoes, 2);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.lossesAvoided, 1);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.gainsMissed, 1);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.lossAvoidanceHitRatePct, 50);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.avoidedLossPct, 4);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.missedGainPct, 2);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.counterfactualNetBenefitPct, 2);
  assert.equal(summary.metaNoTradeVetoOnV16Primary.averageCounterfactualBenefitPct, 1);
});
