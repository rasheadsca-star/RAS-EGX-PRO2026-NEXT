#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = (rel, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const symbolOf = value => String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');

const rawMarket = read('data/market.json');
const snapshot = read('data/v20/current-market-snapshot.json');
const sourceHealth = read('data/v20/source-health.json');
const rowsOf = value => Array.isArray(value) ? value : ['rows','items','data'].map(k => value?.[k]).find(Array.isArray) || [];
const rawMap = new Map(rowsOf(rawMarket).map(row => [symbolOf(row.symbol || row.ticker), row]));
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(snapshot.schemaVersion === '20.0.0-current-market-snapshot-2', 'SNAPSHOT_SCHEMA_NOT_SEMANTIC_V2');
check(snapshot.semanticQuality?.semanticCompleteness === true, 'SEMANTIC_COMPLETENESS_NOT_ENABLED');
check(snapshot.sourceTruth?.globalCoverageMetricsRemainAuthoritativeFromV17 === true, 'V17_GLOBAL_QUALITY_AUTHORITY_DRIFT');
check(sourceHealth.semanticRowQuality?.semanticCompleteness === true, 'SOURCE_HEALTH_SEMANTIC_SUMMARY_MISSING');

let rawZeroOhlcCount = 0;
let sanitizedZeroOhlcCount = 0;
let validOhlcCount = 0;
let completeCount = 0;

for (const row of snapshot.rows || []) {
  const raw = rawMap.get(row.ticker) || {};
  const price = finite(row.price);
  const open = finite(row.open);
  const high = finite(row.high);
  const low = finite(row.low);

  check(price === null || price > 0, `NON_POSITIVE_CURRENT_PRICE_EXPOSED_${row.ticker}`);
  for (const [name, value] of [['OPEN', open], ['HIGH', high], ['LOW', low]]) {
    check(value === null || value > 0, `NON_POSITIVE_${name}_EXPOSED_${row.ticker}`);
  }

  if (row.ohlcValid === true) {
    validOhlcCount += 1;
    check(price > 0 && open > 0 && high > 0 && low > 0, `OHLC_VALID_WITH_MISSING_FIELD_${row.ticker}`);
    if (price > 0 && open > 0 && high > 0 && low > 0) {
      check(high >= low, `HIGH_BELOW_LOW_${row.ticker}`);
      check(high >= open && high >= price, `HIGH_INVARIANT_FAILED_${row.ticker}`);
      check(low <= open && low <= price, `LOW_INVARIANT_FAILED_${row.ticker}`);
    }
  }

  if (row.dataQualityState === 'COMPLETE_FOR_CURRENT_SCOPE') {
    completeCount += 1;
    check(row.ohlcValid === true, `FALSE_COMPLETE_WITHOUT_VALID_OHLC_${row.ticker}`);
    check(Number(row.criticalFieldCompletenessPct) >= 85, `FALSE_COMPLETE_LOW_COMPLETENESS_${row.ticker}`);
  }

  const zeroChecks = [
    ['open', 'OPEN_NON_POSITIVE_OR_MISSING'],
    ['high', 'HIGH_NON_POSITIVE_OR_MISSING'],
    ['low', 'LOW_NON_POSITIVE_OR_MISSING'],
  ];
  for (const [field, issue] of zeroChecks) {
    if (Number(raw?.[field]) === 0) {
      rawZeroOhlcCount += 1;
      check(row[field] === null, `RAW_ZERO_${field.toUpperCase()}_NOT_SANITIZED_${row.ticker}`);
      check((row.dataQualityIssues || []).includes(issue), `RAW_ZERO_${field.toUpperCase()}_ISSUE_NOT_RECORDED_${row.ticker}`);
      if (row[field] === null) sanitizedZeroOhlcCount += 1;
    }
  }

  if ((row.dataQualityIssues || []).includes('OHLC_INVARIANT_FAILED')) {
    check(row.ohlcValid === false, `INVARIANT_FAILURE_MARKED_VALID_${row.ticker}`);
    check(row.open === null && row.high === null && row.low === null, `INVARIANT_FAILURE_NOT_SANITIZED_${row.ticker}`);
  }
}

const summary = snapshot.semanticQuality || {};
check(Number(summary.nonPositiveOhlcExposedAsNumeric || 0) === 0, 'SEMANTIC_SUMMARY_REPORTS_NON_POSITIVE_OHLC');
check(Number(summary.ohlcValidRows || 0) === validOhlcCount, 'OHLC_VALID_SUMMARY_MISMATCH');
check(Number(summary.completeRows || 0) === completeCount, 'COMPLETE_ROW_SUMMARY_MISMATCH');
check(rawZeroOhlcCount === sanitizedZeroOhlcCount, 'NOT_ALL_RAW_ZERO_OHLC_SANITIZED');

const report = {
  schemaVersion: '20.0.0-data-quality-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    nullIsMissingNotNumericZero: true,
    semanticCompletenessEnabled: true,
    nonPositiveOhlcNeverExposedAsValidNumeric: true,
    ohlcInvariantRequiredForCompleteState: true,
    currentPriceCanRemainAvailableWhenOhlcPartial: true,
    v17GlobalQualityAuthorityPreserved: true,
  },
  evidence: {
    rowCount: (snapshot.rows || []).length,
    rawZeroOhlcCount,
    sanitizedZeroOhlcCount,
    ohlcValidCount: validOhlcCount,
    completeCount,
    partialCount: Number(summary.partialRows || 0),
    rowsWithQualityIssues: Number(summary.rowsWithQualityIssues || 0),
  },
};

fs.mkdirSync(P('data/v20'), { recursive: true });
fs.writeFileSync(P('data/v20/data-quality-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
