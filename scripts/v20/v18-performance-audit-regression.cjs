#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const audit = read('data/v20/v18-performance-audit.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(audit.schemaVersion === '20.0.0-v18-performance-audit-1', 'V18_AUDIT_SCHEMA_UNEXPECTED');
check(audit.auditScope === 'V18_PERFORMANCE_EVIDENCE_ONLY', 'V18_AUDIT_SCOPE_DRIFT');
check(Array.isArray(audit.unreconciledClaims?.observedTradeCounts), 'V18_CLAIM_COUNTS_MISSING');
check(JSON.stringify(audit.unreconciledClaims?.observedTradeCounts) === JSON.stringify([16, 971, 1138]), 'V18_CONTRADICTORY_COUNTS_NOT_PRESERVED');
check(audit.unreconciledClaims?.evidenceUse === 'AUDIT_TRIGGER_ONLY_NOT_PERFORMANCE_METRIC', 'V18_CLAIMS_FALSELY_USED_AS_METRICS');
check(audit.governance?.countsAsIndependentEvidence === false, 'V18_FALSELY_INDEPENDENT');
check(audit.governance?.canCalibrateV20DecisionScore === false, 'V18_CAN_CALIBRATE_V20');
check(audit.governance?.canOpenExecutionGate === false, 'V18_CAN_OPEN_EXECUTION_GATE');
check(audit.governance?.canChangeChampion === false, 'V18_CAN_CHANGE_CHAMPION');
check(audit.governance?.canPromoteChallenger === false, 'V18_CAN_PROMOTE_CHALLENGER');
check(audit.governance?.canCreateHeadlinePerformanceMetric === false, 'V18_CAN_CREATE_HEADLINE_METRIC');

if (audit.source?.sourceArtifactAvailable !== true || audit.reproducible !== true) {
  check(audit.acceptedForPerformanceClaims === false, 'V18_PERFORMANCE_ACCEPTED_WITHOUT_REPRODUCIBLE_SOURCE');
  check(audit.status === 'BLOCKED_UNTIL_REPRODUCIBLE_SOURCE_AND_DEFINITIONS', 'V18_BLOCKED_STATUS_MISSING');
}
if (audit.definitions?.missing?.length > 0) {
  check(audit.acceptedForPerformanceClaims === false, 'V18_PERFORMANCE_ACCEPTED_WITH_MISSING_DEFINITIONS');
}
check(Number(audit.definitions?.definitionCoveragePct) >= 0 && Number(audit.definitions?.definitionCoveragePct) <= 100, 'V18_DEFINITION_COVERAGE_INVALID');
check(Array.isArray(audit.blockingReasons), 'V18_BLOCKING_REASONS_MISSING');

const report = {
  schemaVersion: '20.0.0-v18-performance-audit-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    contradictoryCountsPreservedAsAuditTriggersOnly: true,
    reproducibleSourceRequired: true,
    performanceDefinitionsRequired: true,
    independentEvidenceNotInferred: true,
    calibrationBlocked: true,
    executionGateProtected: true,
    championProtected: true,
    challengerPromotionProtected: true,
  },
  evidence: {
    auditStatus: audit.status,
    acceptedForPerformanceClaims: audit.acceptedForPerformanceClaims,
    sourceArtifactAvailable: audit.source?.sourceArtifactAvailable === true,
    definitionCoveragePct: audit.definitions?.definitionCoveragePct ?? null,
    missingDefinitionCount: audit.definitions?.missing?.length ?? null,
    observedTradeCounts: audit.unreconciledClaims?.observedTradeCounts || [],
  },
};

fs.writeFileSync(P('data/v20/v18-performance-audit-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
