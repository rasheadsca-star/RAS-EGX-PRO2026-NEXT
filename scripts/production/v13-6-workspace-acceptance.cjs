#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const htmlPath = path.join(root, 'preview-v13', 'app', 'index.html');
const policyPath = path.join(root, 'data', 'v13-6-workspace-policy.json');

function fail(message) {
  console.error(`V13.6 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(htmlPath)) fail('preview-v13/app/index.html is missing');
if (!fs.existsSync(policyPath)) fail('data/v13-6-workspace-policy.json is missing');

const html = fs.readFileSync(htmlPath, 'utf8');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

if (policy.schemaVersion !== '13.6.0') fail(`unexpected policy schema ${policy.schemaVersion}`);
if (policy.stableApplication?.preserved !== true) fail('V11 preservation flag is missing');
if (policy.stableApplication?.modified !== false) fail('V11 must not be marked as modified');
if (policy.safety?.liveExecutionEnabled !== false) fail('live execution must be disabled');

const requiredStrings = [
  'EGX Pro V13.6',
  '../../?workspace=v136',
  '../data/v13-3-daily-production.json',
  '../../data/quant/daily-recommendations.json',
  '../../data/quant/adaptive-daily-recommendations.json',
  '../../data/quant/strategy-health.json',
  '../../data/quant/paper-recommendation-ledger.json',
  '../../data/quant/paper-recommendation-metrics.json',
  'البحث وتحليل سهم',
  'المحفظة',
  'السوق والفرص',
  'التداول الورقي',
  'صحة البيانات',
  'التنفيذ الحقيقي مغلق'
];

for (const text of requiredStrings) {
  if (!html.includes(text)) fail(`required workspace capability is missing: ${text}`);
}

if (html.length < 20000) fail(`workspace HTML is unexpectedly small: ${html.length}`);
if (/service-worker\.js|navigator\.serviceWorker\.register/.test(html)) {
  fail('V13.6 must not register or replace the stable service worker');
}
if (/<script[^>]+src=/i.test(html)) {
  fail('V13.6 must remain self-contained and not depend on external scripts');
}

const viewCount = (html.match(/class="view/g) || []).length;
if (viewCount < 10) fail(`expected at least 10 operational views, found ${viewCount}`);

console.log('V13.6 unified workspace acceptance tests passed.');
