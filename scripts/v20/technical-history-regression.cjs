#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { calculatePointInTime, REJECTED_SOURCE_MARKERS } = require('./build-trusted-technical-history.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const history = read('data/v20/technical-history.json');
const indicators = read('data/v20/technical-indicators.json');
const current = read('data/v20/current.json');
const failures = [];
const asOf = history.asOfSessionDate;
const indicatorMap = new Map((indicators.symbols || []).map(item => [item.ticker, item]));

function stable(value) { return JSON.stringify(value); }
function fail(message) { failures.push(message); }

if (history.provenancePolicy?.missingOhlcMayBeSynthesized !== false) fail('missing OHLC synthesis must be forbidden');
if (history.provenancePolicy?.futureRowsAllowed !== false) fail('future history rows must be forbidden');
if (history.provenancePolicy?.currentReadinessRequiresSessionAlignment !== true) fail('current technical readiness must require session alignment');
if (history.provenancePolicy?.currentReadinessRequiresPriceReconciliation !== true) fail('current technical readiness must require price reconciliation');

for (const symbol of history.symbols || []) {
  const seen = new Set();
  for (const row of symbol.rows || []) {
    if (row.date > asOf) fail(`${symbol.ticker}: future row ${row.date}`);
    if (seen.has(row.date)) fail(`${symbol.ticker}: duplicate row ${row.date}`);
    seen.add(row.date);
    if (!(row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)) fail(`${symbol.ticker}: invalid OHLC ${row.date}`);
    if (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low) fail(`${symbol.ticker}: OHLC invariant ${row.date}`);
    const sourceText = [row.primarySource, row.validationStatus, ...(row.warnings || [])].join(' ').toLowerCase();
    if (REJECTED_SOURCE_MARKERS.some(marker => sourceText.includes(marker))) fail(`${symbol.ticker}: rejected provenance marker in ${row.date}`);
  }
  const out = indicatorMap.get(symbol.ticker);
  if (!out) fail(`${symbol.ticker}: indicator output missing`);
  if (symbol.currentTechnicalReady === true) {
    if (symbol.lastSession !== current.sessionDate) fail(`${symbol.ticker}: current ready but session not aligned`);
    if (symbol.sessionAligned !== true || symbol.priceReconciled !== true) fail(`${symbol.ticker}: current ready without alignment/reconciliation`);
    if (symbol.usedForCurrentDecision !== true) fail(`${symbol.ticker}: current ready not marked usable`);
  }
  if (symbol.usedForCurrentDecision === true && symbol.currentTechnicalReady !== true) fail(`${symbol.ticker}: stale technical used for current decision`);

  if ((symbol.rows || []).length) {
    const baseline = calculatePointInTime(symbol.rows, asOf);
    const last = symbol.rows[symbol.rows.length - 1];
    const future = {
      ...last,
      date: '2099-12-31',
      open: last.open * 100,
      high: last.high * 100,
      low: last.low * 100,
      close: last.close * 100,
    };
    const withFuture = calculatePointInTime([...symbol.rows, future], asOf);
    if (stable(baseline) !== stable(withFuture)) fail(`${symbol.ticker}: point-in-time leakage test failed`);
  }
}

const output = {
  schemaVersion: '20.0.0-technical-history-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  invariants: {
    noSyntheticOhlc: failures.every(item => !item.includes('rejected provenance')),
    noFutureLeakage: failures.every(item => !item.includes('leakage')),
    currentRequiresSessionAlignment: failures.every(item => !item.includes('current ready but session')),
    staleIndicatorsCannotDriveCurrentDecision: failures.every(item => !item.includes('stale technical used')),
  },
};
write('data/v20/technical-history-regression.json', output);
if (!output.ok) {
  console.error(JSON.stringify(output, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(output, null, 2));
