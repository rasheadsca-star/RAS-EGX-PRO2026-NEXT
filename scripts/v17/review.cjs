#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const currentPath = path.join(root, 'data/v17/current.json');
const ledgerPath = path.join(root, 'data/v17/ledger.json');
const challengerPath = path.join(root, 'data/v17/challenger-status.json');
const resilientPath = path.join(root, 'data/v17/resilient-session-status.json');
const reviewPath = path.join(root, 'data/v17/review.json');
const appFiles = [
  'preview-v17/app/index.html',
  'preview-v17/app/styles.css',
  'preview-v17/app/app.js',
];
const requiredEngineFiles = [
  'scripts/v17/build-snapshot.cjs',
  'scripts/v17/resolve-ledger.cjs',
  'scripts/v17/challenger-gate.cjs',
  'scripts/v17/resilient-session-gate.cjs',
  'scripts/v17/review.cjs',
];

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function readText(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }
function exists(relativePath) { return fs.existsSync(path.join(root, relativePath)); }
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, filePath);
}

const findings = [];
const add = (severity, code, message, location = null) => findings.push({ severity, code, message, location });

if (!exists('data/v17/current.json')) add('CRITICAL', 'MISSING_CANONICAL_SNAPSHOT', 'Canonical V17 snapshot is missing.', 'data/v17/current.json');
if (!exists('data/v17/ledger.json')) add('CRITICAL', 'MISSING_IMMUTABLE_LEDGER', 'Immutable V17 ledger is missing.', 'data/v17/ledger.json');
if (!exists('data/v17/challenger-status.json')) add('CRITICAL', 'MISSING_CHALLENGER_GATE', 'Champion-challenger status is missing.', 'data/v17/challenger-status.json');
if (!exists('data/v17/resilient-session-status.json')) add('CRITICAL', 'MISSING_RESILIENT_GATE', 'Resilient source gate is missing.', 'data/v17/resilient-session-status.json');
for (const file of appFiles) if (!exists(file)) add('CRITICAL', 'MISSING_APP_FILE', `Required application file is missing: ${file}`, file);
for (const file of requiredEngineFiles) if (!exists(file)) add('CRITICAL', 'MISSING_ENGINE_FILE', `Required V17 engine file is missing: ${file}`, file);

let current = null, ledger = null, challenger = null, resilient = null;
if (exists('data/v17/current.json')) current = readJson(currentPath);
if (exists('data/v17/ledger.json')) ledger = readJson(ledgerPath);
if (exists('data/v17/challenger-status.json')) challenger = readJson(challengerPath);
if (exists('data/v17/resilient-session-status.json')) resilient = readJson(resilientPath);

