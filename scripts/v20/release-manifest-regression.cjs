#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => { fs.writeFileSync(P(rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); };

const manifest = read('data/v20/release-manifest.json');
const current = read('data/v20/current.json');
const gate = read('data/v17/resilient-session-status.json');
const regression = read('data/v20/regression.json');
const explorer = read('data/v20/market-explorer.json');
const browser = read('data/v20/browser-smoke.json');
const operations = read('data/v20/release-operations.json');
const executionGap = regression.executionReadinessGap;
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };
const finiteNonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0;

check(manifest.schemaVersion === '20.0.0-release-manifest-2', 'RELEASE_MANIFEST_SCHEMA_DRIFT');
check(manifest.branch === 'develop/v20-integrated-decision-platform', 'RELEASE_BRANCH_DRIFT');
check(manifest.session?.decisionSessionDate === current.sessionDate, 'RELEASE_SESSION_MISMATCH');
check(manifest.governance?.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'RELEASE_CHAMPION_DRIFT');
check(manifest.governance?.automaticPromotion === false && manifest.governance?.promotionAllowed === false, 'RELEASE_PROMOTION_GOVERNANCE_DRIFT');
check(manifest.acceptance?.finalStatus === regression.finalAcceptance?.finalStatus, 'RELEASE_FINAL_ACCEPTANCE_MISMATCH');
check(manifest.acceptance?.researchPlatformReady === regression.finalAcceptance?.researchPlatformReady, 'RELEASE_RESEARCH_READY_MISMATCH');
check(manifest.acceptance?.executionReady === regression.finalAcceptance?.executionReady, 'RELEASE_EXECUTION_READY_MISMATCH');
check(manifest.releaseClaims?.researchReadyClaimAllowed === regression.finalAcceptance?.researchPlatformReady, 'RELEASE_RESEARCH_CLAIM_DRIFT');
check(manifest.releaseClaims?.executionReadyClaimAllowed === regression.finalAcceptance?.executionReady, 'RELEASE_EXECUTION_CLAIM_DRIFT');
check(manifest.releaseClaims?.profitabilityClaimAllowed === false, 'RELEASE_PROFITABILITY_CLAIM_ENABLED');
check(manifest.releaseClaims?.humanPixelPerfectClaimAllowed === false, 'RELEASE_PIXEL_PERFECT_CLAIM_ENABLED');
check(manifest.releaseClaims?.v18PerformanceClaimAllowed === false, 'RELEASE_V18_PERFORMANCE_CLAIM_ENABLED');
check(manifest.browserAcceptance?.passed === true && browser.ok === true, 'RELEASE_BROWSER_ACCEPTANCE_NOT_PASSED');
check(manifest.browserAcceptance?.consoleErrorCount === 0, 'RELEASE_BROWSER_CONSOLE_ERRORS_PRESENT');
check((manifest.browserAcceptance?.viewports || []).length === 5, 'RELEASE_BROWSER_VIEWPORT_COUNT_DRIFT');
check(manifest.browserAcceptance?.humanPixelReviewClaimed === false, 'RELEASE_FALSE_HUMAN_PIXEL_REVIEW_CLAIM');
check(manifest.marketCoverage?.universeCount === explorer.summary?.universeCount, 'RELEASE_UNIVERSE_COUNT_MISMATCH');
check(manifest.marketCoverage?.verifiedMarketTrendContextCount === explorer.summary?.marketTrendContextReadyCount, 'RELEASE_TREND_CONTEXT_COUNT_MISMATCH');
check(manifest.marketCoverage?.verifiedMarketTrendContextCoveragePct === explorer.summary?.marketTrendContextCoverageOfUniversePct, 'RELEASE_TREND_CONTEXT_COVERAGE_MISMATCH');
check(manifest.marketCoverage?.fullTechnicalCoverageOfUniversePct === explorer.summary?.technicalCurrentCoverageOfUniversePct, 'RELEASE_FULL_TECHNICAL_COVERAGE_MISMATCH');
check(manifest.operations?.dedicatedEgxV20TargetVerified === false, 'RELEASE_UNVERIFIED_DEPLOYMENT_TARGET_MARKED_VERIFIED');
check(manifest.releaseClaims?.deployedClaimAllowed === false, 'RELEASE_DEPLOYED_CLAIM_WITHOUT_TARGET');
check(manifest.operations?.dailyEndToEndScheduleVerified === false, 'RELEASE_UNVERIFIED_DAILY_AUTOMATION_MARKED_VERIFIED');
check(manifest.operations?.v18AuditStatus === 'INACCESSIBLE_NOT_ACCEPTED', 'RELEASE_V18_AUDIT_STATUS_DRIFT');
check(operations.releaseSafety?.mainBranchMutationAllowed === false, 'RELEASE_MAIN_MUTATION_POLICY_DRIFT');
check(operations.releaseSafety?.v16MutationAllowed === false && operations.releaseSafety?.v17MutationAllowed === false && operations.releaseSafety?.v19MutationAllowed === false, 'RELEASE_LEGACY_BRANCH_MUTATION_POLICY_DRIFT');

