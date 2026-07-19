#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

function read(relative, required = true) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing ${relative}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function fail(message) {
  console.error(`V13.14 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const required = [
  'data/v13-14-unified-center-policy.json',
  'data/quant/unified-autonomous-center-v13-14.json',
  'scripts/postclose/v13-14-session-finalizer.cjs',
  'scripts/quant/v13-14-unified-center.cjs',
  'preview-v13/app/unified-decision-center.html',
  'preview-v13/app/index.html'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}

const center = read('data/quant/unified-autonomous-center-v13-14.json');
const policy = read('data/v13-14-unified-center-policy.json');
const mode = String(process.env.V13_14_ACCEPTANCE_MODE || 'AUTO').toUpperCase();

if (center.schemaVersion !== '13.14.0') fail(`unexpected schema ${center.schemaVersion}`);
if (center.patchVersion !== '13.14.1') fail(`unexpected patch ${center.patchVersion}`);
if (!center.sessionIntegrity || typeof center.sessionIntegrity.ok !== 'boolean') fail('session integrity report missing');
if (center.liveExecutionEnabled !== false) fail('live execution must remain disabled');
if (center.automaticOrderSubmission !== false) fail('automatic order submission must remain disabled');
if (!Array.isArray(center.candidates) || !Array.isArray(center.topCandidates)) fail('candidate arrays missing');
if (center.topCandidates.length > Number(policy.decision.maximumPrimaryCandidates || 5)) fail('too many primary candidates');

const tickers = center.candidates.map(item => item.ticker);
if (new Set(tickers).size !== tickers.length) fail('duplicate candidate tickers');
for (const item of center.candidates) {
  if (!item.finalDecision?.code || !item.finalDecision?.labelAr) fail(`${item.ticker} final decision missing`);
  if (item.tier === 'TIER_B_PRIORITY_WATCH' && item.finalDecision.actionable === true) fail(`${item.ticker} Tier B became actionable`);
  if (item.finalDecision.actionable === true && !['STRICT_PAPER', 'TIER_A_EXPERIMENTAL_PAPER'].includes(item.tier)) {
    fail(`${item.ticker} invalid actionable tier`);
  }
  if (item.finalDecision.actionable === true) {
    if (!(Number(item.plan?.entryHigh) > Number(item.plan?.stopLoss))) fail(`${item.ticker} invalid actionable plan`);
    if (item.stale === true || item.marketCurrent !== true) fail(`${item.ticker} actionable with stale market data`);
  }
}
for (let i = 1; i < center.candidates.length; i += 1) {
  if (Number(center.candidates[i - 1].priorityScore) < Number(center.candidates[i].priorityScore)) fail('unified ranking order invalid');
}

if (mode === 'POSTCLOSE_CONFIRMED') {
  const report = read('data/postclose/latest-v13-14.json');
  const summary = read('data/history-summary.json');
  const daily = read('data/quant/daily-decision-workspace-v13-11.json');
  if (!['FINALIZED', 'ALREADY_FINALIZED'].includes(report.status)) fail(`finalization status is ${report.status}`);
  if (report.targetPassed !== true) fail('post-close target did not pass');
  if (summary.latestMarketSession !== report.sessionDate) fail('history summary is not finalized session');
  if (daily.sessionId !== report.sessionDate) fail('daily decision is not finalized session');
  if (center.analysisSession !== report.sessionDate) fail('unified center analysis is not finalized session');
}

const page = fs.readFileSync(path.join(ROOT, 'preview-v13/app/unified-decision-center.html'), 'utf8');
for (const text of [
  'V13.14.1', 'مركز القرار الموحد', 'القرار النهائي', 'السعر الحالي', 'منطقة الدخول',
  'الهدف الأول', 'وقف الخسارة', 'الرسم البياني', 'جميع الطبقات', 'تشغيل إشعارات ويندوز'
]) {
  if (!page.includes(text)) fail(`unified page missing ${text}`);
}
if (!page.includes('../../data/quant/unified-autonomous-center-v13-14.json')) fail('unified page missing data source');
if (/navigator\.serviceWorker|service-worker\.js/.test(page)) fail('unified page must not modify the service worker');

const index = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const text of ['EGX Pro V13.14', 'unified-decision-center.html', 'مركز القرار الموحد V13.14']) {
  if (!index.includes(text)) fail(`index missing ${text}`);
}
if (!index.includes('class="view active" id="view-center1314"')) fail('V13.14 center is not the default view');

if (!page.includes('دعم تاريخي 20 جلسة')) fail('unified page must label historical support explicitly');
if (!page.includes('حالة الاستراتيجية')) fail('unified page missing strategy status gate');
if (!index.includes("const container = safeElement('stockSearchCards')")) fail('index missing null-safe stock search');
if (!index.includes('activeStrategies ??')) fail('index still treats zero active strategies as missing');
if (!index.includes('sessionIntegrityNotice')) fail('index missing session integrity notice');

console.log(`V13.14.1 acceptance tests passed in ${mode} mode.`);
