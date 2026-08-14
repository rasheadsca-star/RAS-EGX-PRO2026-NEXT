#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/regression.json';

function exists(rel) { return fs.existsSync(P(rel)); }
function readText(rel) { try { return fs.readFileSync(P(rel), 'utf8'); } catch { return ''; } }
function readJson(rel, fallback = {}) { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function near(a, b, tolerance = 0.02) {
  const x = finite(a), y = finite(b);
  return x !== null && y !== null && Math.abs(x - y) <= tolerance;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const tests = [];
function test(name, ok, message, severity = 'CRITICAL') {
  tests.push({ name, ok: ok === true, severity, message: String(message || '') });
}

const requiredFiles = [
  'preview-v17/app/index.html',
  'preview-v17/app/app.js',
  'preview-v17/app/styles.css',
  'preview-v17/app/confidence-governance.js',
  'scripts/v17/build-snapshot.cjs',
  'scripts/v17/resolve-ledger.cjs',
  'scripts/v17/challenger-gate.cjs',
  'scripts/v17/resilient-session-gate.cjs',
  'data/v17/current.json',
  'data/v17/ledger.json',
  'data/v17/challenger-status.json',
  'data/v17/review.json',
  'data/v17/resilient-session-status.json',
  'data/v17/internal-ohlc-support-resistance.json',
];
for (const rel of requiredFiles) test(`file:${rel}`, exists(rel), exists(rel) ? 'exists' : 'missing');

const index = readText('preview-v17/app/index.html');
const app = readText('preview-v17/app/app.js');
const confidenceGovernance = readText('preview-v17/app/confidence-governance.js');
const resolverSource = readText('scripts/v17/resolve-ledger.cjs');
const snapshotSource = readText('scripts/v17/build-snapshot.cjs');
const runtimeSource = `${index}\n${app}\n${confidenceGovernance}`;

for (const view of ['dashboard', 'market', 'portfolio', 'evidence', 'health']) {
  test(`ui:view:${view}`, index.includes(`id="view-${view}"`) && index.includes(`data-view="${view}"`), `V17 view ${view}`);
}
for (const id of ['snapshotStatus', 'sessionMetrics', 'allocationMetrics', 'recommendationGrid', 'marketSearch', 'marketRows', 'portfolioSummary', 'nativeEvidence', 'researchEvidence', 'healthChecks']) {
  test(`ui:id:${id}`, index.includes(`id="${id}"`), `required V17 UI id ${id}`);
}
test('ui:rtl-arabic', /<html[^>]*lang="ar"[^>]*dir="rtl"/.test(index), 'Arabic RTL document contract');
test('ui:canonical-current-source', app.includes("../../data/v17/current.json"), 'V17 UI consumes canonical current snapshot');
test('ui:confidence-governance', index.includes('confidence-governance.js') && confidenceGovernance.includes('confidenceCapPct'), 'confidence governance is loaded');

const forbiddenRuntimeRefs = [
  'v15-practical-decision.json',
  'v15-update-status.json',
  'decision-source.js',
  'adaptive-daily-recommendations.json',
  'data/quant/adaptive',
  'v13-5-adaptive',
  'adaptive-recommendations.html',
];
for (const ref of forbiddenRuntimeRefs) {
  test(`runtime:forbidden:${ref}`, !runtimeSource.includes(ref), `legacy/adaptive runtime reference ${ref} must not enter V17`);
}

const current = readJson('data/v17/current.json');
const ledger = readJson('data/v17/ledger.json', { entries: [] });
const challenger = readJson('data/v17/challenger-status.json');
const review = readJson('data/v17/review.json');
const resilient = readJson('data/v17/resilient-session-status.json');
const internal = readJson('data/v17/internal-ohlc-support-resistance.json');
const candidate = exists('data/v17/challenger-candidate.json') ? readJson('data/v17/challenger-candidate.json') : null;

const allowedSnapshotStatuses = ['READY_FOR_NEXT_SESSION_REVIEW', 'RESEARCH_READY_EXECUTION_BLOCKED'];
test('snapshot:status', allowedSnapshotStatuses.includes(current.status), `snapshot status=${current.status}`);
test('snapshot:champion', current?.engine?.id === 'V16_9_EQUAL_WEIGHT_BASKET', `engine=${current?.engine?.id}`);
test('snapshot:single-production-engine', current?.engine?.singleProductionEngine === true && current?.engine?.selectionMethodFrozen === true, 'single frozen production engine');
test('snapshot:session-aligned', Boolean(current.sessionDate) && current.sessionDate === current?.systemHealth?.latestMarketSession && current.sessionDate === current?.currentResearch?.sessionDate, 'market/research session alignment');
test('snapshot:automatic-orders-off', current?.portfolioPolicy?.automaticOrders === false, 'automatic orders forbidden');
test('snapshot:max-allocation-policy', finite(current?.portfolioPolicy?.maximumTotalAllocationPct) === 50, `maximum=${current?.portfolioPolicy?.maximumTotalAllocationPct}`);
const plannedAllocation = finite(current?.portfolioPolicy?.plannedAllocationPct, 0);
test('snapshot:allocation-within-cap', plannedAllocation <= 50.0001, `planned=${plannedAllocation}`);

const executionGrade = current?.systemHealth?.executionGrade === true;
const recommendations = Array.isArray(current.recommendations) ? current.recommendations : [];
if (!executionGrade) {
  test('research-only:zero-allocation', plannedAllocation === 0, `planned=${plannedAllocation}`);
  test('research-only:no-executable-recommendation', recommendations.every(row => finite(row.portfolioWeightPct, 0) === 0 && row.executionAllowed !== true), `${recommendations.length} recommendations checked`);
  test('research-only:cash-preserved', finite(current?.portfolioPolicy?.cashReservePct, 0) === 100, `cash=${current?.portfolioPolicy?.cashReservePct}`);
}

const resilientStatusAllowed = ['HEALTHY', 'DEGRADED', 'RESEARCH_ONLY'];
test('gate:status', resilientStatusAllowed.includes(resilient.status), `status=${resilient.status}`);
test('gate:execution-consistency', resilient.executionGrade === executionGrade, `gate=${resilient.executionGrade}; snapshot=${executionGrade}`);
test('gate:research-ready', resilient?.readiness?.researchReady === true || resilient.status === 'HEALTHY', `researchReady=${resilient?.readiness?.researchReady}`);
if (Array.isArray(resilient.sourceConflicts) && resilient.sourceConflicts.length > 0) {
  test('gate:conflict-blocks-execution', resilient.executionGrade === false && executionGrade === false, `${resilient.sourceConflicts.length} source conflicts`);
}

const srCoverage = finite(current?.currentResearch?.supportResistanceCoveragePct);
test('sr:canonical-coverage', near(srCoverage, resilient.coveragePct), `current=${srCoverage}; gate=${resilient.coveragePct}`);
test('sr:internal-policy', internal?.policy?.mubasherRole === 'VALIDATION_COMPARISON_NOT_HARD_DEPENDENCY', `mubasherRole=${internal?.policy?.mubasherRole}`);
test('sr:methodology', internal.methodology === 'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC', `methodology=${internal.methodology}`);
test('sr:research-session', internal.referenceSessionDate === current.sessionDate, `reference=${internal.referenceSessionDate}; current=${current.sessionDate}`);
if (internal.sessionCompletionConfirmed === false && internal.referenceSessionDate && internal.levelSessionDate) {
  test('sr:partial-session-not-completed-ohlc', internal.levelSessionDate < internal.referenceSessionDate, `levels=${internal.levelSessionDate}; research=${internal.referenceSessionDate}`);
}
const internalRows = Array.isArray(internal.rows) ? internal.rows : [];
test('sr:row-provenance', internalRows.every(row => row.source === 'INTERNAL_OHLC_PIVOT' && row.sessionDate && row.freshness && finite(row.confidence) !== null && row.methodology && row.provenance?.input), `${internalRows.length} internal rows`);

const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
let immutableOk = true;
let allocationOk = true;
for (const entry of entries) {
  const rows = Array.isArray(entry.recommendations) ? entry.recommendations : [];
  const immutablePayload = {
    sessionDate: entry.sessionDate,
    engineId: entry.engineId,
    recommendations: rows.map(row => ({
      ticker: row.ticker,
      entryLow: row.entryLow,
      entryHigh: row.entryHigh,
      target: row.target,
      stop: row.stop,
      portfolioWeightPct: row.portfolioWeightPct,
    })),
  };
  if (!entry.signalHash || hash(immutablePayload) !== entry.signalHash) immutableOk = false;
  const total = rows.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0);
  if (total > 50.0001) allocationOk = false;
}
test('ledger:immutable-signal-hash', immutableOk, `${entries.length} ledger entries verified`);
test('ledger:allocation-cap', allocationOk, `${entries.length} ledger entries <= 50%`);
test('ledger:conservative-ambiguity', resolverSource.includes('targetTouched && stopTouched') && resolverSource.includes('AMBIGUOUS_TREATED_AS_STOP') && resolverSource.includes('exitPrice = finite(member.stop)'), 'same-session target/stop ambiguity resolves conservatively');
test('ledger:hash-contract-source', snapshotSource.includes('immutablePayload') && snapshotSource.includes('signalHash') && snapshotSource.includes('Immutable ledger conflict'), 'snapshot enforces immutable signal contract');

const totalRecommendationAllocation = recommendations.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0);
test('recommendations:total-allocation-guard', totalRecommendationAllocation <= 50.0001, `recommendation total=${totalRecommendationAllocation}`);

