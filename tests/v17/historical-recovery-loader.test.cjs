'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isStaleByExpectedSessions, latestExpectedEgxSession, loadHistory, mostRecentCalendarTradingCandidate } = require('../../scripts/v17/historical-recovery/history-loader.cjs');

function fixture(document, corporate = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hrs-loader-'));
  fs.mkdirSync(path.join(root, 'data/history'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/history/TEST.json'), JSON.stringify(document));
  fs.writeFileSync(path.join(root, 'data/corporate-actions.json'), JSON.stringify({ candidates: corporate }));
  return root;
}
const session = (i, adjustedClose = 10 + i / 10) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: adjustedClose, high: adjustedClose, low: adjustedClose, close: adjustedClose, adjustedClose, volume: 1000 });

test('fails closed on insufficient history', () => {
  const root = fixture({ ticker: 'TEST', symbolVerified: true, sessions: Array.from({ length: 10 }, (_, i) => session(i)) });
  assert.match(loadHistory(root, { minimumSessions: 60 })[0].loaderReasons.join(','), /insufficient_history/);
});
test('fails closed on stale history', () => {
  const root = fixture({ ticker: 'TEST', symbolVerified: true, updateFailed: true, sessions: Array.from({ length: 60 }, (_, i) => session(i)) });
  assert.ok(loadHistory(root, { minimumSessions: 60 })[0].loaderReasons.some(reason => reason.startsWith('stale_history:')));
});
test('fails closed on missing adjustedClose', () => {
  const rows = Array.from({ length: 60 }, (_, i) => session(i)); delete rows[3].adjustedClose; rows[4].adjustedClose = null;
  const root = fixture({ ticker: 'TEST', symbolVerified: true, sessions: rows });
  assert.match(loadHistory(root, { minimumSessions: 60 })[0].loaderReasons.join(','), /missing_adjusted_close:2/);
});
test('quarantines corporate-action review symbols', () => {
  const root = fixture({ ticker: 'TEST', symbolVerified: true, sessions: Array.from({ length: 60 }, (_, i) => session(i)) }, [{ ticker: 'TEST', status: 'review_required' }]);
  assert.match(loadHistory(root, { minimumSessions: 60 })[0].loaderReasons.join(','), /corporate_action_review/);
});
test('Thursday data checked on Friday remains fresh', () => {
  assert.equal(mostRecentCalendarTradingCandidate('2026-08-07'), '2026-08-06');
  assert.equal(isStaleByExpectedSessions('2026-08-06', ['2026-08-06'], 0), false);
});
test('Thursday data checked on Saturday remains fresh', () => {
  assert.equal(mostRecentCalendarTradingCandidate('2026-08-08'), '2026-08-06');
  assert.equal(latestExpectedEgxSession('2026-08-08', ['2026-08-05', '2026-08-06']), '2026-08-06');
});
test('Thursday data checked before Sunday open remains fresh', () => {
  assert.equal(mostRecentCalendarTradingCandidate('2026-08-09', true), '2026-08-06');
  assert.equal(latestExpectedEgxSession('2026-08-09', ['2026-08-06'], true), '2026-08-06');
});
test('one missing observed trading session follows configured tolerance', () => {
  const sessions = ['2026-08-05', '2026-08-06'];
  assert.equal(isStaleByExpectedSessions('2026-08-05', sessions, 0), true);
  assert.equal(isStaleByExpectedSessions('2026-08-05', sessions, 1), false);
});
test('weekend alone never creates a missed market session', () => {
  const latest = latestExpectedEgxSession('2026-08-08', ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']);
  assert.equal(latest, '2026-08-06');
  assert.equal(isStaleByExpectedSessions('2026-08-06', ['2026-08-03', '2026-08-04', '2026-08-05', latest], 0), false);
});
