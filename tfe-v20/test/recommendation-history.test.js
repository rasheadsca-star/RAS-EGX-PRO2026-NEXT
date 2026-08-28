import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublishedRecommendation, summarizePublishedHistory } from '../src/recommendationHistory.js';

const rec = {
  sessionDate:'2026-08-19', rank:1, ticker:'TEST', decision:'RESEARCH_CANDIDATE', publicationState:'RESEARCH_CANDIDATE',
  entryLow:10, entryHigh:10.2, stop:9.5, target1:11, target2:12,
};

function rows(after=[]) {
  return [
    {date:'2026-08-18',open:9.7,high:10,low:9.6,close:9.9,volume:100},
    {date:'2026-08-19',open:9.9,high:10.4,low:9.8,close:10.3,volume:100},
    ...after,
  ];
}

test('published history enters only after signal and resolves T1 with original plan', () => {
  const out = evaluatePublishedRecommendation(rec, rows([
    {date:'2026-08-20',open:10.1,high:11.2,low:10,close:11.1,volume:100},
  ]));
  assert.equal(out.entered, true);
  assert.equal(out.entryDate, '2026-08-20');
  assert.equal(out.entryPrice, 10.1);
  assert.equal(out.outcome, 'TARGET1');
  assert.equal(out.target1Hit, true);
  assert.equal(out.stopHit, false);
  assert.equal(out.sessionsToEntry, 1);
  assert.equal(out.sessionsToTarget1, 1);
  assert.equal(out.netPct, 8.31);
});

test('same-bar target and stop ambiguity is conservative stop-first', () => {
  const out = evaluatePublishedRecommendation(rec, rows([
    {date:'2026-08-20',open:10.1,high:11.5,low:9.4,close:10.5,volume:100},
  ]));
  assert.equal(out.outcome, 'STOP_SAME_BAR');
  assert.equal(out.stopHit, true);
  assert.equal(out.target1Hit, false);
  assert.equal(out.exitPrice, 9.5);
});

test('signal expires without entry after configured entry window', () => {
  const out = evaluatePublishedRecommendation(rec, rows([
    {date:'2026-08-20',open:9.4,high:9.9,low:9.2,close:9.8,volume:100},
    {date:'2026-08-23',open:9.6,high:9.95,low:9.3,close:9.8,volume:100},
    {date:'2026-08-24',open:9.7,high:9.99,low:9.5,close:9.9,volume:100},
  ]));
  assert.equal(out.entered, false);
  assert.equal(out.outcome, 'EXPIRED_NO_ENTRY');
});

test('entered unresolved position remains OPEN when hold window is not mature', () => {
  const out = evaluatePublishedRecommendation(rec, rows([
    {date:'2026-08-20',open:10.1,high:10.5,low:10,close:10.3,volume:100},
    {date:'2026-08-23',open:10.3,high:10.7,low:10.1,close:10.6,volume:100},
  ]));
  assert.equal(out.outcome, 'OPEN');
  assert.equal(out.entered, true);
  assert.equal(out.exitDate, null);
  assert.equal(out.currentMarkPrice, 10.6);
});

test('summary reports T1, stop, no-entry, average return and planned distances', () => {
  const target = evaluatePublishedRecommendation(rec, rows([
    {date:'2026-08-20',open:10.1,high:11.2,low:10,close:11.1,volume:100},
  ]));
  const stop = evaluatePublishedRecommendation({...rec,ticker:'STOP'}, rows([
    {date:'2026-08-20',open:10.1,high:10.4,low:9.4,close:9.6,volume:100},
  ]));
  const noEntry = evaluatePublishedRecommendation({...rec,ticker:'NONE'}, rows([
    {date:'2026-08-20',open:9.4,high:9.9,low:9.2,close:9.8,volume:100},
    {date:'2026-08-23',open:9.6,high:9.95,low:9.3,close:9.8,volume:100},
    {date:'2026-08-24',open:9.7,high:9.99,low:9.5,close:9.9,volume:100},
  ]));
  const s = summarizePublishedHistory([target,stop,noEntry]);
  assert.equal(s.totalSignals, 3);
  assert.equal(s.entered, 2);
  assert.equal(s.resolved, 2);
  assert.equal(s.expiredNoEntry, 1);
  assert.equal(s.target1HitPct, 50);
  assert.equal(s.stopPct, 50);
  assert.equal(s.entryRatePct, 66.7);
  assert.ok(Number.isFinite(s.avgNetPct));
  assert.ok(Number.isFinite(s.avgPlannedTarget1Pct));
  assert.ok(Number.isFinite(s.avgPlannedStopPct));
});
