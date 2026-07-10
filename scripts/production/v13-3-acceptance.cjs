#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const outputPath = path.join(ROOT, 'preview-v13', 'data', 'v13-3-daily-production.json');
const statePath = path.join(ROOT, 'preview-v13', 'data', 'v13-3-pipeline-state.json');

function fail(message) {
  console.error(`ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(outputPath)) fail('daily production output is missing');
if (!fs.existsSync(statePath)) fail('pipeline state output is missing');

const doc = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

if (doc.schemaVersion !== '13.3.0') fail(`unexpected schema version ${doc.schemaVersion}`);
if (doc.stableApplicationTouched !== false) fail('stable application must remain untouched');
if (doc.liveExecutionEnabled !== false) fail('live execution must remain disabled');
if (!Array.isArray(doc.schedule?.tradingDays)) fail('trading-day calendar is missing');

const expectedDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
if (JSON.stringify(doc.schedule.tradingDays) !== JSON.stringify(expectedDays)) {
  fail(`trading days must be Sunday through Thursday: ${JSON.stringify(doc.schedule.tradingDays)}`);
}

const blocked = new Set(['SAIB', 'NDRL', 'SPHT', 'EGSA', 'FAITA', 'ESRS']);
for (const candidate of [...(doc.today?.decisionCandidates || []), ...(doc.today?.paperCandidates || [])]) {
  if (blocked.has(String(candidate.ticker || '').toUpperCase())) {
    fail(`blocked ticker leaked into production candidates: ${candidate.ticker}`);
  }
}

if (doc.failClosed) {
  if ((doc.today?.decisionCandidates || []).length) fail('fail-closed output contains decision candidates');
  if ((doc.today?.paperCandidates || []).length) fail('fail-closed output contains paper candidates');
}

if (!Array.isArray(doc.pipeline?.stages) || doc.pipeline.stages.length < 5) {
  fail('pipeline stage audit is incomplete');
}

if (!doc.promotionGate || !Array.isArray(doc.promotionGate.checks)) {
  fail('promotion gate is missing');
}

if (state.failClosed !== doc.failClosed) fail('pipeline state does not match main output');
if (state.decisionCandidates !== (doc.today?.decisionCandidates || []).length) fail('decision count mismatch');
if (state.paperCandidates !== (doc.today?.paperCandidates || []).length) fail('paper count mismatch');

console.log('V13.3 acceptance tests passed.');
