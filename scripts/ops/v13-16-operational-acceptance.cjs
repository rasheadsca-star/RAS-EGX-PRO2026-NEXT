#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
function read(relative) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing ${relative}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      if (key !== 'reportHash') acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function fail(message) {
  console.error(`V13.16 OPERATIONAL ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const policy = read('data/v13-16-operational-policy.json');
const evidencePolicy = read('data/v13-15-evidence-policy.json');
const center = read('data/quant/unified-autonomous-center-v13-14.json');
const workflowAudit = read('data/ops/workflow-inventory-v13-16.json');
const ops = read('data/ops/operational-health-v13-16.json');
const report = read('data/reports/daily/latest.json');
const shadow = read('data/lab/shadow-diagnostics-v13-16.json');

if (center.patchVersion !== '13.16.0') fail(`unexpected center patch ${center.patchVersion}`);
if (center.liveExecutionEnabled !== false || center.automaticOrderSubmission !== false) fail('center execution safety changed');
if (policy.safety.liveExecutionEnabled !== false || policy.safety.automaticOrderSubmission !== false) fail('operational policy execution safety changed');
if (policy.safety.strategyRulesChanged !== false) fail('operational package claims strategy rules changed');
if (policy.safety.rankingRulesChanged !== false) fail('operational package claims ranking rules changed');
if (policy.safety.activationThresholdsChanged !== false) fail('activation thresholds changed');
if (ops.strategyRulesChanged !== false || ops.rankingRulesChanged !== false) fail('health output reports rule changes');
if (shadow.affectsProductionRanking !== false || shadow.affectsProductionDecision !== false) fail('shadow lab can affect production');
if (shadow.changesStrategyRules !== false) fail('shadow lab changed strategy rules');
if (workflowAudit.auditMode !== 'REPORT_ONLY' || workflowAudit.automaticArchiveEnabled !== false) fail('workflow audit is destructive');
if (report.strategyRulesChanged !== false || report.rankingRulesChanged !== false) fail('daily report reports rule changes');
if (report.reportHash !== hash(report)) fail('daily report hash mismatch');
if (report.sessionDate !== String(center.analysisSession || '').slice(0, 10)) fail('daily report session mismatch');

// Lock the activation thresholds used before V13.16.
const paper = evidencePolicy.activation?.activePaper || {};
const limited = evidencePolicy.activation?.activeLimited || {};
if (paper.minimumClosedTrades !== 30 || paper.minimumForwardSessions !== 10 ||
    paper.minimumProfitFactor !== 1.15 || paper.maximumDrawdownPct !== 20) {
  fail('ACTIVE_PAPER thresholds changed');
}
if (limited.minimumClosedTrades !== 50 || limited.minimumForwardSessions !== 20 ||
    limited.minimumProfitFactor !== 1.20 || limited.maximumDrawdownPct !== 15) {
  fail('ACTIVE_LIMITED thresholds changed');
}

console.log(`V13.16 operational acceptance passed: state=${ops.state}, scheduledLegacy=${workflowAudit.counts?.scheduledLegacy || 0}, report=${report.sessionDate}.`);
