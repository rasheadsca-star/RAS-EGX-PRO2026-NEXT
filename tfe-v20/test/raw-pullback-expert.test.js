import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildRawPullbackSnapshot, RAW_PULLBACK_POLICY } from '../src/rawPullbackExpert.js';

function makeDoc(ticker, count = 110, futureExtra = 0, opts = {}) {
  const sessions = [];
  let close = opts.start ?? 100;
  const total = count + futureExtra;
  for (let i = 0; i < total; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const trend = i < count - 8 ? 0.22 : i < count - 2 ? -0.65 : 0.9;
    close = Math.max(5, close * (1 + trend / 100));
    const high = close * (i < count - 2 ? 1.01 : 1.008);
    const low = close * 0.992;
    sessions.push({ date, open: close * 0.997, high, low, close, adjustedClose: close, volume: 1_000_000 + i * 1000 });
  }
  return { ticker, sessions };
}

function signalDate(doc, count = 110) { return doc.sessions[count - 1].date; }

test('pullback expert source has no dependency on legacy engines or recommendation outputs', () => {
  const source = fs.readFileSync(path.resolve('src/rawPullbackExpert.js'), 'utf8').toLowerCase();
  for (const forbidden of ['v16', 'v17', 'v19', 'gann', 'sepa', 'recommendation', 'target-stop-audit']) {
    assert.equal(source.includes(forbidden), false, `unexpected legacy dependency token: ${forbidden}`);
  }
});

test('future bars cannot change an earlier pullback snapshot', () => {
  const base = makeDoc('AAA', 110, 0);
  const extended = makeDoc('AAA', 110, 12);
  const date = signalDate(base);
  const a = buildRawPullbackSnapshot([base], date);
  const b = buildRawPullbackSnapshot([extended], date);
  assert.deepEqual(a.ranked, b.ranked);
  assert.deepEqual(a.universe, b.universe);
});

test('snapshot requires exact signal-date coverage and enough history', () => {
  const short = makeDoc('SHORT', 60, 0);
  const full = makeDoc('FULL', 110, 0);
  const date = signalDate(full);
  const missingDate = { ...full, ticker: 'MISS', sessions: full.sessions.slice(0, -1) };
  const snap = buildRawPullbackSnapshot([short, missingDate], date);
  assert.equal(snap.universe.featureReady, 0);
  assert.equal(snap.ranked.length, 0);
});

test('strongly extended price is excluded instead of counted as healthy pullback', () => {
  const doc = makeDoc('EXT', 110, 0);
  const last = doc.sessions.at(-1);
  last.close *= 1.20;
  last.adjustedClose = last.close;
  last.high = last.close * 1.01;
  last.low = last.close * 0.99;
  last.open = last.close * 0.995;
  const snap = buildRawPullbackSnapshot([doc], signalDate(doc));
  assert.equal(snap.ranked.some(x => x.ticker === 'EXT'), false);
});

test('ranking is deterministic with ticker tie break', () => {
  const a = makeDoc('AAA');
  const b = JSON.parse(JSON.stringify(a));
  b.ticker = 'BBB';
  const date = signalDate(a);
  const first = buildRawPullbackSnapshot([b, a], date).ranked.map(x => x.ticker);
  const second = buildRawPullbackSnapshot([a, b], date).ranked.map(x => x.ticker);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...first].sort());
});

test('pullback policy is fixed and outcome-free', () => {
  assert.equal(RAW_PULLBACK_POLICY.minimumHistorySessions, 90);
  assert.equal(RAW_PULLBACK_POLICY.minimumPullbackDepth, 0.02);
  assert.equal(RAW_PULLBACK_POLICY.maximumPullbackDepth, 0.12);
  assert.equal(RAW_PULLBACK_POLICY.minimumCloseLocation, 0.60);
  assert.equal(RAW_PULLBACK_POLICY.confirmationScore, 70);
  const snap = buildRawPullbackSnapshot([makeDoc('AAA')], signalDate(makeDoc('AAA')));
  assert.equal(snap.policy.outcomeInputs, false);
});