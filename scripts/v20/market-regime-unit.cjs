#!/usr/bin/env node
'use strict';
const { classify } = require('./build-market-regime.cjs');
const cases = [
  {
    name: 'broad-risk-on', expected: 'BULLISH', reference: 'RISK_ON',
    metrics: { advancePct: 70, aboveSma20Pct: 75, aboveSma50Pct: 70, medianReturn20Pct: 8, medianReturn5Pct: 2, volatility20AnnualizedPct: 35 },
  },
  {
    name: 'broad-risk-off', expected: 'BEARISH', reference: 'RISK_OFF',
    metrics: { advancePct: 25, aboveSma20Pct: 25, aboveSma50Pct: 25, medianReturn20Pct: -8, medianReturn5Pct: -3, volatility20AnnualizedPct: 50 },
  },
  {
    name: 'high-volatility-overlay', expected: 'BEARISH', reference: 'HIGH_VOLATILITY',
    metrics: { advancePct: 65, aboveSma20Pct: 65, aboveSma50Pct: 60, medianReturn20Pct: 5, medianReturn5Pct: 2, volatility20AnnualizedPct: 70 },
  },
];
const failures = [];
for (const item of cases) {
  const result = classify(item.metrics);
  if (result.mappedRegime !== item.expected || result.v16ReferenceRegime !== item.reference) {
    failures.push({ case: item.name, expected: item.expected, reference: item.reference, actual: result });
  }
}
console.log(JSON.stringify({ ok: failures.length === 0, cases: cases.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
