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
  console.error(`V13.12 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const required = [
  'data/v13-12-intraday-alert-policy.json',
  'data/intraday/latest.json',
  'data/intraday/alerts.json',
  'data/intraday/history.json',
  'data/intraday/status.json',
  'scripts/intraday/v13-12-intraday-monitor.cjs',
  'preview-v13/app/intraday-monitor.html',
  'preview-v13/app/daily-decision.html',
  'preview-v13/app/index.html'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}

const latest = read('data/intraday/latest.json');
const alerts = read('data/intraday/alerts.json');
const history = read('data/intraday/history.json');
const status = read('data/intraday/status.json');

if (latest.schemaVersion !== '13.12.0') fail(`unexpected latest schema ${latest.schemaVersion}`);
if (alerts.schemaVersion !== '13.12.0') fail(`unexpected alerts schema ${alerts.schemaVersion}`);
if (latest.liveExecutionEnabled !== false) fail('live execution must remain false');
if (latest.publicDelayedData !== true) fail('delayed data label missing');
if (!Array.isArray(latest.rows)) fail('latest rows must be an array');
if (!Array.isArray(alerts.alerts) || !Array.isArray(alerts.newAlerts)) fail('alerts arrays missing');
if (!Array.isArray(history.snapshots) || history.snapshots.length < 1) fail('history snapshots missing');
if (status.publicDelayedData !== true) fail('status delayed label missing');

const tickers = latest.rows.map(x => x.ticker);
if (new Set(tickers).size !== tickers.length) fail('duplicate latest tickers');
const alertIds = alerts.alerts.map(x => x.id);
if (new Set(alertIds).size !== alertIds.length) fail('duplicate alert IDs');

for (const row of latest.rows) {
  if (!(Number(row.price) > 0)) fail(`${row.ticker} invalid price`);
  if (row.delayed !== true) fail(`${row.ticker} delayed flag missing`);
  if (!row.state || !row.stateLabelAr) fail(`${row.ticker} state missing`);
}
for (const item of alerts.alerts) {
  if (!['critical', 'opportunity', 'warning', 'info'].includes(item.level)) fail(`${item.id} invalid level`);
  if (!item.titleAr || !item.actionAr) fail(`${item.id} incomplete alert`);
}

const intradayPage = fs.readFileSync(path.join(ROOT, 'preview-v13/app/intraday-monitor.html'), 'utf8');
for (const text of [
  'V13.12',
  'تنبيهات الجلسة',
  'تشغيل إشعارات ويندوز',
  'تحديث تلقائي كل 60 ثانية',
  'بيانات عامة متأخرة'
]) {
  if (!intradayPage.includes(text)) fail(`intraday page missing ${text}`);
}
if (/navigator\.serviceWorker|service-worker\.js/.test(intradayPage)) fail('intraday page must not modify service worker');
if (intradayPage.length < 9000) fail('intraday page unexpectedly small');

const dailyPage = fs.readFileSync(path.join(ROOT, 'preview-v13/app/daily-decision.html'), 'utf8');
for (const text of ['intradayBadge', 'intradayStrip', 'intraday-monitor.html']) {
  if (!dailyPage.includes(text)) fail(`daily page missing ${text}`);
}

const index = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const text of ['EGX Pro V13.12', 'intraday-monitor.html', 'تنبيهات الجلسة V13.12']) {
  if (!index.includes(text)) fail(`index missing ${text}`);
}
if (!index.includes('class="view active" id="view-daily1311"')) fail('daily decision must remain default');

console.log('V13.12 acceptance tests passed.');
