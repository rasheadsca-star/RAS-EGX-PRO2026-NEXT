#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function canonicalOpportunity(row) {
  return {
    ticker: row.ticker,
    status: row.status,
    entryLow: finite(row.tradePlan?.entryLow),
    entryHigh: finite(row.tradePlan?.entryHigh),
    stop: finite(row.tradePlan?.stop),
    target1: finite(row.tradePlan?.target1),
    target2: finite(row.tradePlan?.target2),
    positionWeightPct: finite(row.suggestedPositionWeightPct) || 0,
  };
}

const current = read('data/v20/current.json');
const v17 = read('data/v17/current.json');
const gate = read('data/v17/resilient-session-status.json');
const v19 = read('data/v19/native-challenger-v6.json');
const ranking = read('data/final-opportunity-ranking.json');
const market = read('data/market.json');
const policy = read('data/v20/policy-registry.json');
const models = read('data/v20/model-registry.json');
const riskAudit = read('data/v20/risk-reward-audit.json');

if (!current.sessionDate) throw new Error('V20 current sessionDate is required for immutable signal archive');

// Intentionally narrow immutable core: future analytical/profile fields must not change
// the hash of an already issued V20 decision signal.
const immutableCore = {
  schemaVersion: '20.0.0-immutable-signal-core-1',
  sessionDate: current.sessionDate,
  activeChampion: current.governance?.activeChampion || null,
  executionStatus: current.executionStatus,
  decisionSupportOnly: current.decisionSupportOnly === true,
  portfolio: {
    riskState: current.portfolio?.riskState || null,
    recommendedExposurePct: finite(current.portfolio?.recommendedExposurePct) || 0,
    cashPct: finite(current.portfolio?.cashPct) || 100,
  },
  opportunities: (current.opportunities || []).map(canonicalOpportunity),
};
const immutableSignalHash = sha(immutableCore);
const archiveDir = 'data/v20/signal-archive';
const archiveRel = `${archiveDir}/${current.sessionDate}-${immutableSignalHash.slice(0, 12)}.json`;
const archivePath = P(archiveRel);
const archivedAt = new Date().toISOString();

const sourceFingerprint = sha({
  v17GeneratedAt: v17.generatedAt || null,
  gateGeneratedAt: gate.generatedAt || null,
  v19GeneratedAt: v19.generatedAt || null,
  rankingGeneratedAt: ranking.generatedAt || null,
  marketSessionDate: market.sessionDate || current.sessionDate,
  policySchema: policy.schemaVersion || null,
  modelRegistrySchema: models.schemaVersion || null,
});

const archivePayload = {
  schemaVersion: '20.0.0-signal-archive-1',
  archivedAt,
  sessionDate: current.sessionDate,
  immutableSignalHash,
  immutableHashContract: 'ONLY_ISSUED_DECISION_FIELDS_IN_IMMUTABLE_CORE; LATER_ANALYTICAL_FIELDS_DO_NOT_CHANGE_HASH',
  immutableCore,
  issuedSnapshot: {
    status: current.status,
    executionStatus: current.executionStatus,
    marketStatus: current.marketStatus,
    dataStatus: current.dataStatus,
    governance: current.governance,
    portfolio: current.portfolio,
    opportunities: current.opportunities,
    riskRewardPolicy: current.riskRewardPolicy || null,
    warnings: current.warnings || [],
  },
  evidence: {
    sourceFingerprint,
    riskRewardAuditPrimaryMetric: riskAudit.primaryMetric || null,
    v17GateExecutionGrade: gate.executionGrade === true,
    v19ResearchOnly: true,
  },
};

let archiveState = 'CREATED';
if (fs.existsSync(archivePath)) {
  const existing = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  if (existing.immutableSignalHash !== immutableSignalHash || JSON.stringify(existing.immutableCore) !== JSON.stringify(immutableCore)) {
    throw new Error(`Immutable archive collision at ${archiveRel}`);
  }
  archiveState = 'ALREADY_ARCHIVED_IMMUTABLE';
} else {
  write(archiveRel, archivePayload);
}

const indexRel = `${archiveDir}/index.json`;
const index = read(indexRel, {
  schemaVersion: '20.0.0-signal-archive-index-1',
  entries: [],
});
if (!Array.isArray(index.entries)) index.entries = [];
if (!index.entries.some(entry => entry.immutableSignalHash === immutableSignalHash)) {
  index.entries.push({
    sessionDate: current.sessionDate,
    immutableSignalHash,
    file: archiveRel,
    archivedAt,
    executionStatus: current.executionStatus,
    recommendedExposurePct: finite(current.portfolio?.recommendedExposurePct) || 0,
  });
}
index.entries.sort((a, b) => `${a.sessionDate}:${a.immutableSignalHash}`.localeCompare(`${b.sessionDate}:${b.immutableSignalHash}`));
index.updatedAt = new Date().toISOString();
index.count = index.entries.length;
write(indexRel, index);

const forwardRel = 'data/v20/forward-evaluation.json';
const forward = read(forwardRel, {
  schemaVersion: '20.0.0-forward-evaluation-1',
  horizonsSessions: [1, 3, 5, 10, 20],
  evaluations: [],
});
if (!Array.isArray(forward.evaluations)) forward.evaluations = [];
const horizons = [1, 3, 5, 10, 20];
for (const horizonSessions of horizons) {
  const keyExists = forward.evaluations.some(x => x.immutableSignalHash === immutableSignalHash && x.horizonSessions === horizonSessions);
  if (!keyExists) {
    forward.evaluations.push({
      sessionDate: current.sessionDate,
      immutableSignalHash,
      horizonSessions,
      status: 'PENDING',
      evaluationSessionDate: null,
      portfolioReturnGrossPct: null,
      portfolioReturnNetPct: null,
      resolvedPositionCount: 0,
      ambiguousPositionCount: 0,
      note: 'Created at signal issuance. Outcome must be resolved later from point-in-time market data without rewriting the archived signal.',
    });
  }
}
forward.horizonsSessions = horizons;
forward.updatedAt = new Date().toISOString();
forward.evaluations.sort((a, b) => `${a.sessionDate}:${a.immutableSignalHash}:${a.horizonSessions}`.localeCompare(`${b.sessionDate}:${b.immutableSignalHash}:${b.horizonSessions}`));
write(forwardRel, forward);

console.log(JSON.stringify({
  sessionDate: current.sessionDate,
  immutableSignalHash,
  archiveFile: archiveRel,
  archiveState,
  archiveCount: index.count,
  pendingForwardEvaluationsForSignal: forward.evaluations.filter(x => x.immutableSignalHash === immutableSignalHash && x.status === 'PENDING').length,
}, null, 2));