check(executionGap?.ok === true, 'RELEASE_EXECUTION_GAP_EVIDENCE_MISSING_OR_FAILED');
check(manifest.executionReadinessGap?.sourceSessionDate === current.sessionDate, 'RELEASE_EXECUTION_GAP_SESSION_MISMATCH');
check(manifest.executionReadinessGap?.mathematicalThresholdGapOnly === true, 'RELEASE_EXECUTION_GAP_NOT_LABELED_MATHEMATICAL_ONLY');
check(manifest.executionReadinessGap?.guaranteesExecutionGrade === false, 'RELEASE_EXECUTION_GAP_FALSE_GUARANTEE');
check(manifest.executionReadinessGap?.requiresFullV17GateRebuildAfterEvidenceChanges === true, 'RELEASE_EXECUTION_GAP_REBUILD_REQUIREMENT_MISSING');
check(manifest.executionReadinessGap?.evidence === 'data/v20/regression.json#executionReadinessGap', 'RELEASE_EXECUTION_GAP_PROVENANCE_DRIFT');
check(JSON.stringify(manifest.executionReadinessGap?.gaps) === JSON.stringify(executionGap?.gaps), 'RELEASE_EXECUTION_GAPS_MISMATCH');
check(JSON.stringify(manifest.executionReadinessGap?.required) === JSON.stringify(executionGap?.required), 'RELEASE_EXECUTION_REQUIRED_COUNTS_MISMATCH');
check(JSON.stringify(manifest.executionReadinessGap?.current) === JSON.stringify(executionGap?.current), 'RELEASE_EXECUTION_CURRENT_COUNTS_MISMATCH');
check(JSON.stringify(manifest.executionReadinessGap?.symbols) === JSON.stringify(executionGap?.symbols), 'RELEASE_EXECUTION_GAP_SYMBOLS_MISMATCH');
for (const [key, value] of Object.entries(manifest.executionReadinessGap?.gaps || {})) check(finiteNonNegative(value), `RELEASE_EXECUTION_GAP_INVALID_${key.toUpperCase()}`);
check(Number(manifest.executionReadinessGap?.required?.trustedCandidateCount || 0) <= Number(manifest.executionReadinessGap?.current?.candidateUniverseCount || 0), 'RELEASE_REQUIRED_TRUSTED_EXCEEDS_UNIVERSE');
check(Number(manifest.executionReadinessGap?.required?.trustedFreshCandidateCount || 0) <= Number(manifest.executionReadinessGap?.current?.candidateUniverseCount || 0), 'RELEASE_REQUIRED_FRESH_EXCEEDS_UNIVERSE');
check(Number(manifest.executionReadinessGap?.required?.criticalCandidateEquivalentCount || 0) <= Number(manifest.executionReadinessGap?.current?.candidateUniverseCount || 0), 'RELEASE_REQUIRED_CRITICAL_EXCEEDS_UNIVERSE');

if (gate.executionGrade !== true) {
  check(manifest.acceptance?.executionReady === false, 'RELEASE_EXECUTION_READY_WHILE_V17_GATE_CLOSED');
  check(manifest.releaseClaims?.executionReadyClaimAllowed === false, 'RELEASE_EXECUTION_CLAIM_WHILE_V17_GATE_CLOSED');
  check(manifest.releaseClassification === 'RESEARCH_RELEASE_CANDIDATE_EXECUTION_BLOCKED', 'RELEASE_CLASSIFICATION_OVERSTATES_CLOSED_GATE');
  check(manifest.session?.executionStatus !== 'EXECUTION_GRADE', 'RELEASE_SESSION_EXECUTION_STATUS_OVERRIDES_V17');
  check(Number(current.portfolio?.recommendedExposurePct || 0) === 0, 'RELEASE_CLOSED_GATE_NONZERO_EXPOSURE');
}
if (operations.deployment?.dedicatedEgxV20TargetVerified !== true) {
  check(manifest.releaseClaims?.deployedClaimAllowed === false, 'RELEASE_DEPLOYMENT_CLAIM_WITHOUT_DEDICATED_TARGET');
  check(manifest.operations?.deploymentStatus === 'NOT_DEPLOYED_FROM_V20_RELEASE', 'RELEASE_DEPLOYMENT_STATUS_OVERSTATED');
}
check(manifest.decisionIntelligence?.scoreIsConfidence === false, 'RELEASE_DECISION_SCORE_CONFIDENCE_MIX');
check(manifest.decisionIntelligence?.usedForExecutionGate === false, 'RELEASE_DECISION_SCORE_EXECUTION_LEAK');
check(manifest.decisionIntelligence?.usedForProductionAllocation === false, 'RELEASE_DECISION_SCORE_ALLOCATION_LEAK');
check(manifest.performanceAndForward?.singleHeadlineMetricAllowed === false, 'RELEASE_PERFORMANCE_HEADLINE_METRIC_ALLOWED');
check(manifest.performanceAndForward?.v18PerformanceAccepted === false, 'RELEASE_V18_PERFORMANCE_ACCEPTED');
check(manifest.performanceAndForward?.researchOutcomesMayBecomeProductionPerformance === false, 'RELEASE_RESEARCH_OUTCOMES_PRODUCTION_LEAK');
check(manifest.performanceAndForward?.pendingReturnMustRemainNull === true, 'RELEASE_PENDING_RETURN_POLICY_DRIFT');

const report = {
  schemaVersion: '20.0.0-release-manifest-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    releaseClaimsMatchFinalAcceptance: true,
    closedV17GateCannotBeOverstated: true,
    executionGapMatchesAuthoritativeDerivedEvidence: true,
    executionGapIsSessionDynamic: true,
    executionGapNeverGuaranteesExecutionGrade: true,
    deploymentCannotBeClaimedWithoutDedicatedTarget: true,
    dailyAutomationCannotBeClaimedWithoutVerifiedSchedule: true,
    v18PerformanceRemainsUnaccepted: true,
    trendContextAndFullTechnicalCoverageRemainDistinct: true,
    decisionScoreConfidenceExecutionRemainSeparated: true,
    browserAcceptanceMustBeRealAndGreen: true,
    profitabilityAndPixelPerfectClaimsDisabled: true
  }
};
write('data/v20/release-manifest-regression.json', report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
