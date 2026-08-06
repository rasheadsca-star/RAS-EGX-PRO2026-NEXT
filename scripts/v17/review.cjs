#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const currentPath = path.join(root, 'data/v17/current.json');
const ledgerPath = path.join(root, 'data/v17/ledger.json');
const reviewPath = path.join(root, 'data/v17/review.json');
const appFiles = [
  'preview-v17/app/index.html',
  'preview-v17/app/styles.css',
  'preview-v17/app/app.js',
];
const requiredEngineFiles = [
  'scripts/v17/build-snapshot.cjs',
  'scripts/v17/resolve-ledger.cjs',
  'scripts/v17/review.cjs',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

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
for (const file of appFiles) if (!exists(file)) add('CRITICAL', 'MISSING_APP_FILE', `Required application file is missing: ${file}`, file);
for (const file of requiredEngineFiles) if (!exists(file)) add('CRITICAL', 'MISSING_ENGINE_FILE', `Required V17 engine file is missing: ${file}`, file);

let current = null;
let ledger = null;
if (!findings.some(item => item.code === 'MISSING_CANONICAL_SNAPSHOT')) current = readJson(currentPath);
if (!findings.some(item => item.code === 'MISSING_IMMUTABLE_LEDGER')) ledger = readJson(ledgerPath);

if (current) {
  if (current.schemaVersion !== '17.0.0-rc2') add('MAJOR', 'UNEXPECTED_SCHEMA', `Unexpected schema ${current.schemaVersion}.`, 'data/v17/current.json');
  if (current.engine?.id !== 'V16_9_EQUAL_WEIGHT_BASKET') add('CRITICAL', 'MULTIPLE_OR_WRONG_ENGINE', 'V17 production engine is not the approved single engine.', 'current.engine.id');
  if (current.engine?.singleProductionEngine !== true) add('MAJOR', 'ENGINE_NOT_LOCKED', 'Single production engine flag is not enforced.', 'current.engine.singleProductionEngine');
  if (current.engine?.selectionMethodFrozen !== true) add('MAJOR', 'SELECTION_METHOD_NOT_FROZEN', 'Selection method can change without a new version.', 'current.engine.selectionMethodFrozen');
  if (current.sessionDate !== current.market?.sessionDate) add('CRITICAL', 'SESSION_MISMATCH', 'Decision and market sessions do not match.', 'current.sessionDate');
  if (current.sessionDate !== current.systemHealth?.sourceSession) add('CRITICAL', 'SOURCE_SESSION_MISMATCH', 'Decision and source sessions do not match.', 'current.systemHealth.sourceSession');
  if (current.systemHealth?.executionGrade !== true) add('CRITICAL', 'NON_EXECUTION_GRADE', 'Source data is not execution grade.', 'current.systemHealth.executionGrade');
  if (current.status !== 'READY_FOR_NEXT_SESSION_REVIEW') add('MAJOR', 'APPLICATION_BLOCKED', `Snapshot status is ${current.status}.`, 'current.status');

  const rows = Array.isArray(current.recommendations) ? current.recommendations : [];
  if (rows.length < 3 || rows.length > 5) add('CRITICAL', 'INVALID_BASKET_SIZE', `Basket size ${rows.length} is outside 3–5.`, 'current.recommendations');
  const tickers = rows.map(row => row.ticker);
  if (new Set(tickers).size !== tickers.length) add('CRITICAL', 'DUPLICATE_TICKERS', 'Duplicate tickers exist in the basket.', 'current.recommendations');
  for (const row of rows) {
    if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) {
      add('CRITICAL', 'INVALID_PRICE_PLAN', `Invalid price relationship for ${row.ticker}.`, `recommendations.${row.ticker}`);
    }
    if (row.rsi14 > 80 && row.hotMomentumRisk !== true) add('MAJOR', 'UNFLAGGED_HOT_MOMENTUM', `${row.ticker} has RSI above 80 without a hot-momentum warning.`, `recommendations.${row.ticker}`);
    if (row.executionRules?.chaseForbidden !== true || row.executionRules?.requireLiquidityConfirmation !== true || row.executionRules?.requireOpeningInsideRange !== true) {
      add('MAJOR', 'WEAK_EXECUTION_RULES', `${row.ticker} lacks mandatory opening, anti-chase or liquidity confirmation.`, `recommendations.${row.ticker}.executionRules`);
    }
  }
  const hotCount = rows.filter(row => row.hotMomentumRisk).length;
  if (hotCount > 0 && !current.decisionWarnings?.warningAr) add('MAJOR', 'MISSING_HOT_MOMENTUM_DISCLOSURE', 'Current basket contains hot momentum without an application-level warning.', 'decisionWarnings');

  const planned = Number(current.portfolioPolicy?.plannedAllocationPct || 0);
  if (planned > 50) add('CRITICAL', 'EXPOSURE_LIMIT_BREACH', `Planned exposure is ${planned}%.`, 'portfolioPolicy.plannedAllocationPct');
  if (current.portfolioPolicy?.unfilledMemberPolicy !== 'KEEP_CASH') add('MAJOR', 'RISK_REDISTRIBUTION', 'Unfilled weights must remain cash.', 'portfolioPolicy.unfilledMemberPolicy');
  if (current.portfolioPolicy?.automaticOrders !== false) add('CRITICAL', 'AUTOMATIC_ORDER_RISK', 'Automatic orders must remain disabled.', 'portfolioPolicy.automaticOrders');

  const native = current.evidence?.nativeV17;
  if (!native) add('CRITICAL', 'NATIVE_V17_EVIDENCE_MISSING', 'V17 readiness has no native V17 evidence object.', 'evidence.nativeV17');
  const nativeGate = native?.gate || {};
  if (current.readiness?.professionalEvidenceReady === true && nativeGate.passed !== true) {
    add('CRITICAL', 'FALSE_PROFESSIONAL_CLAIM', 'Professional readiness is true before native V17 gates pass.', 'readiness.professionalEvidenceReady');
  }
  if (current.evidence?.legacyMethodEvidence?.provenance !== 'LEGACY_V16_9_METHOD_EVIDENCE_NOT_NATIVE_V17') {
    add('MAJOR', 'LEGACY_EVIDENCE_NOT_SEPARATED', 'Legacy V16.9 evidence lacks explicit non-native provenance.', 'evidence.legacyMethodEvidence');
  }
  if (current.evidence?.researchAudit?.provenance !== 'HISTORICAL_RESEARCH_NOT_LIVE_EVIDENCE') {
    add('MAJOR', 'RESEARCH_NOT_SEPARATED', 'Historical research lacks explicit non-live provenance.', 'evidence.researchAudit');
  }
  if (JSON.stringify(current).includes('"equityCurve"')) add('MAJOR', 'CANONICAL_PAYLOAD_BLOAT', 'Canonical snapshot embeds full equity curves instead of compact evidence.', 'data/v17/current.json');

  const quality = current.systemHealth?.marketDataQuality;
  if (!quality) add('MAJOR', 'MARKET_QUALITY_MISSING', 'Market data quality metrics are missing.', 'systemHealth.marketDataQuality');
  if (quality && quality.cleanCompanyNamePct < 80 && current.readiness?.dataQualityScore > 85) {
    add('MAJOR', 'DATA_SCORE_OVERSTATED_NAMES', 'Data quality score is too high for polluted company names.', 'readiness.dataQualityScore');
  }
  if (quality && quality.completeOhlcPct < 70 && current.readiness?.dataQualityScore > 90) {
    add('MAJOR', 'DATA_SCORE_OVERSTATED_OHLC', 'Data quality score is too high for incomplete OHLC coverage.', 'readiness.dataQualityScore');
  }
  if (current.readiness?.marketStrengthScore === current.readiness?.liveEvidenceScore && current.readiness?.marketStrengthScore === 100) {
    add('MAJOR', 'MERGED_READINESS_SCORE', 'Market strength appears to be presented as evidence readiness.', 'readiness');
  }
}

