'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const readAbs = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(R(p)), { recursive: true }); fs.writeFileSync(R(p), JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const ensure = (c, m) => { if (!c) throw new Error(m); };
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');

const identity = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', {});
const repair = read('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', {});
const symbol = read('docs/astra/G11_SYMBOL_HEALTH.json', {});
const stale = read('docs/astra/G11_STALE_RECORDS.json', {});
const pipeline = read('docs/astra/G11_CURRENT_PIPELINE_RUN.json', {});
const metrics = read('docs/astra/G11_DATA_HEALTH_METRICS.json', {});
const issues = read('docs/astra/G11_DATA_HEALTH_ISSUES.json', {});
const readiness = read('docs/astra/G11_STRATEGY_DATA_READINESS.json', {});
const sr = read('docs/astra/G11_SUPPORT_RESISTANCE_HEALTH.json', {});
const tests = read('docs/astra/G11_TEST_EVIDENCE.json', {});
const gates = read('04_ACCEPTANCE_GATES.json', {});
const gate = (gates.gates || []).find((x) => x.id === 'G11');
ensure(gate, 'G11 gate missing');
ensure((gates.gates || []).find((x) => x.id === 'G12')?.status === 'PENDING', 'G12 changed');
ensure(pipeline.legacyNetworkCalls === 0 && pipeline.productionCutover === false, 'pipeline isolation violated');
ensure(identity.sourcePolicy?.fuzzyCompanyNameAuthoritative === false, 'fuzzy company-name resolution enabled');
ensure((identity.records || []).every((x) => x.nameMatchingUsedForResolution !== true), 'name matching used as identity authority');

const resolvedStatuses = new Set(['RESOLVED_EXACT_SOURCE_ID', 'RESOLVED_TICKER_ALIAS', 'RESOLVED_HISTORICAL_RENAME', 'RESOLVED_SOURCE_FORMAT_CHANGE']);
const identityResolved = (identity.records || []).filter((x) => resolvedStatuses.has(x.repairedMappingStatus)).length;
const identityUnresolved = Number(identity.reviewed || 0) - identityResolved;
const identityCounts = {};
for (const row of identity.records || []) identityCounts[row.repairedMappingStatus] = (identityCounts[row.repairedMappingStatus] || 0) + 1;
symbol.mappingReview = {
  scope: 'G11_BASELINE_42_SOURCE_IDENTITIES',
  reviewed: Number(identity.reviewed || 0),
  resolved: identityResolved,
  unresolved: identityUnresolved,
  statusCounts: identityCounts,
  records: identity.records || [],
};
write('docs/astra/G11_SYMBOL_HEALTH.json', symbol);

const baselineStale = new Set((repair.baselineStaleTickers || []).map(norm));
const repairRows = new Map((repair.records || []).map((x) => [norm(x.canonicalTicker), x]));
const baselineStaleResolved = [...baselineStale].filter((ticker) => repairRows.get(ticker)?.afterCurrentRecordAvailable === true).length;
const baselineStaleUnresolved = baselineStale.size - baselineStaleResolved;
stale.baselineTotal = baselineStale.size;
stale.baselineResolved = baselineStaleResolved;
stale.baselineUnresolved = baselineStaleUnresolved;
stale.resolved = baselineStaleResolved;
stale.unresolved = Array.isArray(stale.records) ? stale.records.length : Number(stale.unresolved || 0);
stale.note = 'resolved/unresolved baseline fields track the original G11 stale set; records contains all currently stale production-critical histories after repair.';
write('docs/astra/G11_STALE_RECORDS.json', stale);