if (current) {
  if (current.schemaVersion !== '17.0.0-rc4') add('MAJOR', 'UNEXPECTED_SCHEMA', `Unexpected schema ${current.schemaVersion}.`, 'data/v17/current.json');
  if (current.engine?.id !== 'V16_9_EQUAL_WEIGHT_BASKET') add('CRITICAL', 'WRONG_CHAMPION_ENGINE', 'V17 changed the approved V16.9 champion.', 'engine.id');
  if (current.engine?.singleProductionEngine !== true) add('MAJOR', 'ENGINE_NOT_LOCKED', 'Single champion engine flag is not enforced.', 'engine.singleProductionEngine');
  if (current.engine?.selectionMethodFrozen !== true) add('MAJOR', 'SELECTION_METHOD_NOT_FROZEN', 'Champion selection method is not frozen.', 'engine.selectionMethodFrozen');

  const allowedStatuses = ['READY_FOR_NEXT_SESSION_REVIEW', 'RESEARCH_READY_EXECUTION_BLOCKED', 'BLOCKED_STALE_OR_UNVERIFIED_DATA'];
  if (!allowedStatuses.includes(current.status)) add('CRITICAL', 'UNKNOWN_STATUS', `Unknown current status ${current.status}.`, 'status');

  const health = current.systemHealth || {};
  if (!current.sessionDate || current.sessionDate !== health.latestMarketSession || current.sessionDate !== health.sourceSession || current.sessionDate !== health.decisionSession) {
    add('CRITICAL', 'CURRENT_SESSION_TRUTH_MISMATCH', 'Canonical current session is not aligned with the latest collected market session.', 'systemHealth');
  }
  if (current.currentResearch?.sessionDate !== current.sessionDate) add('CRITICAL', 'RESEARCH_SESSION_MISMATCH', 'Current research session differs from canonical session.', 'currentResearch.sessionDate');
  if (current.currentResearch?.provenance !== 'CURRENT_SESSION_RESEARCH_NOT_AUTOMATIC_EXECUTION') add('MAJOR', 'CURRENT_RESEARCH_PROVENANCE_MISSING', 'Current research is not explicitly separated from execution.', 'currentResearch.provenance');

  const researchMode = current.status === 'RESEARCH_READY_EXECUTION_BLOCKED';
  const executionMode = current.status === 'READY_FOR_NEXT_SESSION_REVIEW';
  const planned = Number(current.portfolioPolicy?.plannedAllocationPct || 0);
  if (planned > 50) add('CRITICAL', 'EXPOSURE_LIMIT_BREACH', `Planned exposure is ${planned}%.`, 'portfolioPolicy.plannedAllocationPct');
  if (current.portfolioPolicy?.unfilledMemberPolicy !== 'KEEP_CASH') add('MAJOR', 'RISK_REDISTRIBUTION', 'Unfilled weights must remain cash.', 'portfolioPolicy.unfilledMemberPolicy');
  if (current.portfolioPolicy?.automaticOrders !== false) add('CRITICAL', 'AUTOMATIC_ORDER_RISK', 'Automatic orders must remain disabled.', 'portfolioPolicy.automaticOrders');

  if (researchMode) {
    if (current.readiness?.researchReady !== true) add('CRITICAL', 'FALSE_RESEARCH_READY_STATUS', 'Research status is ready but readiness flag is false.', 'readiness.researchReady');
    if (current.readiness?.executionReady !== false || health.executionGrade !== false) add('CRITICAL', 'FALSE_EXECUTION_READINESS', 'Research-only state is claiming execution readiness.', 'readiness.executionReady');
    if (planned !== 0 || Number(current.portfolioPolicy?.researchWatchAllocationPct || 0) !== 0) add('CRITICAL', 'RESEARCH_ALLOCATION_NOT_ZERO', 'Research watch state must carry zero portfolio allocation.', 'portfolioPolicy');
    if (current.nextSessionPlan !== false) add('MAJOR', 'RESEARCH_MARKED_AS_EXECUTION_PLAN', 'Research-only state is marked as a next-session execution plan.', 'nextSessionPlan');
  }
  if (executionMode) {
    if (current.readiness?.executionReady !== true || health.executionGrade !== true) add('CRITICAL', 'EXECUTION_STATUS_WITHOUT_GRADE', 'Execution review status lacks execution-grade evidence.', 'readiness.executionReady');
    if (current.championReference?.currentForMarketSession !== true) add('CRITICAL', 'STALE_CHAMPION_EXECUTION', 'A stale champion reference is being used for current execution.', 'championReference.currentForMarketSession');
  }

  if (current.championReference?.currentForMarketSession === false) {
    if (!current.championReference?.disclosureAr || !String(current.championReference.disclosureAr).includes('مرجع')) {
      add('MAJOR', 'STALE_CHAMPION_NOT_DISCLOSED', 'Stale champion reference is not clearly disclosed.', 'championReference.disclosureAr');
    }
    if (executionMode) add('CRITICAL', 'STALE_CHAMPION_SHOWN_AS_CURRENT', 'Stale champion reference cannot be execution-ready.', 'championReference');
  }

  const rows = Array.isArray(current.recommendations) ? current.recommendations : [];
  if ((researchMode || executionMode) && (rows.length < 3 || rows.length > 5)) add('CRITICAL', 'INVALID_CURRENT_LIST_SIZE', `Current list size ${rows.length} is outside 3–5.`, 'recommendations');
  const tickers = rows.map(row => row.ticker);
  if (new Set(tickers).size !== tickers.length) add('CRITICAL', 'DUPLICATE_TICKERS', 'Duplicate tickers exist in the current list.', 'recommendations');
  for (const row of rows) {
    if (![row.stop, row.entryLow, row.entryHigh, row.target].every(value => Number.isFinite(Number(value)))) {
      add('CRITICAL', 'INCOMPLETE_PRICE_PLAN', `Incomplete price plan for ${row.ticker}.`, `recommendations.${row.ticker}`);
      continue;
    }
    if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) add('CRITICAL', 'INVALID_PRICE_PLAN', `Invalid price relationship for ${row.ticker}.`, `recommendations.${row.ticker}`);
    if (row.executionRules?.chaseForbidden !== true || row.executionRules?.requireLiquidityConfirmation !== true || row.executionRules?.requireOpeningInsideRange !== true) add('MAJOR', 'WEAK_EXECUTION_RULES', `${row.ticker} lacks anti-chase/opening/liquidity safeguards.`, `recommendations.${row.ticker}.executionRules`);
    if (researchMode && (Number(row.portfolioWeightPct || 0) !== 0 || row.executionAllowed === true || row.monitorOnly !== true)) add('CRITICAL', 'RESEARCH_ROW_EXECUTION_LEAK', `${row.ticker} leaks execution semantics into research-only state.`, `recommendations.${row.ticker}`);
  }

  const native = current.evidence?.nativeV17;
  if (!native) add('CRITICAL', 'NATIVE_V17_EVIDENCE_MISSING', 'V17 readiness has no native V17 evidence object.', 'evidence.nativeV17');
  if (current.readiness?.professionalEvidenceReady === true && native?.gate?.passed !== true) add('CRITICAL', 'FALSE_PROFESSIONAL_CLAIM', 'Professional readiness is true before native evidence gates pass.', 'readiness.professionalEvidenceReady');
  if (current.evidence?.legacyMethodEvidence?.provenance !== 'LEGACY_V16_9_METHOD_EVIDENCE_NOT_NATIVE_V17') add('MAJOR', 'LEGACY_EVIDENCE_NOT_SEPARATED', 'Legacy V16.9 evidence lacks explicit provenance.', 'evidence.legacyMethodEvidence');
  if (current.evidence?.researchAudit?.provenance !== 'HISTORICAL_RESEARCH_NOT_LIVE_EVIDENCE') add('MAJOR', 'HISTORICAL_RESEARCH_NOT_SEPARATED', 'Historical research lacks non-live provenance.', 'evidence.researchAudit');

  const quality = health.marketDataQuality;
  if (!quality) add('MAJOR', 'MARKET_QUALITY_MISSING', 'Market data quality metrics are missing.', 'systemHealth.marketDataQuality');
  if (quality && quality.cleanCompanyNamePct < 80 && current.readiness?.dataQualityScore > 85) add('MAJOR', 'DATA_SCORE_OVERSTATED_NAMES', 'Data quality score is too high for polluted company names.', 'readiness.dataQualityScore');
  if (quality && quality.completeOhlcPct < 70 && current.readiness?.dataQualityScore > 90) add('MAJOR', 'DATA_SCORE_OVERSTATED_OHLC', 'Data quality score is too high for incomplete OHLC coverage.', 'readiness.dataQualityScore');

  if (!current.championChallenger) add('CRITICAL', 'CHAMPION_STATUS_NOT_EXPOSED', 'Canonical snapshot does not expose champion-challenger state.', 'championChallenger');
  if (current.championChallenger?.activeEngine !== current.engine?.id) add('CRITICAL', 'CHAMPION_ENGINE_MISMATCH', 'Displayed champion differs from governance gate.', 'championChallenger.activeEngine');
  if (current.championChallenger?.promotionAllowed !== false) add('CRITICAL', 'AUTOMATIC_CHALLENGER_PROMOTION', 'A challenger can replace the champion automatically.', 'championChallenger.promotionAllowed');
}

