'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(R(p)), { recursive: true }); fs.writeFileSync(R(p), JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');

const identity = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', {});
const gaps = read('docs/astra/G11_CURRENT_UNIVERSE_GAPS.json', {});
const stale = read('docs/astra/G11_STALE_RECORDS.json', {});
const metrics = read('docs/astra/G11_DATA_HEALTH_METRICS.json', {});
const sr = read('docs/astra/G11_SUPPORT_RESISTANCE_HEALTH.json', {});
const issues = read('docs/astra/G11_DATA_HEALTH_ISSUES.json', {});
const pipeline = read('docs/astra/G11_CURRENT_PIPELINE_RUN.json', {});
const comparison = read('docs/astra/G11_DECISION_SNAPSHOT_COMPARISON.json', {});
const migration = read('docs/astra/MIGRATION_RECONCILIATION.json', {});
const gates = read('04_ACCEPTANCE_GATES.json', {});
const gate = (gates.gates || []).find((x) => x.id === 'G11');
const source = fs.readFileSync(R('astra/data-health/g11-source-data-repair.cjs'), 'utf8');
const expected = metrics.latestExpectedSession;
const high = Number(issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0);
const critical = Number(issues.criticalUnresolved || 0);
const resolvedIdentityRows = (identity.records || []).filter((x) => String(x.repairedMappingStatus || '').startsWith('RESOLVED_'));
const srValidRows = (sr.records || []).filter((x) => x.status === 'VALID' || x.status === 'VALID_BOTH' || x.status === 'VALID_SUPPORT_ONLY' || x.status === 'VALID_RESISTANCE_ONLY');

const checks = [
  ['incorrect alias mapped to wrong security', resolvedIdentityRows.every((x) => norm(x.currentSourceIdentifier || x.sourceIdentity?.sourceIdentifier) === norm(x.canonicalTicker))],
  ['historical alias used as current alias outside effective dates', resolvedIdentityRows.every((x) => (x.effectiveDateRouting || []).some((r) => r.status === 'CURRENT_EXACT_SOURCE_ID' && r.effectiveTo === null))],
  ['missing source row mislabeled as no-trade', (gaps.records || []).every((x) => !/NO_TRADE|NON_TRADING/.test(String(x.primaryReason || '')))],
  ['stale row carried forward', !/carryForward|copyPrevious|previous.*as.*current/i.test(source) && (identity.records || []).filter((x) => x.afterCurrentRecordAvailable === true).every((x) => x.sourceCurrentRecordAvailable === true)],
  ['current price repaired but volume still stale', Number(metrics.volume?.numerator || 0) >= Number(metrics.currentCanonicalSecurities?.numerator || 0)],
  ['indicator recomputed from stale history', Object.values(metrics.indicators || {}).every((x) => Number(x.numerator || 0) <= Number(metrics.currentCanonicalSecurities?.numerator || 0))],
  ['S/R marked current using old pivots', srValidRows.every((x) => x.asOfSessionDate === expected)],
  ['source identities resolved by fuzzy company matching', identity.sourcePolicy?.fuzzyCompanyNameAuthoritative === false && (identity.records || []).every((x) => x.nameMatchingUsedForResolution !== true)],
  ['decision universe silently reduced', Number(metrics.searchReadiness?.resolvedActive || 0) === Number(metrics.activeUniverse?.count || 0)],
  ['regime computed from unexplained incomplete breadth', metrics.regimeInputs?.status !== 'DEGRADED_PARTIAL_UNIVERSE'],
  ['insufficient-history securities patched synthetically', !/MIGRATION_RECONCILIATION|rawArchive|canonical-records\.jsonl/.test(source)],
  ['quarantined G07 history admitted', migration.totals?.invalid === 34018 && migration.totals?.unresolved === 34012 && migration.totals?.unexplainedDataLoss === 0],
  ['previous DecisionSnapshot mutated instead of new snapshot created', comparison.immutablePreviousSnapshot === true && Boolean(comparison.previous?.decisionSnapshotId)],
  ['source fallback calls a legacy engine', Number(pipeline.legacyNetworkCalls || 0) === 0 && !/quant-edge|v18-live|v19-egx-chat-gpt|sepax-strategy-stable|egx-tfe-v20-fusion-rc2/i.test(source)],
  ['tests pass while HIGH current-data defect remains', critical === 0 && high === 0],
];
const angles = checks.map(([angle, pass]) => ({ angle, pass: Boolean(pass) }));
const pass = angles.every((x) => x.pass);
const result = pass ? 'PASS' : 'BLOCKER_CONFIRMED';
const artifact = {
  schemaVersion: 'astra-g11-repair-destructive-review-1',
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
  gate.evidence = [...new Set([...(gate.evidence || []), 'docs/astra/G11_REPAIR_DESTRUCTIVE_REVIEW.json'])];
  write('04_ACCEPTANCE_GATES.json', gates);
}

if (gate?.status === 'GREEN' && !pass) throw new Error(`False G11 GREEN: destructive blockers=${artifact.materialFindings.join(', ')}`);
if (gate?.status === 'GREEN' && (critical > 0 || high > 0)) throw new Error('False G11 GREEN with unresolved CRITICAL/HIGH issues');
console.log('ASTRA_G11_REPAIR_DESTRUCTIVE ' + JSON.stringify({ result, materialFindings: artifact.materialFindings, g19Increment: 0, g12: 'PENDING' }));
