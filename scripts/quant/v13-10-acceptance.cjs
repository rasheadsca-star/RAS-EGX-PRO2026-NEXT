#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

function read(relative) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing ${relative}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function fail(message) {
  console.error(`V13.10 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const required = [
  'data/v13-10-tiered-confidence-policy.json',
  'data/quant/freshness-coverage-v13-10.json',
  'data/quant/tiered-confidence-recommendations-v13-10.json',
  'scripts/history/v13-10-full-market-refresh.cjs',
  'scripts/quant/v13-10-tiered-confidence.cjs',
  'preview-v13/app/tiered-confidence.html',
  'preview-v13/app/index.html'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}

const output = read('data/quant/tiered-confidence-recommendations-v13-10.json');
const freshness = read('data/quant/freshness-coverage-v13-10.json');
const recs = read('data/quant/daily-recommendations.json');

if (output.schemaVersion !== '13.10.0') fail(`unexpected schema ${output.schemaVersion}`);
if (output.liveExecutionEnabled !== false) fail('live execution must remain false');
if (output.automaticRegistration !== false) fail('automatic registration must remain false');
if (output.productionThresholdsChanged !== false) fail('production thresholds were changed');
if (output.strictProductionCandidatesOverwritten !== false) fail('strict production candidates were overwritten');
if (freshness.neverUseLaggedHistoryForNewSignals !== true) fail('lagged history safety missing');
if (!(Number(freshness.exactFreshCoveragePct) >= 0 && Number(freshness.exactFreshCoveragePct) <= 100)) fail('invalid freshness coverage');

const strictOutput = (output.strictPaperCandidates || []).map(item => item.ticker).sort();
const strictOriginal = (recs.paperCandidates || []).map(item => item.ticker).sort();
if (JSON.stringify(strictOutput) !== JSON.stringify(strictOriginal)) {
  fail('strict V13.4 candidates were changed by V13.10');
}

for (const item of output.tierAExperimentalPaper || []) {
  if (item.status !== 'EXPERIMENTAL_PAPER') fail(`${item.ticker} invalid Tier A status`);
  if (item.hardFailureCount !== 0) fail(`${item.ticker} has a hard failure`);
  if (Number(item.softFailureCount) > 1) fail(`${item.ticker} has too many soft failures`);
  if (item.eligibilityDecision !== true || item.regimeAllowed !== true) fail(`${item.ticker} failed safety gates`);
  if (item.automaticRegistration !== false || item.liveExecutionEnabled !== false) fail(`${item.ticker} unsafe execution flag`);
  if (!(Number(item.plan?.entryHigh) > Number(item.plan?.stopLoss))) fail(`${item.ticker} invalid entry/stop`);
  if (item.portfolioValidation?.experimentalPortfolioPass !== true) fail(`${item.ticker} strategy portfolio validation failed`);
}

for (const strategy of output.strategyPortfolioValidation || []) {
  const m = strategy.portfolioMetrics || {};
  if (m.method !== 'fixed_fractional_risk_portfolio_with_concurrency_limit') fail(`${strategy.strategyId} wrong portfolio method`);
  if (!(Number(m.maximumDrawdownPct) >= 0 && Number(m.maximumDrawdownPct) <= 100)) fail(`${strategy.strategyId} invalid drawdown`);
}

const page = fs.readFileSync(path.join(ROOT, 'preview-v13/app/tiered-confidence.html'), 'utf8');
for (const text of ['V13.10', 'تغطية آخر جلسة', 'الطبقة A', 'الطبقة B', 'الشروط الإلزامية والمرنة']) {
  if (!page.includes(text)) fail(`page missing ${text}`);
}
if (page.length < 7000) fail('tiered confidence page unexpectedly small');

const index = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const text of ['EGX Pro V13.10', 'tiered-confidence.html', 'الثقة المتدرجة']) {
  if (!index.includes(text)) fail(`index missing ${text}`);
}

console.log('V13.10 acceptance tests passed.');
