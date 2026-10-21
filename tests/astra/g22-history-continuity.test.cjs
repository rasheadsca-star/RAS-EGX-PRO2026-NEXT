'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mergeFinalizedHistory: merge} = require('../../scripts/astra/g22-history-continuity.cjs');
const bar = (date, close=10) => ({date, open:close, high:close+1, low:close-1, close, volume:100, validationStatus:'precise_public_source_session_confirmed'});
const baseline = {ticker:'TEST', sessions:[bar('2026-09-17')]};
const observed = ['2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-27','2026-09-28'];

test('replays every intervening observed session instead of only the last day', () => {
  const source = {sessions:[bar('2026-09-17',99), ...observed.map(d=>bar(d)), bar('2026-09-29')]};
  const original = JSON.stringify(baseline);
  const result = merge(baseline,source,'2026-09-28');
  assert.deepEqual(result.sessions.map(r=>r.date),['2026-09-17',...observed]);
  assert.equal(result.sessions[0].close,10);
  assert.equal(result.historyOverlay.appendedSessions,7);
  assert.equal(JSON.stringify(baseline),original);
});

test('does not invent absent bars, weekends or a missing current session', () => {
  assert.equal(merge(baseline,{sessions:[bar('2026-09-20')]},'2026-09-28'),null);
  const result = merge(baseline,{sessions:[bar('2026-09-28')]},'2026-09-28');
  assert.equal(result.sessions.length,2);
});

test('rejects a corrupt intervening bar even when the final bar is valid', () => {
  for (const invalid of [
    {...bar('2026-09-21'),validationStatus:'quarantined'},
    {...bar('2026-09-21'),high:8},
    {...bar('2026-09-21'),volume:null}
  ]) assert.throws(()=>merge(baseline,{sessions:[invalid,bar('2026-09-28')]},'2026-09-28'),/Invalid intervening history/);
});

test('rejects duplicate appended sessions and non-forward handoffs', () => {
  assert.throws(()=>merge(baseline,{sessions:[bar('2026-09-28'),bar('2026-09-28')]},'2026-09-28'),/Invalid intervening history/);
  assert.throws(()=>merge(baseline,{sessions:[]},'2026-09-17'),/must follow/);
});
