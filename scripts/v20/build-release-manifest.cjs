#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => {
  const file = P(rel); fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, file);
};
function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim(); } catch { return null; }
}

const current = read('data/v20/current.json');
const regression = read('data/v20/regression.json');
const browser = read('data/v20/browser-smoke.json');
const explorer = read('data/v20/market-explorer.json');
const technical = read('data/v20/technical-history-status.json');
const sector = read('data/v20/sector-provenance-audit.json');
const forward = read('data/v20/forward-evaluation.json');
const performance = read('data/v20/performance-evidence-registry.json');
const sourceHealth = read('data/v20/source-health.json');
const marketRegime = read('data/v20/market-regime.json');
const profiles = read('data/v20/stock-profiles.json');
const rr = read('data/v20/risk-reward-audit.json');
const operations = read('data/v20/release-operations.json');
const finalAcceptance = regression.finalAcceptance;
if (!finalAcceptance) throw new Error('Final acceptance mirror missing from regression evidence');

const releaseClassification = finalAcceptance.researchPlatformReady === true && finalAcceptance.executionReady === false
  ? 'RESEARCH_RELEASE_CANDIDATE_EXECUTION_BLOCKED'
  : finalAcceptance.executionReady === true
    ? 'EXECUTION_RELEASE_CANDIDATE_REQUIRES_USER_DECISION'
    : 'NOT_RELEASE_READY';

