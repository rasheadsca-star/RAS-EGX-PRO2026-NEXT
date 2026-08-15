#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const registry = read('data/v20/performance-evidence-registry.json');
const v18Audit = read('data/v20/v18-performance-audit.json');
const v19Lock = read('data/v19/v6-research-champion-lock.json');
const v19Native = read('data/v19/native-challenger-v6.json');
const forward = read('data/v20/forward-evaluation.json');
const current = read('data/v20/current.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(registry.schemaVersion === '20.0.0-performance-evidence-registry-1', 'PERFORMANCE_REGISTRY_SCHEMA_UNEXPECTED');
check(registry.policy?.singleHeadlinePerformanceMetricAllowed === false, 'SINGLE_HEADLINE_PERFORMANCE_ALLOWED');
check(registry.policy?.crossEvidenceAggregationAllowed === false, 'CROSS_EVIDENCE_AGGREGATION_ALLOWED');
check(registry.policy?.historicalAndForwardEvidenceMustRemainSeparate === true, 'HISTORICAL_FORWARD_NOT_SEPARATED');
check(registry.policy?.developmentAndHoldoutEvidenceMustRemainSeparate === true, 'DEVELOPMENT_HOLDOUT_NOT_SEPARATED');
check(registry.policy?.reusedBenchmarkCanPromoteChallenger === false, 'REUSED_BENCHMARK_CAN_PROMOTE');
check(registry.policy?.pendingForwardReturnMustRemainNull === true, 'PENDING_FORWARD_NULL_POLICY_MISSING');
check(registry.policy?.v18AuditRequired === true, 'V18_AUDIT_REQUIREMENT_MISSING');
check(registry.policy?.v18PerformanceAccepted === (v18Audit.acceptedForPerformanceClaims === true && v18Audit.reproducible === true), 'V18_AUDIT_REGISTRY_ACCEPTANCE_MISMATCH');

const map = new Map((registry.entries || []).map(row => [row.evidenceId, row]));
const dev = map.get('V19_V6_DEVELOPMENT_OOS');
const bench = map.get('V19_V6_REUSED_BENCHMARK');
const live = map.get('V20_LIVE_FORWARD_TRACKING');
const walk = map.get('V16_BLOCKED_WALK_FORWARD');

check(Boolean(dev), 'V19_DEVELOPMENT_EVIDENCE_MISSING');
check(Boolean(bench), 'V19_REUSED_BENCHMARK_EVIDENCE_MISSING');
check(Boolean(live), 'V20_FORWARD_EVIDENCE_MISSING');
check(Boolean(walk), 'V16_WALK_FORWARD_EVIDENCE_MISSING');

if (dev) {
  check(dev.evidenceClass === 'DEVELOPMENT_OOS', 'V19_DEVELOPMENT_CLASS_WRONG');
  check(dev.metrics?.sessions === Number(v19Native?.development?.metrics?.sessions), 'V19_DEVELOPMENT_SESSION_MISMATCH');
  check(dev.metrics?.averageNetReturnPct === Number(v19Native?.development?.metrics?.averageNetReturnPct), 'V19_DEVELOPMENT_AVERAGE_MISMATCH');
  check(dev.independence?.freshIndependentEvidence === false, 'V19_DEVELOPMENT_FALSELY_FRESH_INDEPENDENT');
}
if (bench) {
  check(bench.evidenceClass === 'REUSED_BENCHMARK_NOT_INDEPENDENT', 'V19_BENCHMARK_CLASS_WRONG');
  check(bench.metrics?.sessions === Number(v19Lock?.benchmarkResult?.sessions), 'V19_BENCHMARK_SESSION_MISMATCH');
  check(bench.metrics?.averageNetReturnPct === Number(v19Lock?.benchmarkResult?.averageNetReturnPct), 'V19_BENCHMARK_AVERAGE_MISMATCH');
  check(bench.independence?.freshIndependentEvidence === false, 'V19_BENCHMARK_FALSELY_INDEPENDENT');
  check(bench.independence?.benchmarkInformedArchitecture === true, 'V19_BENCHMARK_POSTHOC_DISCLOSURE_MISSING');
  check(bench.promotionEligible === false, 'V19_BENCHMARK_PROMOTION_ELIGIBLE');
}

const pending = (forward.evaluations || []).filter(row => row.status === 'PENDING');
for (const item of pending) {
  check(item.portfolioReturnGrossPct === null, `PENDING_FORWARD_GROSS_NOT_NULL_${item.horizonSessions}`);
  check(item.portfolioReturnNetPct === null, `PENDING_FORWARD_NET_NOT_NULL_${item.horizonSessions}`);
}
if (live) {
  check(live.evidenceClass === 'LIVE_FORWARD', 'V20_FORWARD_CLASS_WRONG');
  check(live.forwardState?.pendingCount === pending.length, 'V20_FORWARD_PENDING_COUNT_MISMATCH');
  check(live.independence?.status === 'POINT_IN_TIME_FORWARD_TRACKING', 'V20_FORWARD_POINT_IN_TIME_STATUS_MISSING');
}

check(registry.summary?.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'ACTIVE_CHAMPION_DRIFT_IN_PERFORMANCE_REGISTRY');
check(registry.summary?.v19AutomaticPromotion === false, 'V19_AUTO_PROMOTION_TRUE_IN_REGISTRY');
check(registry.summary?.v19PromotionAllowed === false, 'V19_PROMOTION_TRUE_IN_REGISTRY');
check(current.governance?.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'CURRENT_CHAMPION_DRIFT');

const v18 = registry.externalReferences?.v18 || {};
check(v18.auditFile === 'data/v20/v18-performance-audit.json', 'V18_AUDIT_FILE_NOT_LINKED');
check(JSON.stringify(v18.observedTradeCounts || []) === JSON.stringify([16, 971, 1138]), 'V18_CONTRADICTORY_COUNTS_NOT_EXPOSED');
check(v18.acceptedForPerformanceClaims === registry.policy.v18PerformanceAccepted, 'V18_EXTERNAL_REGISTRY_ACCEPTANCE_MISMATCH');
check(v18.governance?.canCalibrateV20DecisionScore === false, 'V18_CAN_CALIBRATE_V20_FROM_REGISTRY');
check(v18.governance?.canOpenExecutionGate === false, 'V18_CAN_OPEN_EXECUTION_FROM_REGISTRY');
check(v18.governance?.canChangeChampion === false, 'V18_CAN_CHANGE_CHAMPION_FROM_REGISTRY');
check(v18.governance?.canPromoteChallenger === false, 'V18_CAN_PROMOTE_CHALLENGER_FROM_REGISTRY');
if (v18.sourceArtifactAvailable !== true || v18.reproducible !== true || v18.tradeCountsReconciled !== true) {
  check(v18.acceptedForPerformanceClaims === false, 'V18_PERFORMANCE_FALSELY_ACCEPTED');
}

const report = {
  schemaVersion: '20.0.0-performance-evidence-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    evidenceClassesSeparated: true,
    weakDevelopmentEvidenceNotHidden: true,
    reusedBenchmarkNotPromotionEvidence: true,
    pendingForwardReturnsRemainNull: true,
    v18PerformanceGovernedByDedicatedAudit: true,
    v18ClaimsNotUsedForCalibrationOrPromotion: true,
    championGovernancePreserved: true,
  },
  evidence: {
    registryEntries: (registry.entries || []).length,
    v18AuditStatus: v18.status || null,
    v18AcceptedForPerformanceClaims: v18.acceptedForPerformanceClaims === true,
    v18DefinitionCoveragePct: v18.definitionCoveragePct ?? null,
    v18ObservedTradeCounts: v18.observedTradeCounts || [],
    v19DevelopmentSessions: dev?.metrics?.sessions || null,
    v19DevelopmentAverageNetReturnPct: dev?.metrics?.averageNetReturnPct ?? null,
    v19BenchmarkSessions: bench?.metrics?.sessions || null,
    v19BenchmarkAverageNetReturnPct: bench?.metrics?.averageNetReturnPct ?? null,
    forwardPendingCount: pending.length,
  }
};

fs.writeFileSync(P('data/v20/performance-evidence-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
