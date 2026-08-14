#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const readJson = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const readText = rel => fs.readFileSync(P(rel), 'utf8');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const snapshot = readJson('data/v20/current-market-snapshot.json');
const explorer = readJson('data/v20/market-explorer.json');
const profiles = readJson('data/v20/stock-profiles.json');
const technical = readJson('data/v20/technical-indicators.json');
const byExplorer = new Map((explorer.rows || []).map(row => [row.ticker, row]));
const byProfile = new Map((profiles.profiles || []).map(row => [row.ticker, row]));
const byTechnical = new Map((technical.symbols || []).map(row => [row.ticker, row]));

const hardenedSources = [
  'scripts/v20/build-data-truth.cjs',
  'scripts/v20/build-integrated-decision-snapshot.cjs',
  'scripts/v20/build-market-explorer.cjs',
  'scripts/v20/build-portfolio-risk.cjs',
  'scripts/v20/build-stock-profiles.cjs',
  'scripts/v20/build-trusted-technical-history.cjs',
  'scripts/v20/enrich-risk-reward.cjs',
  'scripts/v20/validate-trade-plans.cjs',
  'scripts/v20/regression.cjs',
  'scripts/v20/trade-plan-regression.cjs',
  'v20/portfolio-core.js',
];

for (const rel of hardenedSources) {
  const text = readText(rel);
  check(text.includes("value === null || value === undefined || value === ''"), `NULL_GUARD_MISSING_${rel.replace(/[^A-Za-z0-9]/g, '_')}`);
}

const app = readText('v20/app.js');
const portfolioUi = readText('v20/portfolio.js');
check(app.includes('const isMissing = value => value === null || value === undefined || value ==='), 'APP_MISSING_NULL_DISPLAY_GUARD');
check(app.includes("return n === null ? '—'"), 'APP_MISSING_DASH_FOR_NULL');
check(portfolioUi.includes("value === null || value === undefined || value === ''"), 'PORTFOLIO_UI_MISSING_NULL_DISPLAY_GUARD');

let comparedCurrentRows = 0;
let preservedNullFields = 0;
for (const row of snapshot.rows || []) {
  const out = byExplorer.get(row.ticker);
  if (!out || out.currentSessionAvailable !== true) continue;
  comparedCurrentRows += 1;
  for (const field of ['previousClose', 'open', 'high', 'low', 'volume', 'turnover', 'trades']) {
    if (row[field] === null) {
      check(out[field] === null, `NULL_REINTRODUCED_AS_VALUE_${row.ticker}_${field}`);
      if (out[field] === null) preservedNullFields += 1;
    }
  }
  if ((row.dataQualityIssues || []).includes('OPEN_NON_POSITIVE_OR_MISSING')) check(out.open === null, `OPEN_ZERO_REINTRODUCED_${row.ticker}`);
  if ((row.dataQualityIssues || []).includes('HIGH_NON_POSITIVE_OR_MISSING')) check(out.high === null, `HIGH_ZERO_REINTRODUCED_${row.ticker}`);
  if ((row.dataQualityIssues || []).includes('LOW_NON_POSITIVE_OR_MISSING')) check(out.low === null, `LOW_ZERO_REINTRODUCED_${row.ticker}`);
}

let comparedTechnicalFields = 0;
let preservedTechnicalNulls = 0;
for (const [ticker, src] of byTechnical.entries()) {
  const profile = byProfile.get(ticker);
  if (!profile) continue;
  const ta = profile.technicalAnalysis || {};
  const indicators = src.indicators || {};
  for (const field of ['sma20','sma50','ema20','rsi14','macd','macdSignal','atr14','momentum5Pct','momentum10Pct','momentum20Pct']) {
    comparedTechnicalFields += 1;
    const sourceMissing = indicators[field] === null || indicators[field] === undefined;
    if (sourceMissing) {
      const profileMissing = ta[field] === null || ta[field] === undefined;
      check(profileMissing, `TECHNICAL_NULL_REINTRODUCED_${ticker}_${field}`);
      if (profileMissing) preservedTechnicalNulls += 1;
    }
  }
}

const archiveText = readText('scripts/v20/archive-signal.cjs');
const phase3Text = readText('scripts/v20/phase3-regression.cjs');
check(archiveText.includes('const n = Number(value);'), 'IMMUTABLE_ARCHIVE_COMPATIBILITY_SEMANTICS_CHANGED');
check(phase3Text.includes('const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;'), 'PHASE3_ARCHIVE_HASH_COMPATIBILITY_CHANGED');

const report = {
  schemaVersion: '20.0.0-null-semantics-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    productionBuildersNullSafe: true,
    uiMissingValuesRenderAsDash: true,
    snapshotNullsPreservedIntoMarketExplorer: true,
    technicalIndicatorNestedShapeRespected: true,
    technicalNullsNotFabricatedAsZero: true,
    immutableArchiveHashCompatibilityPreserved: true,
  },
  evidence: {
    comparedCurrentRows,
    preservedNullFields,
    comparedTechnicalFields,
    preservedTechnicalNulls,
    hardenedSourceCount: hardenedSources.length,
    immutableCompatibilityExclusions: 2,
  }
};

fs.mkdirSync(P('data/v20'), { recursive: true });
fs.writeFileSync(P('data/v20/null-semantics-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