const manifest = {
  schemaVersion: '20.0.0-release-manifest-1',
  generatedAt: new Date().toISOString(),
  releaseClassification,
  product: 'EGX PRO V20 — Integrated Investment Decision Platform',
  branch: operations.releaseBranch,
  validatedSourceCommit: gitSha(),
  validationRun: {
    githubRunId: process.env.GITHUB_RUN_ID || null,
    githubRunNumber: process.env.GITHUB_RUN_NUMBER || null,
    workflow: process.env.GITHUB_WORKFLOW || 'EGX Integrated Decision Platform Validation',
    actor: process.env.GITHUB_ACTOR || null,
  },
  session: {
    decisionSessionDate: current.sessionDate,
    executionStatus: current.executionStatus,
    dataStatus: current.dataStatus?.status || null,
    marketRegime: marketRegime.regime || null,
    marketRegimeVerified: marketRegime.verified === true,
  },
  governance: {
    activeChampion: current.governance?.activeChampion || null,
    challenger: current.governance?.challenger || null,
    challengerStatus: current.governance?.challengerStatus || null,
    automaticPromotion: current.governance?.automaticPromotion === true,
    promotionAllowed: current.governance?.promotionAllowed === true,
    v17ExecutionAuthorityPreserved: finalAcceptance.invariants?.v17ExecutionAuthorityPreserved === true,
  },
  acceptance: {
    finalStatus: finalAcceptance.finalStatus,
    researchPlatformReady: finalAcceptance.researchPlatformReady === true,
    executionReady: finalAcceptance.executionReady === true,
    validatorSummary: finalAcceptance.validatorSummary,
    criticalFindingCount: finalAcceptance.criticSummary?.criticalFindingCount ?? null,
    productionBlockerCount: finalAcceptance.criticSummary?.productionBlockerCount ?? null,
    productionBlockers: finalAcceptance.productionBlockers || [],
    limitations: finalAcceptance.limitations || [],
  },
  marketCoverage: {
    universeCount: explorer.summary?.universeCount || 0,
    currentSessionRows: explorer.summary?.currentSnapshotCount || 0,
    currentSessionCoveragePct: explorer.summary?.currentSessionCoveragePct ?? null,
    completeCurrentRows: explorer.summary?.completeCurrentRows || 0,
    partialCurrentRows: explorer.summary?.partialCurrentRows || 0,
    opportunityCount: explorer.summary?.opportunityCount || 0,
    marketOnlyCount: explorer.summary?.marketOnlyCount || 0,
    fullTechnicalCurrentReadyCount: explorer.summary?.currentTechnicalReadyCount || 0,
    fullTechnicalCoverageOfUniversePct: explorer.summary?.technicalCurrentCoverageOfUniversePct ?? null,
    fullTechnicalCoverageOfOpportunityUniversePct: explorer.summary?.technicalCurrentCoverageOfOpportunityUniversePct ?? null,
    verifiedMarketTrendContextCount: explorer.summary?.marketTrendContextReadyCount || 0,
    verifiedMarketTrendContextCoveragePct: explorer.summary?.marketTrendContextCoverageOfUniversePct ?? null,
    marketOnlyWithVerifiedTrendContextCount: explorer.summary?.marketOnlyTrendContextReadyCount || 0,
  },
  decisionIntelligence: {
    status: profiles.decisionIntelligenceSummary?.status || null,
    scoreIsConfidence: profiles.decisionIntelligenceSummary?.scoreIsConfidence === true,
    usedForExecutionGate: profiles.decisionIntelligenceSummary?.usedForExecutionGate === true,
    usedForProductionAllocation: profiles.decisionIntelligenceSummary?.usedForProductionAllocation === true,
    usedForChampionSelection: profiles.decisionIntelligenceSummary?.usedForChampionSelection === true,
    medianResearchDecisionScore: profiles.decisionIntelligenceSummary?.medianResearchDecisionScore ?? null,
    tierCounts: profiles.decisionIntelligenceSummary?.tierCounts || {},
    cappedScoreCount: profiles.decisionIntelligenceSummary?.cappedScoreCount || 0,
  },
  performanceAndForward: {
    performanceRegistryStatus: performance.summary?.status || null,
    singleHeadlineMetricAllowed: performance.policy?.singleHeadlinePerformanceMetricAllowed !== false,
    v18PerformanceAccepted: performance.policy?.v18PerformanceAccepted === true,
    forwardResolvedCount: forward.resolutionStatus?.resolvedCount || 0,
    forwardPendingCount: forward.resolutionStatus?.pendingCount || 0,
    pendingReturnMustRemainNull: forward.resolutionPolicy?.pendingReturnMustRemainNull === true,
    researchOutcomesMayBecomeProductionPerformance: (forward.evaluations || []).some(e => e.researchEvaluation?.appliedToProduction === true),
  },
  riskAndEvidence: {
    sourceStatus: sourceHealth.status || null,
    executionGrade: sourceHealth.executionGrade === true,
    supportResistanceResearchReady: sourceHealth.supportResistance?.researchReady === true,
    supportResistanceExecutionCandidateReady: sourceHealth.supportResistance?.executionCandidateReady === true,
    productionVerifiedSectorCount: sector.summary?.productionVerifiedCount || 0,
    productionSectorConcentrationEnabled: sector.summary?.productionSectorConcentrationEnabled === true,
    legacyRiskRewardMaterialMismatchCount: rr.materialMismatchCount || 0,
    currentTechnicalReadyCount: technical.currentTechnicalReadyCount || 0,
  },
  browserAcceptance: {
    passed: browser.ok === true,
    browser: browser.browser?.product || null,
    consoleErrorCount: (browser.consoleErrors || []).length,
    viewports: (browser.viewportResults || []).map(v => ({width:v.width,height:v.height,ready:v.ready,horizontalOverflow:v.horizontalOverflow,dialogHorizontalOverflow:v.dialogHorizontalOverflow})),
    humanPixelReviewClaimed: false,
  },
  operations: {
    deploymentStatus: operations.deployment?.status || null,
    dedicatedEgxV20TargetVerified: operations.deployment?.dedicatedEgxV20TargetVerified === true,
    dailyEndToEndScheduleVerified: operations.automation?.dailyEndToEndScheduleVerified === true,
    automationStatus: operations.automation?.status || null,
    v18AuditStatus: operations.v18Reference?.auditStatus || null,
  },
  releaseClaims: {
    researchReadyClaimAllowed: finalAcceptance.researchPlatformReady === true,
    executionReadyClaimAllowed: finalAcceptance.executionReady === true,
    deployedClaimAllowed: operations.deployment?.dedicatedEgxV20TargetVerified === true && operations.deployment?.status === 'DEPLOYED_VERIFIED',
    profitabilityClaimAllowed: false,
    v18PerformanceClaimAllowed: operations.v18Reference?.performanceEvidenceAccepted === true,
    humanPixelPerfectClaimAllowed: false,
  },
  evidenceIndex: {
    current: 'data/v20/current.json',
    finalAcceptance: 'data/v20/regression.json#finalAcceptance',
    browser: 'data/v20/browser-smoke.json',
    marketExplorer: 'data/v20/market-explorer.json',
    sourceHealth: 'data/v20/source-health.json',
    stockProfiles: 'data/v20/stock-profiles.json',
    performance: 'data/v20/performance-evidence-registry.json',
    forward: 'data/v20/forward-evaluation.json',
    sector: 'data/v20/sector-provenance-audit.json',
    operations: 'data/v20/release-operations.json',
  },
};

write('data/v20/release-manifest.json', manifest);
console.log(JSON.stringify({
  releaseClassification: manifest.releaseClassification,
  finalStatus: manifest.acceptance.finalStatus,
  researchReady: manifest.releaseClaims.researchReadyClaimAllowed,
  executionReadyClaimAllowed: manifest.releaseClaims.executionReadyClaimAllowed,
  deployedClaimAllowed: manifest.releaseClaims.deployedClaimAllowed,
  marketTrendContextCoveragePct: manifest.marketCoverage.verifiedMarketTrendContextCoveragePct,
  validatedSourceCommit: manifest.validatedSourceCommit,
  githubRunId: manifest.validationRun.githubRunId,
}, null, 2));