if (ledger && current) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const ids = entries.map(entry => entry.signalId);
  if (new Set(ids).size !== ids.length) add('CRITICAL', 'DUPLICATE_LEDGER_SIGNAL', 'The immutable ledger contains repeated signal IDs.', 'data/v17/ledger.json');
  const currentId = `${current.sessionDate}:${current.engine?.id}`;
  if (!entries.some(entry => entry.signalId === currentId)) add('CRITICAL', 'CURRENT_SIGNAL_NOT_ARCHIVED', 'Current issued signal is absent from the immutable ledger.', 'data/v17/ledger.json');
  for (const entry of entries.filter(item => item.outcome?.resolved === true)) {
    if (!Number.isFinite(Number(entry.outcome?.basketSleeveReturnPct))) add('CRITICAL', 'INVALID_RESOLVED_BASKET_RETURN', `Resolved signal ${entry.signalId} has no valid basket return.`, 'data/v17/ledger.json');
    if (entry.outcome?.conservativeAmbiguityPolicy !== true) add('MAJOR', 'NON_CONSERVATIVE_OUTCOME', `Resolved signal ${entry.signalId} lacks conservative ambiguity policy.`, 'data/v17/ledger.json');
  }
}

if (appFiles.every(exists)) {
  const appSource = appFiles.map(readText).join('\n');
  const forbiddenLegacy = ['v15-practical-decision.json', 'v15-update-status.json', 'decision-source.js'];
  for (const token of forbiddenLegacy) {
    if (appSource.includes(token)) add('CRITICAL', 'LEGACY_SOURCE_REFERENCE', `V17 app references forbidden legacy source ${token}.`, 'preview-v17/app');
  }
  if (!appSource.includes('data/v17/current.json')) add('CRITICAL', 'CANONICAL_SOURCE_NOT_USED', 'V17 UI does not reference the canonical snapshot.', 'preview-v17/app/app.js');
  for (const token of ['nativeV17', 'researchAudit', 'legacyMethodEvidence', 'marketDataQuality']) {
    if (!appSource.includes(token)) add('MAJOR', 'EVIDENCE_LAYER_NOT_RENDERED', `V17 UI does not render required layer ${token}.`, 'preview-v17/app/app.js');
  }
  if (!appSource.includes('قوة السوق') || !appSource.includes('الدليل الحي V17')) {
    add('MAJOR', 'READINESS_LABELS_UNCLEAR', 'UI must visibly separate market strength from native V17 evidence.', 'preview-v17/app');
  }
  if (!appSource.includes('ليست أمر شراء') && !appSource.includes('ليس أمر شراء')) {
    add('MAJOR', 'MISSING_EXECUTION_DISCLOSURE', 'UI lacks a clear non-order execution disclosure.', 'preview-v17/app');
  }
  if (!appSource.includes('@media')) add('MAJOR', 'NO_RESPONSIVE_RULES', 'Responsive CSS rules are missing.', 'preview-v17/app/styles.css');
  if (!appSource.includes('aria-')) add('MINOR', 'ACCESSIBILITY_METADATA', 'Add ARIA metadata for primary navigation and dynamic status.', 'preview-v17/app');
}

const counts = findings.reduce((acc, item) => {
  acc[item.severity] = (acc[item.severity] || 0) + 1;
  return acc;
}, { CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 });

const report = {
  schemaVersion: '17.0.0-review-2',
  generatedAt: new Date().toISOString(),
  reviewer: 'V17_INDEPENDENT_CRITIC_GATE_CYCLE_2',
  verdict: counts.CRITICAL === 0 && counts.MAJOR === 0 ? (findings.length === 0 ? 'NO_COMMENTS' : 'ACCEPTED_WITH_NON_BLOCKING_NOTES') : 'REJECTED',
  counts,
  findings,
  checks: {
    singleEngine: true,
    canonicalDataContract: true,
    sessionTruth: true,
    pricePlanIntegrity: true,
    exposureControl: true,
    immutableLedgerAndResolver: true,
    nativeEvidenceIsolation: true,
    historicalEvidenceSeparation: true,
    marketDataQualityScoring: true,
    legacyIsolation: true,
    responsiveAndAccessibleUi: true,
  },
};

writeJsonAtomic(reviewPath, report);
console.log(JSON.stringify(report, null, 2));
process.exit(counts.CRITICAL === 0 && counts.MAJOR === 0 ? 0 : 1);
