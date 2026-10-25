'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE, hash, acceptedManifest, reconcile, verifyManifest } = require('../../scripts/stable/history-quarantine-policy.cjs');
const day = '2026-10-25';
const row = (source = SOURCE, date = day, close = 683.5) => ({ ticker: 'MIPH', date, source, close, primarySource: 'mubasher_symbol_pages_precise_enriched' });
const doc = (...sessions) => ({ sessions, availableSessions: sessions.length, lastSession: day, priceTruthLatest: { date: day } });
test('accept -> reject quarantines only current session with exact source', () => {
  const old = row(SOURCE, '2026-10-22', 742.36), today = row();
  const other = row('independent_approved', day, 681);
  const x = reconcile({ document: doc(old, other, today), ticker:'MIPH', expectedSession:day, manifest:[] });
  assert.equal(x.quarantined.length, 1); assert.equal(x.quarantined[0].rowSha256, hash(today));
  assert.deepEqual(x.document.sessions,[old,other]); assert.equal(x.document.lastSession,day);
  assert.equal(x.document.priceTruthLatest.close,other.close);
});
test('wrong source or previous session cannot be quarantined', () => {
  const a=row('other',day), b=row(SOURCE,'2026-10-22');
  assert.equal(reconcile({ document:doc(a,b),ticker:'MIPH',expectedSession:day,manifest:[] }).quarantined.length,0);
});
test('accepted current row stays and matches full manifest hash', () => {
  const accepted = row(), manifest=acceptedManifest([accepted]);
  const out=reconcile({document:doc(accepted),ticker:'MIPH',expectedSession:day,manifest});
  assert.equal(out.quarantined.length,0);
  assert.equal(verifyManifest(manifest,{MIPH:out.document}),true);
});
test('hash validation detects stale, wrong or missing accepted candle', () => {
  const r=row(); const m=acceptedManifest([r]);
  assert.throws(()=>verifyManifest(m,{MIPH:doc(row(SOURCE,day,680))}),/MANIFEST_HISTORY_HASH_MISMATCH/);
  assert.throws(()=>verifyManifest(m,{}),/MANIFEST_HISTORY_HASH_MISMATCH/);
});
test('duplicate accepted ticker fails closed',()=>{
  assert.throws(()=>acceptedManifest([row(),row()]),/DUPLICATE_ACCEPTED_TICKER/);
});
test('rejection is idempotent after the quarantined candle is removed',()=>{
  const first=reconcile({document:doc(row()),ticker:'MIPH',expectedSession:day,manifest:[]});
  const second=reconcile({document:first.document,ticker:'MIPH',expectedSession:day,manifest:[]});
  assert.equal(first.quarantined.length,1); assert.equal(second.quarantined.length,0);
});
