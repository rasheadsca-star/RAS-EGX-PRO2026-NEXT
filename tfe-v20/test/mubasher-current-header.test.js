import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketTimestamp, parseMubasherStockPage } from '../monitor/session-quote.js';

const currentMubasherHtml = `
<html><body>
<h1>El Nasr Clothing and Textiles (KABO)</h1>
<div>Last update: 01:29 PM market time.</div>
<div>8.49</div><div>-0.04</div><div>-0.47%</div>
<div>Open 8.52</div><div>Previous Close 8.52</div><div>High 8.78</div><div>Low 8.46</div>
<div>Stock Statistics</div><div>Volume 8,908,870</div><div>Turnover 76,556,496.00</div>
<div>All data are 15 minutes late during market session</div>
</body></html>`;

test('current Mubasher time-only header parses as Cairo session quote', () => {
  const q = parseMubasherStockPage(currentMubasherHtml, 'KABO', new Date('2026-08-24T10:40:00Z'));
  assert.equal(q.ticker, 'KABO');
  assert.equal(q.sourceSessionDate, '2026-08-24');
  assert.equal(q.sourceMarketTime, '13:29');
  assert.equal(q.sourceMarketMinutes, 809);
  assert.equal(q.price, 8.49);
  assert.equal(q.change, -0.04);
  assert.equal(q.changePct, -0.47);
  assert.equal(q.open, 8.52);
  assert.equal(q.previousClose, 8.52);
  assert.equal(q.high, 8.78);
  assert.equal(q.low, 8.46);
  assert.equal(q.volume, 8908870);
  assert.equal(q.turnover, 76556496);
  assert.equal(q.scoringImpact, 'NONE');
  assert.equal(q.monitorOnly, true);
});

test('time-only timestamp derives the trading date in Africa/Cairo, not UTC', () => {
  const stamp = parseMarketTimestamp('01:29 PM market time.', new Date('2026-08-23T22:30:00Z'));
  assert.equal(stamp.sourceSessionDate, '2026-08-24');
  assert.equal(stamp.sourceMarketTime, '13:29');
  assert.equal(stamp.sourceMarketMinutes, 809);
});

test('legacy dated Mubasher header remains supported', () => {
  const stamp = parseMarketTimestamp('20 August 10:15 AM market time.', new Date('2026-08-20T07:20:00Z'));
  assert.equal(stamp.sourceSessionDate, '2026-08-20');
  assert.equal(stamp.sourceMarketTime, '10:15');
  assert.equal(stamp.sourceMarketMinutes, 615);
});

test('quote parser remains fail-closed when OHLC is incomplete', () => {
  const broken = currentMubasherHtml.replace('<div>High 8.78</div>', '<div>High —</div>');
  assert.throws(() => parseMubasherStockPage(broken, 'KABO', new Date('2026-08-24T10:40:00Z')), /QUOTE_OHLC_INCOMPLETE/);
});