test('governance:active-champion', challenger.activeEngine === 'V16_9_EQUAL_WEIGHT_BASKET', `active=${challenger.activeEngine}`);
test('governance:no-auto-promotion', challenger.promotionAllowed === false && current?.championChallenger?.promotionAllowed === false, 'automatic promotion forbidden');
test('governance:current-engine-matches-champion', current?.championChallenger?.activeEngine === current?.engine?.id, 'snapshot and governance agree');
if (candidate) {
  test('governance:candidate-shadow-only', current?.engine?.id === 'V16_9_EQUAL_WEIGHT_BASKET' && challenger.promotionAllowed === false, `candidate=${candidate.engineId || 'unknown'} remains non-production`);
}

test('review:not-rejected', review.verdict !== 'REJECTED', `verdict=${review.verdict}`);
test('review:no-critical-major', finite(review?.counts?.CRITICAL, 0) === 0 && finite(review?.counts?.MAJOR, 0) === 0, `critical=${review?.counts?.CRITICAL}; major=${review?.counts?.MAJOR}`);

const failed = tests.filter(item => !item.ok);
const criticalFailed = failed.filter(item => item.severity === 'CRITICAL');
const output = {
  schemaVersion: '17.0.0-regression-1',
  generatedAt: new Date().toISOString(),
  contract: 'V17_CANONICAL_RUNTIME_AND_GOVERNANCE',
  ok: criticalFailed.length === 0,
  total: tests.length,
  passed: tests.length - failed.length,
  failedCount: failed.length,
  criticalFailedCount: criticalFailed.length,
  failed: failed.map(item => item.name),
  tests,
  legacyRegression: {
    path: 'data/app-regression-report.json',
    contract: 'V8.1.3_LEGACY_ROOT_INDEX',
    usedForV17Acceptance: false,
    reason: 'Legacy report asserts V8 root index routes/markers and is not the V17 preview application contract.',
  },
  invariants: {
    protectedChampion: 'V16_9_EQUAL_WEIGHT_BASKET',
    automaticPromotionForbidden: true,
    maximumTotalAllocationPct: 50,
    sameSessionAmbiguityPolicy: 'CONSERVATIVE_STOP',
    adaptiveLegacyRuntimeForbidden: true,
    mubasherRole: 'VALIDATION_COMPARISON_NOT_HARD_DEPENDENCY',
  },
};

writeJsonAtomic(OUT, output);
console.log(JSON.stringify({ ok: output.ok, total: output.total, passed: output.passed, failed: output.failed }, null, 2));
if (!output.ok) process.exitCode = 2;
