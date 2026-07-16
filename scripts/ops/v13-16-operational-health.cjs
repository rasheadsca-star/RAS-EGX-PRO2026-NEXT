#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-16-operational-policy.json'),
  center: path.join(ROOT, 'data', 'quant', 'unified-autonomous-center-v13-14.json'),
  ledger: path.join(ROOT, 'data', 'evidence', 'paper-signals-v13-15.json'),
  health: path.join(ROOT, 'data', 'quant', 'strategy-health-v13-15.json'),
  workflowAudit: path.join(ROOT, 'data', 'ops', 'workflow-inventory-v13-16.json'),
  sourceHealth: path.join(ROOT, 'data', 'source-health.json'),
  sourceAudit: path.join(ROOT, 'data', 'source-audit.json'),
  sourceFetch: path.join(ROOT, 'data', 'source-fetch-report.json'),
  gateway: path.join(ROOT, 'data', 'source-gateway-report.json'),
  finalization: path.join(ROOT, 'data', 'postclose', 'latest-finalization.json'),
  output: path.join(ROOT, 'data', 'ops', 'operational-health-v13-16.json')
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function dateValue(...values) {
  for (const value of values) {
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function ageMinutes(...values) {
  const time = dateValue(...values);
  return time === null ? null : Math.max(0, (Date.now() - time) / 60000);
}
function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function cairoNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'long', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((acc, item) => (acc[item.type] = item.value, acc), {});
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday
  };
}
function sourceCoverage(center, sourceHealth, sourceAudit, gateway) {
  const candidates = [
    center?.finalization?.coveragePct,
    sourceHealth?.coveragePct,
    sourceHealth?.summary?.coveragePct,
    sourceAudit?.coveragePct,
    sourceAudit?.summary?.coveragePct,
    gateway?.coveragePct,
    gateway?.summary?.coveragePct
  ].map(value => n(value)).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

const policy = readJson(FILES.policy);
const center = readJson(FILES.center);
const ledger = readJson(FILES.ledger, { signals: [], counts: {} });
const health = readJson(FILES.health, { strategies: [], summary: {} });
const workflowAudit = readJson(FILES.workflowAudit, { status: 'UNKNOWN', counts: {}, warnings: [] });
const sourceHealth = readJson(FILES.sourceHealth, {});
const sourceAudit = readJson(FILES.sourceAudit, {});
const sourceFetch = readJson(FILES.sourceFetch, {});
const gateway = readJson(FILES.gateway, {});
const finalization = readJson(FILES.finalization, {});
if (!policy) throw new Error('Missing operational policy');

const now = cairoNow();
const coveragePct = sourceCoverage(center, sourceHealth, sourceAudit, gateway);
const centerAge = ageMinutes(center?.generatedAt);
const sourceAge = ageMinutes(
  sourceFetch?.generatedAt, sourceFetch?.fetchedAt,
  gateway?.generatedAt, sourceHealth?.generatedAt,
  sourceAudit?.generatedAt
);
const marketAge = n(center?.candidates?.[0]?.dataAgeMinutes, null);
const critical = [];
const warnings = [];
const info = [];

if (!center) critical.push('Unified center output is missing.');
if (center?.liveExecutionEnabled !== false) critical.push('Live execution is not explicitly disabled.');
if (center?.automaticOrderSubmission !== false) critical.push('Automatic order submission is not explicitly disabled.');
if (center?.sessionIntegrity?.ok !== true) critical.push('Analysis layers do not share one confirmed session.');
if (center?.patchVersion !== '13.17.0') critical.push(`Unexpected center patch: ${center?.patchVersion || 'missing'}.`);
if (!fs.existsSync(FILES.ledger)) critical.push('Immutable paper ledger is missing.');
if (!fs.existsSync(FILES.health)) critical.push('Forward strategy health output is missing.');

if (center?.marketCurrent !== true) warnings.push('Market snapshot is not marked current.');
if (centerAge !== null && centerAge > n(policy.freshness.centerMaximumMinutes, 180)) {
  warnings.push(`Unified center is ${round(centerAge, 1)} minutes old.`);
}
if (sourceAge !== null && sourceAge > n(policy.freshness.sourceMaximumMinutes, 180)) {
  warnings.push(`Latest source report is ${round(sourceAge, 1)} minutes old.`);
}
if (marketAge !== null && marketAge > n(policy.freshness.marketMaximumMinutes, 90)) {
  warnings.push(`Candidate market data age reached ${round(marketAge, 1)} minutes.`);
}
if (coveragePct !== null && coveragePct < n(policy.coverage.criticalBelowPct, 90)) {
  critical.push(`Data coverage is only ${round(coveragePct, 2)}%.`);
} else if (coveragePct !== null && coveragePct < n(policy.coverage.warningBelowPct, 98)) {
  warnings.push(`Data coverage is ${round(coveragePct, 2)}%, below preferred 98%.`);
}
if (n(workflowAudit?.counts?.scheduledLegacy, 0) > 0) {
  warnings.push(`${workflowAudit.counts.scheduledLegacy} scheduled legacy workflow(s) may cause independent updates.`);
}
if (n(workflowAudit?.counts?.pageDeployers, 0) > 1) {
  warnings.push(`${workflowAudit.counts.pageDeployers} workflows can deploy Pages.`);
}
if (n(health?.summary?.closedTrades, 0) === 0) {
  info.push('No forward paper trade has closed yet; strategy evidence remains immature.');
}

const state = critical.length ? 'CRITICAL' : warnings.length ? 'WARNING' : 'HEALTHY';
const stateLabelAr = state === 'HEALTHY' ? 'سليم' : state === 'WARNING' ? 'يحتاج متابعة' : 'موقوف';
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

const output = {
  schemaVersion: '13.17.0',
  generatedAt: new Date().toISOString(),
  cairo: now,
  state,
  stateLabelAr,
  strategyRulesChanged: false,
  rankingRulesChanged: false,
  productionDecisionRulesChanged: false,
  liveExecutionEnabled: false,
  automaticOrderSubmission: false,
  session: {
    analysisSession: center?.analysisSession || null,
    marketDate: center?.marketDate || null,
    sessionIntegrity: center?.sessionIntegrity?.ok === true,
    marketCurrent: center?.marketCurrent === true,
    centerAgeMinutes: round(centerAge, 1),
    sourceAgeMinutes: round(sourceAge, 1),
    marketDataAgeMinutes: round(marketAge, 1)
  },
  data: {
    coveragePct: round(coveragePct, 2),
    marketRows: n(sourceHealth?.rows, n(sourceFetch?.rows, n(gateway?.rows, null))),
    historyFiles: fs.existsSync(path.join(ROOT, 'data', 'history'))
      ? fs.readdirSync(path.join(ROOT, 'data', 'history')).filter(name => name.endsWith('.json')).length
      : 0
  },
  evidence: {
    registeredSignals: n(health?.summary?.registeredSignals, A(ledger.signals).length),
    closedTrades: n(health?.summary?.closedTrades, 0),
    activePaperStrategies: n(health?.summary?.activePaperStrategies, 0),
    activeLimitedStrategies: n(health?.summary?.activeLimitedStrategies, 0),
    researchOnlyStrategies: n(health?.summary?.researchOnlyStrategies, A(health.strategies).length),
    evidenceGate: health?.summary?.evidenceGate || 'RESEARCH_ONLY'
  },
  workflows: {
    auditStatus: workflowAudit?.status || 'UNKNOWN',
    total: n(workflowAudit?.counts?.total, 0),
    scheduledLegacy: n(workflowAudit?.counts?.scheduledLegacy, 0),
    pageDeployers: n(workflowAudit?.counts?.pageDeployers, 0),
    repositoryWriters: n(workflowAudit?.counts?.repositoryWriters, 0),
    warnings: A(workflowAudit?.warnings)
  },
  run: {
    runId: process.env.GITHUB_RUN_ID || null,
    runNumber: process.env.GITHUB_RUN_NUMBER || null,
    sha: process.env.GITHUB_SHA || null,
    actor: process.env.GITHUB_ACTOR || null,
    eventName: process.env.GITHUB_EVENT_NAME || null,
    url: runUrl,
    controller: '.github/workflows/install-and-run-v13-14-unified-center-final.yml',
    scheduleNoteAr: 'التشغيل التلقائي كل 15 دقيقة داخل نافذة الجدول، مع تثبيت ما بعد الإغلاق.'
  },
  finalization: {
    status: center?.finalization?.status || finalization?.status || null,
    coveragePct: round(center?.finalization?.coveragePct, 2),
    accepted: n(center?.finalization?.accepted, null),
    eligible: n(center?.finalization?.eligible, null)
  },
  critical,
  warnings,
  info
};
writeJson(FILES.output, output);
console.log(`V13.17 operational health: state=${state}, critical=${critical.length}, warnings=${warnings.length}.`);