if (challenger) {
  if (challenger.activeEngine !== 'V16_9_EQUAL_WEIGHT_BASKET') add('CRITICAL', 'CHALLENGER_GATE_CHANGED_ACTIVE_ENGINE', 'Challenger gate changed the active champion.', 'data/v17/challenger-status.json');
  if (challenger.promotionAllowed !== false) add('CRITICAL', 'CHALLENGER_GATE_AUTO_PROMOTION', 'Challenger gate permits automatic promotion.', 'data/v17/challenger-status.json');
}

if (resilient && current) {
  if (resilient.mode === 'BLOCKED' && current.status !== 'BLOCKED_STALE_OR_UNVERIFIED_DATA') add('CRITICAL', 'BLOCKED_SOURCE_NOT_PROPAGATED', 'Blocked source state was not propagated to canonical snapshot.', 'status');
  if (resilient.confidencePolicy?.allowExecutionGradeClaim !== true && current.systemHealth?.executionGrade === true) add('CRITICAL', 'EXECUTION_GRADE_BYPASSES_SOURCE_GATE', 'Canonical execution grade bypasses resilient source gate.', 'systemHealth.executionGrade');
}

if (ledger) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const ids = entries.map(entry => entry.signalId);
  if (new Set(ids).size !== ids.length) add('CRITICAL', 'DUPLICATE_LEDGER_SIGNAL', 'Immutable ledger contains repeated signal IDs.', 'data/v17/ledger.json');
  for (const entry of entries.filter(item => item.outcome?.resolved === true)) {
    if (!Number.isFinite(Number(entry.outcome?.basketSleeveReturnPct))) add('CRITICAL', 'INVALID_RESOLVED_BASKET_RETURN', `Resolved signal ${entry.signalId} has no valid basket return.`, 'data/v17/ledger.json');
    if (entry.outcome?.conservativeAmbiguityPolicy !== true) add('MAJOR', 'NON_CONSERVATIVE_OUTCOME', `Resolved signal ${entry.signalId} lacks conservative ambiguity policy.`, 'data/v17/ledger.json');
  }
  if (current?.status === 'READY_FOR_NEXT_SESSION_REVIEW') {
    const expectedId = `${current.championReference?.sessionDate}:${current.engine?.id}`;
    if (!entries.some(entry => entry.signalId === expectedId)) add('CRITICAL', 'CURRENT_EXECUTION_SIGNAL_NOT_ARCHIVED', 'Execution-ready champion signal is absent from immutable ledger.', 'data/v17/ledger.json');
  }
}

