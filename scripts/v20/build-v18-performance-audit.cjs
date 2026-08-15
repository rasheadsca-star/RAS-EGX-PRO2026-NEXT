#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const exists = rel => fs.existsSync(P(rel));
const read = (rel, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const write = (rel, value) => {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

// V18 performance figures were reported with materially different trade counts.
// These values are preserved only as unreconciled claims from the project requirements;
// they are NOT treated as measured V20 evidence and cannot drive calibration or promotion.
const observedClaimCounts = [16, 971, 1138];
const manifestPath = 'data/v20/v18-source-manifest.json';
const manifest = read(manifestPath, {});
const sourceArtifact = typeof manifest?.sourceArtifact === 'string' ? manifest.sourceArtifact.trim() : '';
const sourceArtifactAvailable = Boolean(sourceArtifact && exists(sourceArtifact));

const definitions = {
  sourceArtifact: sourceArtifactAvailable,
  tradeDefinition: Boolean(manifest?.definitions?.tradeDefinition),
  signalUniverse: Boolean(manifest?.definitions?.signalUniverse),
  holdingPeriod: Boolean(manifest?.definitions?.holdingPeriod),
  inSampleDefinition: Boolean(manifest?.definitions?.inSampleDefinition),
  outOfSampleDefinition: Boolean(manifest?.definitions?.outOfSampleDefinition),
  walkForwardDefinition: Boolean(manifest?.definitions?.walkForwardDefinition),
  multiHorizonDefinition: Boolean(manifest?.definitions?.multiHorizonDefinition),
  entryTiming: Boolean(manifest?.definitions?.entryTiming),
  transactionCosts: Boolean(manifest?.definitions?.transactionCosts),
  overlapAndPortfolioCompounding: Boolean(manifest?.definitions?.overlapAndPortfolioCompounding),
  sameCandleAmbiguityPolicy: Boolean(manifest?.definitions?.sameCandleAmbiguityPolicy),
  independentHoldoutDefinition: Boolean(manifest?.definitions?.independentHoldoutDefinition),
};

const requiredKeys = Object.keys(definitions);
const satisfiedKeys = requiredKeys.filter(key => definitions[key] === true);
const missingDefinitions = requiredKeys.filter(key => definitions[key] !== true);
const definitionCoveragePct = Number(((satisfiedKeys.length / requiredKeys.length) * 100).toFixed(2));
const claimCountsReconciled = manifest?.claimCountsReconciled === true && sourceArtifactAvailable;
const reproducible = sourceArtifactAvailable && missingDefinitions.length === 0 && claimCountsReconciled;

const blockingReasons = [];
if (!sourceArtifactAvailable) blockingReasons.push('REPRODUCIBLE_V18_SOURCE_ARTIFACT_MISSING');
if (!claimCountsReconciled) blockingReasons.push('V18_TRADE_COUNTS_NOT_RECONCILED');
if (missingDefinitions.length) blockingReasons.push('V18_PERFORMANCE_DEFINITIONS_INCOMPLETE');

const acceptedForPerformanceClaims = reproducible && manifest?.auditAccepted === true;
const audit = {
  schemaVersion: '20.0.0-v18-performance-audit-1',
  generatedAt: new Date().toISOString(),
  auditScope: 'V18_PERFORMANCE_EVIDENCE_ONLY',
  decisionSupportOnly: true,
  status: acceptedForPerformanceClaims ? 'RECONCILED_AUDIT_ACCEPTED' : 'BLOCKED_UNTIL_REPRODUCIBLE_SOURCE_AND_DEFINITIONS',
  acceptedForPerformanceClaims,
  reproducible,
  source: {
    manifestPath,
    manifestPresent: exists(manifestPath),
    sourceArtifact: sourceArtifact || null,
    sourceArtifactAvailable,
    provenance: 'PROJECT_REQUIREMENTS_UNRECONCILED_REFERENCE_COUNTS',
  },
  unreconciledClaims: {
    observedTradeCounts: observedClaimCounts,
    reconciled: claimCountsReconciled,
    evidenceUse: 'AUDIT_TRIGGER_ONLY_NOT_PERFORMANCE_METRIC',
    note: '16, 971 and 1138 are retained as contradictory reference claims that require source-level reconciliation; they are not accepted performance observations.',
  },
  definitions: {
    required: definitions,
    requiredCount: requiredKeys.length,
    satisfiedCount: satisfiedKeys.length,
    definitionCoveragePct,
    missing: missingDefinitions,
  },
  governance: {
    countsAsIndependentEvidence: false,
    canCalibrateV20DecisionScore: false,
    canOpenExecutionGate: false,
    canChangeChampion: false,
    canPromoteChallenger: false,
    canCreateHeadlinePerformanceMetric: false,
  },
  blockingReasons,
  acceptanceRequirements: [
    'Provide a reproducible V18 source artifact inside the isolated V20 evidence boundary.',
    'Reconcile the 16 / 971 / 1138 trade-count claims against one explicit trade definition.',
    'Define signal universe, holding period, IS/OOS, walk-forward and multi-horizon semantics.',
    'Define next-session entry timing, transaction costs, overlap-aware portfolio compounding and conservative same-candle ambiguity.',
    'Separate development evidence from genuinely fresh independent holdout evidence.',
  ],
};

if (audit.acceptedForPerformanceClaims && !audit.reproducible) {
  throw new Error('V18 performance cannot be accepted without reproducibility');
}
if (audit.governance.countsAsIndependentEvidence !== false || audit.governance.canChangeChampion !== false) {
  throw new Error('V18 audit governance invariant violated');
}

write('data/v20/v18-performance-audit.json', audit);
console.log(JSON.stringify({
  status: audit.status,
  acceptedForPerformanceClaims: audit.acceptedForPerformanceClaims,
  sourceArtifactAvailable,
  definitionCoveragePct,
  missingDefinitions: missingDefinitions.length,
  observedTradeCounts: observedClaimCounts,
}, null, 2));
