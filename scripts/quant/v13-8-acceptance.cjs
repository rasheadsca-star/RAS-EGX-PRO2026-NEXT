#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const outputPath = path.join(ROOT, 'data', 'quant', 'portfolio-risk-universe.json');
const required = [
  'data/v13-8-risk-policy.json',
  'preview-v13/app/risk-allocation.html',
  'preview-v13/app/decision-journal.html',
  'preview-v13/app/index.html'
];

function fail(message) {
  console.error(`V13.8 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}
if (!fs.existsSync(outputPath)) fail('missing portfolio-risk-universe.json');

const doc = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
if (doc.schemaVersion !== '13.8.0') fail(`unexpected schema ${doc.schemaVersion}`);
if (doc.liveExecutionEnabled !== false) fail('live execution must be false');
if (doc.paperSimulationOnly !== true) fail('paperSimulationOnly must be true');
if (!Array.isArray(doc.profiles) || !doc.profiles.length) fail('risk profiles are empty');
if (!Array.isArray(doc.candidates)) fail('candidates must be an array');

for (const profile of doc.profiles) {
  if (!profile.ticker) fail('profile ticker missing');
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(profile.riskCode)) {
    fail(`${profile.ticker} invalid risk code ${profile.riskCode}`);
  }
  if (!(Number(profile.riskScore) >= 0 && Number(profile.riskScore) <= 100)) {
    fail(`${profile.ticker} invalid risk score`);
  }
  if (!Array.isArray(profile.topCorrelated)) fail(`${profile.ticker} topCorrelated missing`);
}

for (const candidate of doc.candidates) {
  if (candidate.allocationReady) {
    if (!(Number(candidate.referenceEntry) > Number(candidate.plan?.stopLoss))) {
      fail(`${candidate.ticker} allocation-ready without valid entry/stop`);
    }
    if (!(Number(candidate.riskProfile?.averageTurnover20Egp) > 0)) {
      fail(`${candidate.ticker} allocation-ready without liquidity`);
    }
  }
}

const indexHtml = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const requiredText of [
  'EGX Pro V13.8',
  'risk-allocation.html',
  'decision-journal.html',
  'المخاطر وتخصيص رأس المال',
  'سجل القرارات'
]) {
  if (!indexHtml.includes(requiredText)) fail(`index missing ${requiredText}`);
}

for (const page of ['risk-allocation.html', 'decision-journal.html']) {
  const html = fs.readFileSync(path.join(ROOT, 'preview-v13/app', page), 'utf8');
  if (html.length < 5000) fail(`${page} unexpectedly small`);
  if (/navigator\.serviceWorker|service-worker\.js/.test(html)) fail(`${page} must not modify service worker`);
}

console.log('V13.8 acceptance tests passed.');
