'use strict';
const fs = require('fs');
const path = require('path');
const G = require('./g11-carry-forward-guard.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(R(p)), { recursive: true }); fs.writeFileSync(R(p), JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');

const identity = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', {});
const repair = read('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', {});
const gaps = read('docs/astra/G11_CURRENT_UNIVERSE_GAPS.json', {});
const stale = read('docs/astra/G11_STALE_RECORDS.json', {});
const metrics = read('docs/astra/G11_DATA_HEALTH_METRICS.json', {});
const sr = read('docs/astra/G11_SUPPORT_RESISTANCE_HEALTH.json', {});
const issues = read('docs/astra/G11_DATA_HEALTH_ISSUES.json', {});
const pipeline = read('docs/astra/G11_CURRENT_PIPELINE_RUN.json', {});
const comparison = read('docs/astra/G11_DECISION_SNAPSHOT_COMPARISON.json', {});
const migration = read('docs/astra/MIGRATION_RECONCILIATION.json', {});
const guard = read('docs/astra/G11_GUARD37_EVIDENCE.json', {});
const build = read('docs/astra/G11_DERIVED_BUILD_FAILURES.json', {});
const stockIndex = read('data/quant/stock-intelligence-index.json', {});
const gates = read('04_ACCEPTANCE_GATES.json', {});
const gate = (gates.gates || []).find((x) => x.id === 'G11');
const source = fs.readFileSync(R('astra/data-health/g11-source-data-repair.cjs'), 'utf8');
const expected = metrics.latestExpectedSession;
const high = Number(issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0);
const critical = Number(issues.criticalUnresolved || 0);
const resolvedIdentityRows = (identity.records || []).filter((x) => String(x.repairedMappingStatus || '').startsWith('RESOLVED_'));
const srValidRows = (sr.records || []).filter((x) => ['VALID','VALID_BOTH','VALID_SUPPORT_ONLY','VALID_RESISTANCE_ONLY'].includes(x.status));
const altAcceptedRows = (identity.records || []).filter((x) => x.afterCurrentRecordAvailable === true && x.sourceCurrentRecordAvailable !== true);
const hiddenRenameFixture = "function restoreCurrent(previousRow) { return { sessionDate: expectedSession, close: previousRow.close, volume: previousRow.volume }; }";
const feature = new Map((repair.finalCertification?.featureReadiness || []).map((x) => [norm(x.ticker), x]));