const prodRows = (readiness.rows || []).filter((x) => x.productionCritical);
const prodReady = prodRows.filter((x) => x.status === 'READY');
const prodLegitimate = prodRows.filter((x) => String(x.status || '').startsWith('LEGITIMATE_'));
const prodBlocked = prodRows.filter((x) => x.status !== 'READY' && !String(x.status || '').startsWith('LEGITIMATE_'));
const featureTickers = ['AMES', 'GRCA', 'LUTS', 'PHGC'];
const featureReadiness = featureTickers.map((ticker) => {
  const row = prodRows.find((x) => norm(x.ticker) === ticker);
  return { ticker, status: row?.status || 'UNKNOWN', reason: row?.reason || null, validHistorySessions: row?.validHistorySessions ?? null };
});
repair.finalCertification = {
  gateStatus: gate.status,
  overallDataHealth: read('docs/astra/G11_DATA_HEALTH_SNAPSHOT.json', {})?.overallStatus || null,
  identityResolved,
  identityUnresolved,
  baselineStaleResolved,
  baselineStaleUnresolved,
  currentStaleRecords: Array.isArray(stale.records) ? stale.records.length : null,
  featureReadiness,
  productionStrategy: {
    strategyId: 'PORTFOLIO_BASKET_EQUAL_WEIGHT',
    ready: prodReady.length,
    legitimateExclusions: prodLegitimate.length,
    dataDefectBlocked: prodBlocked.length,
  },
  criticalUnresolved: Number(issues.criticalUnresolved || 0),
  highProductionRelevantUnresolved: Number(issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0),
  legacyNetworkCalls: pipeline.legacyNetworkCalls,
  productionCutover: false,
  g12Status: 'PENDING',
};
write('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', repair);

const beforePath = process.env.G11_BEFORE_DECISION;
const afterPath = process.env.G11_AFTER_DECISION;
const before = beforePath ? readAbs(beforePath, null) : null;
const after = afterPath ? readAbs(afterPath, null) : null;
let comparison = null;
if (before && after) {
  const beforeTop = (before.top5 || []).map((x) => norm(x.ticker || x.securityId)).filter(Boolean);
  const afterTop = (after.top5 || []).map((x) => norm(x.ticker || x.securityId)).filter(Boolean);
  comparison = {
    schemaVersion: 'astra-g11-decision-snapshot-comparison-1',
    generatedAt: new Date().toISOString(),
    immutablePreviousSnapshot: true,
    previous: before,
    repairedCurrent: after,
    materialChange: before.semanticDecisionHash !== after.semanticDecisionHash,
    universeChanges: {
      currentCanonical: [before.currentCanonicalUniverse, after.currentCanonicalUniverse],
      decisionReady: [before.decisionReadyUniverse, after.decisionReadyUniverse],
      regimeReady: [before.regimeReadyUniverse, after.regimeReadyUniverse],
    },
    regimeChanged: hash(before.regime) !== hash(after.regime),
    candidateChanges: {
      previous: beforeTop,
      repaired: afterTop,
      added: afterTop.filter((x) => !beforeTop.includes(x)),
      removed: beforeTop.filter((x) => !afterTop.includes(x)),
    },
    rankingChanged: JSON.stringify(beforeTop) !== JSON.stringify(afterTop),
    riskChanged: hash(before.riskPlan) !== hash(after.riskPlan),
    basketChanged: hash(before.basketPlan) !== hash(after.basketPlan),
    reason: before.semanticDecisionHash === after.semanticDecisionHash ? 'NO_SEMANTIC_DECISION_CHANGE' : 'VALIDATION_APPROVED_CURRENT_CANONICAL_INPUTS_CHANGED_BY_G11_SOURCE_DATA_REPAIR',
  };
  write('docs/astra/G11_DECISION_SNAPSHOT_COMPARISON.json', comparison);
}

const additions = [
  'docs/astra/G11_SOURCE_IDENTITY_REPAIR.json',
  'docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json',
  'docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.md',
  'docs/astra/G11_DECISION_SNAPSHOT_COMPARISON.json',
];
gate.evidence = [...new Set([...(gate.evidence || []), ...additions.filter((p) => fs.existsSync(R(p)))])];
write('04_ACCEPTANCE_GATES.json', gates);

