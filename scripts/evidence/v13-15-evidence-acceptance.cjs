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
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function registrationFields(signal) {
  return {
    schemaVersion: signal.schemaVersion,
    id: signal.id,
    signalDate: signal.signalDate,
    ticker: signal.ticker,
    strategyId: signal.strategyId,
    tier: signal.tier,
    unifiedRank: signal.unifiedRank,
    recommendationScore: signal.recommendationScore,
    riskPct: signal.riskPct,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    target2: signal.target2,
    sourcePatchVersion: signal.sourcePatchVersion,
    sourceCenterHash: signal.sourceCenterHash
  };
}
function fail(message) {
  console.error(`V13.17.1 EVIDENCE ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}
function passes(metrics, gate) {
  return metrics.closedTrades >= n(gate.minimumClosedTrades, Infinity) &&
    metrics.forwardSessions >= n(gate.minimumForwardSessions, Infinity) &&
    metrics.profitFactor >= n(gate.minimumProfitFactor, Infinity) &&
    metrics.averageR > n(gate.minimumAverageR, 0) &&
    metrics.medianR > n(gate.minimumMedianR, 0) &&
    metrics.maxDrawdownPct <= n(gate.maximumDrawdownPct, -Infinity);
}

const policy = read('data/v13-15-evidence-policy.json');
const ledger = read('data/evidence/paper-signals-v13-15.json');
const health = read('data/quant/strategy-health-v13-15.json');
const center = read('data/quant/unified-autonomous-center-v13-14.json');

if (policy.safety.liveExecutionEnabled !== false) fail('policy live execution must be disabled');
if (policy.safety.automaticOrderSubmission !== false) fail('automatic orders must be disabled');
if (ledger.immutableRegistration !== true) fail('ledger immutable registration flag missing');
if (center.liveExecutionEnabled !== false || center.automaticOrderSubmission !== false) fail('center live execution is not closed');
if (center.patchVersion !== '13.17.1') fail(`unexpected center patch ${center.patchVersion}`);

const ids = A(ledger.signals).map(signal => signal.id);
if (new Set(ids).size !== ids.length) fail('duplicate signal IDs');

const allowedStatuses = new Set([
  'PENDING_ENTRY', 'OPEN', 'CLOSED_TARGET1', 'CLOSED_STOP',
  'CLOSED_TIME', 'EXPIRED_NO_ENTRY', 'DATA_ERROR'
]);
for (const signal of A(ledger.signals)) {
  if (!allowedStatuses.has(signal.status)) fail(`${signal.id} invalid status ${signal.status}`);
  if (hash(registrationFields(signal)) !== signal.registrationHash) fail(`${signal.id} immutable registration hash mismatch`);
  if (!(Number(signal.entryLow) > Number(signal.stopLoss))) fail(`${signal.id} invalid entry/stop`);
  if (!(Number(signal.target1) > Number(signal.entryHigh))) fail(`${signal.id} invalid target`);
  if (String(signal.status).startsWith('CLOSED') && !Number.isFinite(Number(signal.netR))) {
    fail(`${signal.id} closed without netR`);
  }
}

const healthMap = new Map(A(health.strategies).map(item => [item.strategyId, item]));
for (const item of A(health.strategies)) {
  if (!['RESEARCH_ONLY', 'ACTIVE_PAPER', 'ACTIVE_LIMITED'].includes(item.status)) {
    fail(`${item.strategyId} invalid evidence status ${item.status}`);
  }
  if (item.status === 'ACTIVE_PAPER' && !passes(item.metrics, policy.activation.activePaper)) {
    fail(`${item.strategyId} ACTIVE_PAPER without passing its gate`);
  }
  if (item.status === 'ACTIVE_LIMITED' && !passes(item.metrics, policy.activation.activeLimited)) {
    fail(`${item.strategyId} ACTIVE_LIMITED without passing its gate`);
  }
}

for (const candidate of A(center.candidates)) {
  if (candidate.finalDecision?.actionable === true) {
    const evidence = healthMap.get(candidate.strategyId);
    if (!evidence || !['ACTIVE_PAPER', 'ACTIVE_LIMITED'].includes(evidence.status)) {
      fail(`${candidate.ticker} actionable without forward evidence activation`);
    }
  }
}

console.log(`V13.17.1 evidence acceptance passed: signals=${ids.length}, strategies=${health.strategies.length}.`);