const checks = [
  ['guard #37 false negative after false-positive fix', guard.status === 'PASS' && guard.selfTests?.failed === 0 && G.analyzeCarryForwardSource(source).length === 0],
  ['unsafe carry-forward hidden behind renamed helper', G.analyzeCarryForwardSource(hiddenRenameFixture).length > 0],
  ['historical alias used as current alias outside effective dates', resolvedIdentityRows.every((x) => (x.effectiveDateRouting || []).some((r) => r.status === 'CURRENT_EXACT_SOURCE_ID' && r.effectiveTo === null))],
  ['exact-source identity mapped to wrong security', resolvedIdentityRows.every((x) => norm(x.currentSourceIdentifier || x.sourceIdentity?.sourceIdentifier) === norm(x.canonicalTicker))],
  ['unsupported security incorrectly treated as legitimate exclusion', (identity.records || []).filter((x) => x.productionRelevantBlocker === false && x.repairedMappingStatus !== 'RESOLVED_EXACT_SOURCE_ID').every((x) => Boolean(x.alternativeCanonicalCurrentEvidence))],
  ['stale source cached as current', (stale.records || []).every((x) => x.actualSession !== expected)],
  ['price current but volume or turnover stale', Number(metrics.volume?.numerator || 0) >= Number(metrics.currentCanonicalSecurities?.numerator || 0) && Number(metrics.turnoverDecisionProxy?.numerator || 0) >= Number(metrics.currentCanonicalSecurities?.numerator || 0)],
  ['indicator rebuild using stale underlying history', Object.values(metrics.indicators || {}).every((x) => Number(x.numerator || 0) <= Number(metrics.currentCanonicalSecurities?.numerator || 0))],
  ['S/R merely timestamp-refreshed rather than recomputed', srValidRows.every((x) => x.asOfSessionDate === expected) && Number(sr.finalTaxonomy?.COMPUTATION_FAILED || 0) === 0 && Number(sr.finalTaxonomy?.UNEXPLAINED_NULL || 0) === 0],
  ['regime universe silently shrunk', Number(metrics.regimeInputs?.analyzed || 0) <= Number(metrics.activeUniverse?.count || 0) && Number(metrics.searchReadiness?.resolvedActive || 0) === Number(metrics.activeUniverse?.count || 0)],
  ['stock-intelligence build failure hidden as omission', build.accountingCloses === true && build.unexplainedBuildFailures === 0 && Number(build.totalBuildFailures || 0) === Number(stockIndex.counts?.failures || 0)],
  ['AMES GRCA LUTS PHGC isolated fixtures pass but market-wide readiness fails silently', ['AMES','GRCA','LUTS','PHGC'].every((ticker) => feature.has(ticker) && feature.get(ticker).validHistorySessions >= 60)],
  ['quarantined history used for repairs', migration.totals?.invalid === 34018 && migration.totals?.unresolved === 34012 && migration.totals?.unexplainedDataLoss === 0 && !/MIGRATION_RECONCILIATION|rawArchive|canonical-records\.jsonl/.test(source)],
  ['legacy output used as fallback', Number(pipeline.legacyNetworkCalls || 0) === 0 && !/quant-edge|v18-live|v19-egx-chat-gpt|sepax-strategy-stable|egx-tfe-v20-fusion-rc2/i.test(source)],
  ['tests green while HIGH production-relevant blocker remains', critical === 0 && high === 0],
  ['alternative current canonical row accepted without evidence', altAcceptedRows.every((x) => Boolean(x.alternativeCanonicalCurrentEvidence))],
  ['previous DecisionSnapshot mutated instead of new snapshot created', comparison.immutablePreviousSnapshot === true && Boolean(comparison.previous?.decisionSnapshotId) && Boolean(comparison.repairedCurrent?.decisionSnapshotId)],
];
const angles = checks.map(([angle, pass]) => ({ angle, pass: Boolean(pass) }));
const pass = angles.every((x) => x.pass);
const result = pass ? 'PASS' : 'BLOCKER_CONFIRMED';
const artifact = {
  schemaVersion: 'astra-g11-repair-destructive-review-2',
  generatedAt: new Date().toISOString(),
  scope: 'G11_REPAIR_ONLY_DOES_NOT_INCREMENT_G19',
  gateStatus: gate?.status || null,
  result,
  angles,
  materialFindings: angles.filter((x) => !x.pass).map((x) => x.angle),
  g19Increment: 0,
  g12Status: 'PENDING',
};
write('docs/astra/G11_REPAIR_DESTRUCTIVE_REVIEW.json', artifact);

const testEvidence = read('docs/astra/G11_TEST_EVIDENCE.json', {});
testEvidence.focusedDestructiveReview = result;
testEvidence.g19Increment = 0;
write('docs/astra/G11_TEST_EVIDENCE.json', testEvidence);

if (gate) {
  gate.evidence = [...new Set([...(gate.evidence || []), 'docs/astra/G11_REPAIR_DESTRUCTIVE_REVIEW.json', 'docs/astra/G11_GUARD37_EVIDENCE.json', 'docs/astra/G11_DERIVED_BUILD_FAILURES.json'])];
  write('04_ACCEPTANCE_GATES.json', gates);
}

if (gate?.status === 'GREEN' && !pass) throw new Error(`False G11 GREEN: destructive blockers=${artifact.materialFindings.join(', ')}`);
if (gate?.status === 'GREEN' && (critical > 0 || high > 0)) throw new Error('False G11 GREEN with unresolved CRITICAL/HIGH issues');
console.log('ASTRA_G11_REPAIR_DESTRUCTIVE ' + JSON.stringify({ result, materialFindings: artifact.materialFindings, g19Increment: 0, g12: 'PENDING' }));
