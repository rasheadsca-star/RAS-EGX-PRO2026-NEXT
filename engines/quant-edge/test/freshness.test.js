'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const freshness = require('../session-freshness');
const feed = require('../feed');

test('before Cairo completion cutoff the previous EGX session is required', () => {
  const d = freshness.lastCompletedEgxSession(new Date('2026-08-17T08:34:00Z')); // 11:34 Cairo Monday
  assert.equal(d, '2026-08-16');
});

test('after Cairo completion cutoff the current EGX session is required', () => {
  const d = freshness.lastCompletedEgxSession(new Date('2026-08-17T12:10:00Z')); // 15:10 Cairo Monday
  assert.equal(d, '2026-08-17');
});

test('Friday resolves to previous Thursday session', () => {
  const d = freshness.lastCompletedEgxSession(new Date('2026-08-21T09:00:00Z'));
  assert.equal(d, '2026-08-20');
});

test('freshness guard counts trading-session lag and fails closed', () => {
  const r = freshness.evaluateFreshness('2026-08-13', new Date('2026-08-17T08:34:00Z'));
  assert.equal(r.requiredSession, '2026-08-16');
  assert.equal(r.lagSessions, 1);
  assert.equal(r.isFresh, false);
});

test('configured EGX holidays are skipped conservatively', () => {
  const holidays = new Set(['2026-08-16']);
  const d = freshness.lastCompletedEgxSession(new Date('2026-08-17T08:34:00Z'), { holidays });
  assert.equal(d, '2026-08-13');
});

test('StockAnalysis daily history parser normalizes OHLCV', () => {
  const html = '<table><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Adj. Close</th><th>Change</th><th>Volume</th></tr><tr><td>Aug 16, 2026</td><td>100.00</td><td>104.00</td><td>99.00</td><td>103.50</td><td>103.50</td><td>3.50%</td><td>1,250,000</td></tr></table>';
  const rows = feed.parseStockAnalysisHistory(html);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { date: '2026-08-16', open: 100, high: 104, low: 99, close: 103.5, volume: 1250000 });
});
