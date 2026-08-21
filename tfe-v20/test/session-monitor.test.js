import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMubasherStockPage } from '../monitor/session-quote.js';
import { evaluateFrozenCandidate, marketPhase, quoteFreshness, MONITOR_POLICY } from '../public/session-monitor-core.js';

const sampleHtml = `
<html><body>
<h1>Test Company (TEST)</h1>
<div>Last update: 20 August 10:15 AM market time.</div>
<div>10.10</div><div>0.10</div><div>1.00%</div>
<div>Open 10.00</div><div>Previous Close 10.00</div><div>High 10.30</div><div>Low 9.95</div>
<div>Stock Statistics</div><div>Volume 1,234,567</div><div>Turnover 12,345,678.50</div>
<div>All data are 15 minutes late during market session</div>
</body></html>`;

test('Mubasher quote parser extracts delayed session OHLC without inventing values', () => {
  const q = parseMubasherStockPage(sampleHtml, 'TEST', new Date('2026-08-20T07:20:00Z'));
  assert.equal(q.ticker, 'TEST');
  assert.equal(q.sourceSessionDate, '2026-08-20');
  assert.equal(q.sourceMarketTime, '10:15');
  assert.equal(q.sourceMarketMinutes, 615);
  assert.equal(q.price, 10.1);
  assert.equal(q.open, 10);
  assert.equal(q.high, 10.3);
  assert.equal(q.low, 9.95);
  assert.equal(q.volume, 1234567);
  assert.equal(q.turnover, 12345678.5);
  assert.equal(q.delayedMinutes, 15);
  assert.equal(q.scoringImpact, 'NONE');
});

test('market phase uses Cairo session window and does not claim live before open', () => {
  assert.equal(marketPhase(new Date('2026-08-20T06:45:00Z')).phase, 'PRE_OPEN');
  assert.equal(marketPhase(new Date('2026-08-20T07:30:00Z')).phase, 'OPEN');
  assert.equal(marketPhase(new Date('2026-08-20T12:00:00Z')).phase, 'POST_CLOSE');
});

test('previous-session quote is explicitly reference-only before open', () => {
  const f = quoteFreshness({ sourceSessionDate:'2026-08-19', sourceMarketMinutes:809, delayedMinutes:15 }, new Date('2026-08-20T06:45:00Z'));
  assert.equal(f.state, 'PRE_OPEN_REFERENCE');
});

test('missed entry can still record directional T1/T2 touches without counting a trade', () => {
  const signal = { sessionDate:'2026-08-19', ticker:'COPR', price:0.48, entryLow:0.4567, entryHigh:0.4655, stop:0.4404, target1:0.4879, target2:0.5167 };
  const history = [{date:'2026-08-20',open:0.48,high:0.55,low:0.47,close:0.52}];
  const r = evaluateFrozenCandidate(signal, history, null, new Date('2026-08-21T16:00:00Z'));
  assert.equal(r.entered, false);
  assert.equal(r.target1TouchedWithoutEntry, true);
  assert.equal(r.target2TouchedWithoutEntry, true);
  assert.equal(r.target1TouchDateWithoutEntry, '2026-08-20');
  assert.equal(r.target2TouchDateWithoutEntry, '2026-08-20');
});

test('candidate monitor never enters on the signal session', () => {
  const signal = { sessionDate:'2026-08-19', ticker:'TEST', price:10.1, entryLow:10, entryHigh:10.2, stop:9.5, target1:11, target2:12 };
  const history = [{date:'2026-08-19',open:10.1,high:11.5,low:9.4,close:10.5}];
  const r = evaluateFrozenCandidate(signal, history, null, new Date('2026-08-20T06:45:00Z'));
  assert.equal(r.entered, false);
  assert.equal(r.sessionsObserved, 0);
});

test('candidate monitor applies STOP_FIRST on same-session stop/target ambiguity', () => {
  const signal = { sessionDate:'2026-08-19', ticker:'TEST', price:10.4, entryLow:10, entryHigh:10.2, stop:9.5, target1:11, target2:12 };
  const quote = { sourceSessionDate:'2026-08-20', sourceMarketMinutes:630, delayedMinutes:15, open:10.3, high:11.2, low:9.4, price:10.8 };
  const r = evaluateFrozenCandidate(signal, [], quote, new Date('2026-08-20T07:35:00Z'));
  assert.equal(r.entered, true);
  assert.equal(r.entryDate, '2026-08-20');
  assert.equal(r.state, 'STOP_SAME_BAR');
  assert.equal(r.stopFirstApplied, true);
  assert.ok(r.netPct < 0);
});

test('candidate monitor tracks an open position without altering the recommendation', () => {
  const signal = { sessionDate:'2026-08-19', ticker:'TEST', price:10.4, entryLow:10, entryHigh:10.2, stop:9.5, target1:11, target2:12 };
  const quote = { sourceSessionDate:'2026-08-20', sourceMarketMinutes:630, delayedMinutes:15, open:10.1, high:10.4, low:10.0, price:10.3 };
  const r = evaluateFrozenCandidate(signal, [], quote, new Date('2026-08-20T07:35:00Z'));
  assert.equal(r.state, 'POSITION_OPEN');
  assert.equal(r.entered, true);
  assert.equal(r.scoringImpact, 'NONE');
  assert.equal(r.recommendationMutationAllowed, false);
  assert.equal(r.executionAllowed, false);
});

test('monitor contract is five-minute polling and remains non-execution', () => {
  assert.equal(MONITOR_POLICY.pollingMs, 300000);
  assert.equal(MONITOR_POLICY.entryExpirySessions, 3);
  assert.equal(MONITOR_POLICY.maxHoldSessions, 10);
  assert.equal(MONITOR_POLICY.roundTripCostPct, 0.60);
  assert.equal(MONITOR_POLICY.scoringImpact, 'NONE');
  assert.equal(MONITOR_POLICY.recommendationMutationAllowed, false);
  assert.equal(MONITOR_POLICY.executionAllowed, false);
});

test('session monitor runtime is isolated from Alpha modules', async () => {
  const [client, core, endpoint, html] = await Promise.all([
    readFile(new URL('../public/session-monitor.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/session-monitor-core.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/session-monitor.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  ]);
  const joined = `${client}\n${core}\n${endpoint}`;
  assert.equal(/src\/(engine|policy|confidence|originalScore|originalIndicators)/.test(joined), false);
  assert.equal(/automaticOrders\s*[:=]\s*true/i.test(joined), false);
  assert.equal(/executionAllowed\s*[:=]\s*true/i.test(joined), false);
  assert.ok(client.includes('ARCHIVE_KEY'));
  assert.ok(client.includes("route:'session-monitor'"));
  assert.equal(client.includes('/api/session-monitor?'), false);
  assert.ok(html.includes('session-monitor.js?v=1.0.0'));
});