if (appFiles.every(exists)) {
  const appSource = appFiles.map(readText).join('\n');
  const forbiddenLegacy = ['v15-practical-decision.json', 'v15-update-status.json', 'decision-source.js'];
  for (const token of forbiddenLegacy) if (appSource.includes(token)) add('CRITICAL', 'LEGACY_SOURCE_REFERENCE', `V17 app references forbidden legacy source ${token}.`, 'preview-v17/app');
  if (!appSource.includes('data/v17/current.json')) add('CRITICAL', 'CANONICAL_SOURCE_NOT_USED', 'V17 UI does not reference canonical snapshot.', 'preview-v17/app/app.js');
  for (const token of ['nativeV17', 'researchAudit', 'legacyMethodEvidence', 'marketDataQuality', 'currentResearch', 'championReference']) if (!appSource.includes(token)) add('MAJOR', 'EVIDENCE_LAYER_NOT_RENDERED', `V17 UI does not render required layer ${token}.`, 'preview-v17/app/app.js');
  if (!appSource.includes('championChallenger')) add('MAJOR', 'CHALLENGER_STATUS_NOT_RENDERED', 'V17 UI does not render champion-challenger status.', 'preview-v17/app/app.js');
  if (!appSource.includes('ليست أمر شراء') && !appSource.includes('ليس أمر شراء') && !appSource.includes('مراقبة فقط')) add('MAJOR', 'MISSING_EXECUTION_DISCLOSURE', 'UI lacks a clear non-order disclosure.', 'preview-v17/app');
  if (!appSource.includes('@media')) add('MAJOR', 'NO_RESPONSIVE_RULES', 'Responsive CSS rules are missing.', 'preview-v17/app/styles.css');
  if (!appSource.includes('aria-')) add('MINOR', 'ACCESSIBILITY_METADATA', 'Add ARIA metadata for primary navigation and dynamic status.', 'preview-v17/app');
}

const counts = findings.reduce((acc, item) => { acc[item.severity] = (acc[item.severity] || 0) + 1; return acc; }, { CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 });
const report = {
  schemaVersion: '17.0.0-review-4',
  generatedAt: new Date().toISOString(),
  reviewer: 'V17_CURRENT_SESSION_TRUTH_GATE',
  verdict: counts.CRITICAL === 0 && counts.MAJOR === 0 ? (findings.length === 0 ? 'NO_COMMENTS' : 'ACCEPTED_WITH_NON_BLOCKING_NOTES') : 'REJECTED',
  counts,
  findings,
  checks: {
    frozenChampionIsolation: true,
    currentSessionTruth: true,
    researchExecutionSeparation: true,
    zeroAllocationInResearchMode: true,
    pricePlanIntegrity: true,
    immutableLedgerAndResolver: true,
    historicalEvidenceSeparation: true,
    marketDataQualityScoring: true,
    championChallengerGovernance: true,
    responsiveAndAccessibleUi: true,
  },
};
writeJsonAtomic(reviewPath, report);
console.log(JSON.stringify(report, null, 2));
process.exit(counts.CRITICAL === 0 && counts.MAJOR === 0 ? 0 : 1);