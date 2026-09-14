import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildBreadthRegimeSnapshot, BREADTH_REGIME_POLICY } from '../src/breadthRegimeExposure.js';

function makeDoc(ticker, slopePct = 0.25, count = 80, futureExtra = 0) {
  const sessions = [];
  let close = 100;
  for (let i = 0; i < count + futureExtra; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    close *= 1 + slopePct / 100;
    sessions.push({ date, close, adjustedClose: close, open: close, high: close, low: close, volume: 1_000_000 });
  }
  return { ticker, sessions };
}

function universe(slopePct = 0.25, count = 80, futureExtra = 0) {
  return Array.from({ length: 60 }, (_, i) => makeDoc(`T${String(i).padStart(2, '0')}`, slopePct, count, futureExtra));
}

function signalDate(docs, count = 80) { return docs[0].sessions[count - 1].date; }

test('breadth controller source has no legacy engine or recommendation dependency', () => {
  const source = fs.readFileSync(path.resolve('src/breadthRegimeExposure.js'), 'utf8').toLowerCase();
  for (const forbidden of ['v16', 'v17', 'v19', 'gann', 'sepa', 'recommendation', 'target-stop']) {
    assert.equal(source.includes(forbidden), false, `unexpected dependency token: ${forbidden}`);
  }
});

test('future bars cannot change an earlier breadth snapshot', () => {
  const base = universe(0.25, 80, 0);
  const extended = universe(0.25, 80, 15);
  const date = signalDate(base);
  assert.deepEqual(buildBreadthRegimeSnapshot(base, date), buildBreadthRegimeSnapshot(extended, date));
});

test('strong broad uptrend maps to full risk-on exposure', () => {
  const docs = universe(0.25);
  const snap = buildBreadthRegimeSnapshot(docs, signalDate(docs));
  assert.equal(snap.regime, 'RISK_ON');
  assert.equal(snap.supportiveScore, 4);
  assert.equal(snap.exposure, 1);
});

test('strong broad downtrend maps to zero risk-off exposure', () => {
  const docs = universe(-0.25);
  const snap = buildBreadthRegimeSnapshot(docs, signalDate(docs));
  assert.equal(snap.regime, 'RISK_OFF');
  assert.equal(snap.supportiveScore, 0);
  assert.equal(snap.exposure, 0);
});

test('insufficient exact-date universe defaults to neutral half exposure, never forced cash', () => {
  const docs = universe(0.25).slice(0, 59);
  const snap = buildBreadthRegimeSnapshot(docs, signalDate(docs));
  assert.equal(snap.regime, 'UNKNOWN');
  assert.equal(snap.exposure, 0.5);
});

test('policy is frozen and outcome-free', () => {
  assert.equal(BREADTH_REGIME_POLICY.minimumHistorySessions, 60);
  assert.equal(BREADTH_REGIME_POLICY.minimumFeatureReadyUniverse, 60);
  assert.equal(BREADTH_REGIME_POLICY.supportiveThresholds.breadth20, 55);
  assert.equal(BREADTH_REGIME_POLICY.supportiveThresholds.breadth50, 50);
  assert.equal(BREADTH_REGIME_POLICY.supportiveThresholds.positive20, 55);
  assert.equal(BREADTH_REGIME_POLICY.exposureBySupportiveScore['2'], 0.5);
  assert.equal(BREADTH_REGIME_POLICY.outcomeInputs, false);
});