for (const p of ['05_WORK_STATE.json', 'docs/astra/WORK_STATE.json']) {
  const state = read(p, {});
  state.g11_certification = state.g11_certification || {};
  Object.assign(state.g11_certification, {
    sourceIdentitiesRepaired: identityResolved,
    sourceIdentitiesBaseline: Number(identity.reviewed || 0),
    sourceIdentitiesUnresolved: identityUnresolved,
    baselineStaleRepaired: baselineStaleResolved,
    baselineStaleTotal: baselineStale.size,
    baselineStaleUnresolved,
    currentStaleRecords: Array.isArray(stale.records) ? stale.records.length : null,
    productionStrategyReady: prodReady.length,
    productionStrategyLegitimateExclusions: prodLegitimate.length,
    productionStrategyDataDefectBlocked: prodBlocked.length,
    featureReadiness,
    decisionSnapshotComparison: comparison ? {
      previousId: before.decisionSnapshotId,
      repairedId: after.decisionSnapshotId,
      materialChange: comparison.materialChange,
      reason: comparison.reason,
    } : null,
  });
  write(p, state);
}

let md = fs.readFileSync(R('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.md'), 'utf8');
const marker = '## Final G11 recertification';
if (md.includes(marker)) md = md.slice(0, md.indexOf(marker)).trimEnd() + '\n\n';
md += `${marker}\n\n- Gate: **${gate.status}**.\n- Source identities repaired: **${identityResolved}/${identity.reviewed || 0}**; unresolved=${identityUnresolved}.\n- Baseline stale current rows repaired: **${baselineStaleResolved}/${baselineStale.size}**; baseline unresolved=${baselineStaleUnresolved}; current stale records across the repaired universe=${Array.isArray(stale.records) ? stale.records.length : 'n/a'}.\n- Production strategy: READY=${prodReady.length}; legitimate exclusions=${prodLegitimate.length}; data-defect blocked=${prodBlocked.length}.\n- AMES/GRCA/LUTS/PHGC: ${featureReadiness.map((x) => `${x.ticker}=${x.status}(${x.reason || 'n/a'})`).join(', ')}.\n- Current canonical=${metrics.currentCanonicalSecurities?.numerator}/${metrics.currentCanonicalSecurities?.denominator}; regime=${metrics.regimeInputs?.status}; legacy-network calls=${pipeline.legacyNetworkCalls}.\n- CRITICAL=${issues.criticalUnresolved || 0}; HIGH production-relevant=${issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0}.\n- G12 remains PENDING; production cutover=false.\n`;
if (comparison) md += `- DecisionSnapshot: ${before.decisionSnapshotId} (${before.semanticDecisionHash}) -> ${after.decisionSnapshotId} (${after.semanticDecisionHash}); ${comparison.reason}.\n`;
fs.writeFileSync(R('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.md'), md, 'utf8');

const logPath = R('07_WORK_LOG.md');
let log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
const stamp = new Date().toISOString();
log += `\n\n## ${stamp} — G11 Targeted Current-Data Repair\n\n- Gate after full recertification: ${gate.status}.\n- Exact source identities: ${identityResolved}/${identity.reviewed || 0}; unresolved=${identityUnresolved}.\n- Original stale set repaired: ${baselineStaleResolved}/${baselineStale.size}; remaining=${baselineStaleUnresolved}.\n- Production readiness: READY=${prodReady.length}, legitimate exclusions=${prodLegitimate.length}, data-defect blocked=${prodBlocked.length}.\n- CRITICAL=${issues.criticalUnresolved || 0}; HIGH=${issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0}; G12=PENDING; production cutover=false.\n`;
fs.writeFileSync(logPath, log, 'utf8');

console.log('ASTRA_G11_REPAIR_FINAL ' + JSON.stringify({
  gateStatus: gate.status,
  identityResolved,
  identityUnresolved,
  baselineStaleResolved,
  baselineStaleUnresolved,
  currentStaleRecords: Array.isArray(stale.records) ? stale.records.length : null,
  featureReadiness,
  productionReady: prodReady.length,
  legitimateExclusions: prodLegitimate.length,
  dataDefectBlocked: prodBlocked.length,
  critical: Number(issues.criticalUnresolved || 0),
  high: Number(issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0),
  tests: tests.g11Tests || null,
  decisionChanged: comparison?.materialChange ?? null,
  g12: 'PENDING',
}));
