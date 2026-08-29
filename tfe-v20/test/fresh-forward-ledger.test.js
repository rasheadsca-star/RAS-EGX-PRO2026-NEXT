import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_FORWARD_POLICY,
  buildFreshForwardSnapshot,
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
