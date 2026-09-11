import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildRawMomentumSnapshot, RAW_MOMENTUM_POLICY } from '../src/rawMomentumExpert.js';

function makeDoc(ticker, drift = 0.003, volume = 100000, extra = []) {
  const sessions = [];
  const start = new Date('2026-01-01T00:00:00Z');
  let close = 10;
  for (let i = 0; i < 120; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    close *= 1 + drift + ((i % 7) - 3) * 0.0002;
    sessions.push({
      date: d.toISOString().slice(0, 10),
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      adjustedClose: close,
      volume: volume + i * 10
    });
  }
  return { ticker, sessions: [...sessions, ...extra] };
}

test('expert source has no dependency on legacy engine code or outputs', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, '../src/rawMomentumExpert.js'), 'utf8').toLowerCase();
  for (const forbidden of ['v16', 'v17', 'v19', 'gann', 'sepa', 'metaengine']) {
    assert.equal(source.includes(forbidden), false, `forbidden lineage token: ${forbidden}`);
  }
});

test('future bars cannot change an earlier point-in-time snapshot', () => {
  const docs = [makeDoc('AAA', 0.004), makeDoc('BBB', 0.003), makeDoc('CCC', 0.002), makeDoc('DDD', 0.0015)];
  const signalDate = docs[0].sessions[99].date;
  const before = buildRawMomentumSnapshot(docs, signalDate);
  const futureDate = '2027-01-01';
  const mutated = docs.map((doc, i) => ({
    ...doc,
    sessions: [...doc.sessions, { date: futureDate, close: 10000 * (i + 1), adjustedClose: 10000 * (i + 1), volume: 999999999 }]
  }));
  const after = buildRawMomentumSnapshot(mutated, signalDate);
  assert.deepEqual(after.ranked, before.ranked);
});

test('snapshot requires exact signal-date coverage and enough history', () => {
  const complete = makeDoc('AAA', 0.003);
  const signalDate = complete.sessions[100].date;
  const stale = { ...makeDoc('STALE', 0.003), sessions: makeDoc('STALE', 0.003).sessions.filter(x => x.date < signalDate) };
  const short = { ticker: 'SHORT', sessions: makeDoc('SHORT', 0.003).sessions.slice(-40) };
  const r = buildRawMomentumSnapshot([complete, stale, short], signalDate);
  assert.equal(r.universe.featureReady, 1);
  assert.equal(r.ranked[0].ticker, 'AAA');
});

test('negative long momentum or trend is excluded rather than treated as a bullish vote', () => {
  const up = makeDoc('UP', 0.003);
  const down = makeDoc('DOWN', -0.002);
  const signalDate = up.sessions[100].date;
  const r = buildRawMomentumSnapshot([up, down], signalDate);
  assert.equal(r.ranked.some(x => x.ticker === 'DOWN'), false);
  assert.equal(r.ranked.some(x => x.ticker === 'UP'), true);
});

test('ranking is deterministic with ticker tie break', () => {
  const docs = [makeDoc('BBB', 0.003), makeDoc('AAA', 0.003), makeDoc('CCC', 0.003)];
  const signalDate = docs[0].sessions[100].date;
  const a = buildRawMomentumSnapshot(docs, signalDate);
  const b = buildRawMomentumSnapshot([...docs].reverse(), signalDate);
  assert.deepEqual(a.ranked, b.ranked);
});

test('policy is fixed and equal-weight score has a preregistered confirmation threshold', () => {
  assert.equal(RAW_MOMENTUM_POLICY.minimumHistorySessions, 80);
  assert.equal(RAW_MOMENTUM_POLICY.momentumShort, 20);
  assert.equal(RAW_MOMENTUM_POLICY.momentumLong, 60);
  assert.equal(RAW_MOMENTUM_POLICY.trendEma, 50);
  assert.equal(RAW_MOMENTUM_POLICY.confirmationScore, 70);
});
