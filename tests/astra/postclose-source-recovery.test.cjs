'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postCloseComplete } = require('../../scripts/stable/v16-postclose-scan-complete.cjs');
function fixture() {
  return {
    today: '2026-09-23', hour: 17,
    primary: { currentSessionReady: true, sessionDate: '2026-09-23', basketPlan: { sourceSessionReady: true } },
    scan: { pagesPublishedSession: '2026-09-23' },
    marker: { sessionDate: '2026-09-23', materialFingerprint: 'a'.repeat(64), canonicalDataHead: 'b'.repeat(40) },
    audit: { session: { decision: '2026-09-23', freshnessStatus: 'CURRENT' }, upstream: { mainAppMaterialFingerprint: 'a'.repeat(64), canonicalDataHead: 'b'.repeat(40) } }
  };
}
test('completed source and matching Astra session suppress redundant scans', () => {
  assert.equal(postCloseComplete(fixture()).skip, true);
});
test('source publication must not stop recovery after Astra rejected the new session', () => {
  const input = fixture(); input.audit.session.decision = '2026-09-22';
  assert.deepEqual(postCloseComplete(input), { sourceComplete: true, astraComplete: false, skip: false });
});
test('missing or incomplete Astra evidence keeps source recovery enabled', () => {
  for (const audit of [{}, { session: { decision: '2026-09-23' } }]) {
    assert.equal(postCloseComplete({ ...fixture(), audit }).skip, false);
  }
});
test('changed canonical snapshot or fingerprint must be consumed before no-op', () => {
  for (const field of ['canonicalDataHead', 'mainAppMaterialFingerprint']) {
    const input = fixture(); input.audit.upstream[field] = 'c'.repeat(field === 'canonicalDataHead' ? 40 : 64);
    assert.equal(postCloseComplete(input).skip, false);
  }
});
test('intraday or unpublished source remains eligible for scanning', () => {
  assert.equal(postCloseComplete({ ...fixture(), hour: 14 }).skip, false);
  assert.equal(postCloseComplete({ ...fixture(), scan: {} }).skip, false);
});
test('empty provenance never certifies completion', () => {
  const input = fixture(); input.marker = { sessionDate: input.today }; input.audit.upstream = {};
  assert.equal(postCloseComplete(input).skip, false);
});
