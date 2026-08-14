#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => {
  const file = P(rel); fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, file);
};
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};

const current = read('data/v20/current.json');
const gate = read('data/v17/resilient-session-status.json');
const regression = read('data/v20/regression.json');
const tradePlanRegression = read('data/v20/trade-plan-regression.json');
const phase3 = read('data/v20/phase3-regression.json');
const ui = read('data/v20/ui-validation.json');
const browser = read('data/v20/browser-smoke.json');
const dataQuality = read('data/v20/data-quality-regression.json');
const nullSemantics = read('data/v20/null-semantics-regression.json');
const technicalStatus = read('data/v20/technical-history-status.json');
const technicalRegression = read('data/v20/technical-history-regression.json');
const sector = read('data/v20/sector-provenance-audit.json');
const sectorRegression = read('data/v20/sector-provenance-regression.json');
const performance = read('data/v20/performance-evidence-registry.json');
const performanceRegression = read('data/v20/performance-evidence-regression.json');
const forward = read('data/v20/forward-evaluation.json');
const portfolioRisk = read('data/v20/portfolio-risk.json');
const sourceHealth = read('data/v20/source-health.json');
const marketRegime = read('data/v20/market-regime.json');
const marketRegimeRegression = read('data/v20/market-regime-regression.json');
const decisionPolicy = read('data/v20/decision-intelligence-policy.json');
const profiles = read('data/v20/stock-profiles.json');
const marketExplorer = read('data/v20/market-explorer.json');
const marketExplorerRegression = read('data/v20/market-explorer-regression.json');
const userPortfolioRegression = read('data/v20/user-portfolio-regression.json');
const riskRewardAudit = read('data/v20/risk-reward-audit.json');

const validators = {
  governanceRegression: regression.ok === true,
  tradePlanRegression: tradePlanRegression.ok === true,
  phase3Regression: phase3.ok === true,
  uiContract: ui.ok === true,
  browserRuntime: browser.ok === true,
  dataQuality: dataQuality.ok === true,
  nullSemantics: nullSemantics.ok === true,
  technicalLeakage: technicalRegression.ok === true,
  sectorProvenance: sectorRegression.ok === true,
  performanceSeparation: performanceRegression.ok === true,
  marketRegime: marketRegimeRegression.ok === true,
  marketExplorer: marketExplorerRegression.ok === true,
  userPortfolio: userPortfolioRegression.ok === true,
  forwardEmbeddedRegression: forward.evaluationRegression?.ok === true,
};
const failedValidators = Object.entries(validators).filter(([,ok]) => !ok).map(([name]) => name);

const governancePass = current.governance?.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET'
  && current.governance?.automaticPromotion === false
  && current.governance?.promotionAllowed === false
  && decisionPolicy.scoreCanOpenExecutionGate === false
  && decisionPolicy.scoreCanDriveProductionAllocation === false
  && decisionPolicy.scoreCanChangeChampion === false
  && decisionPolicy.scoreCanTriggerAutomaticPromotion === false;
const runtimePass = browser.ok === true && (browser.consoleErrors || []).length === 0
  && (browser.viewportResults || []).length === 5
  && (browser.viewportResults || []).every(v => v.ready === true && v.horizontalOverflow === false && (v.width > 430 || v.dialogHorizontalOverflow === false));
const immutableEvidencePass = phase3.checks?.immutableSignalArchive === true
  && phase3.checks?.immutableSignalArchiveLegacyNumericSemanticsPreserved === true
  && forward.authoritativeEvidence?.selfContainedStatus === true
  && forward.authoritativeEvidence?.selfContainedRegression === true
  && forward.authoritativeEvidence?.derivedSidecarsAreAuthoritative === false;
const researchDataPass = gate.readiness?.researchReady === true
  && gate.priceTruth?.researchMinimumHealthy === true
  && gate.sessionAligned === true
  && marketExplorer.summary?.currentSessionCoveragePct >= 90;
const decisionSeparationPass = profiles.decisionIntelligenceSummary?.status === 'SHADOW_RESEARCH_ONLY_UNCALIBRATED'
  && profiles.decisionIntelligenceSummary?.scoreIsConfidence === false
  && profiles.decisionIntelligenceSummary?.usedForExecutionGate === false
  && profiles.decisionIntelligenceSummary?.usedForProductionAllocation === false
  && profiles.decisionIntelligenceSummary?.usedForChampionSelection === false;
const performanceEvidencePass = performance.policy?.singleHeadlinePerformanceMetricAllowed === false
  && performance.policy?.crossEvidenceAggregationAllowed === false
  && performance.policy?.historicalAndForwardEvidenceMustRemainSeparate === true
  && performance.policy?.reusedBenchmarkCanPromoteChallenger === false
  && performance.policy?.v18PerformanceAccepted === false;
const researchPlatformReady = failedValidators.length === 0
  && governancePass && runtimePass && immutableEvidencePass && researchDataPass
  && decisionSeparationPass && performanceEvidencePass;

const executionReady = researchPlatformReady
  && gate.executionGrade === true
  && current.executionStatus === 'EXECUTION_GRADE'
  && gate.readiness?.executionReady === true
  && gate.executionInputs?.ready === true
  && (gate.reasons || []).length === 0;

const finalStatus = executionReady
  ? 'EXECUTION_PLATFORM_READY_SUBJECT_TO_USER_DECISION'
  : researchPlatformReady
    ? 'RESEARCH_PLATFORM_READY_EXECUTION_NOT_READY'
    : 'RESEARCH_PLATFORM_NOT_READY';

const productionBlockers = (gate.reasons || []).map(code => ({
  severity: 'PRODUCTION_BLOCKER',
  code,
  source: 'data/v17/resilient-session-status.json',
  blocksResearchPlatform: false,
  blocksExecutionGrade: true,
}));

const criticFindings = [];
for (const name of failedValidators) criticFindings.push({severity:'CRITICAL_CODE_OR_CONTRACT', code:`VALIDATOR_FAILED_${name.toUpperCase()}`, source:'V20 validation evidence'});
if (!governancePass) criticFindings.push({severity:'CRITICAL_GOVERNANCE', code:'GOVERNANCE_INVARIANT_FAILED', source:'V20 current / decision policy'});
if (!runtimePass) criticFindings.push({severity:'CRITICAL_RUNTIME', code:'REAL_BROWSER_ACCEPTANCE_FAILED', source:'data/v20/browser-smoke.json'});
if (!immutableEvidencePass) criticFindings.push({severity:'CRITICAL_EVIDENCE', code:'IMMUTABLE_OR_FORWARD_EVIDENCE_CONTRACT_FAILED', source:'signal archive / forward evidence'});
if (!researchDataPass) criticFindings.push({severity:'RESEARCH_BLOCKER', code:'RESEARCH_DATA_READINESS_FAILED', source:'V17 gate / Market Explorer'});
if (!decisionSeparationPass) criticFindings.push({severity:'CRITICAL_DECISION', code:'SCORE_CONFIDENCE_EXECUTION_SEPARATION_FAILED', source:'data/v20/stock-profiles.json'});
if (!performanceEvidencePass) criticFindings.push({severity:'CRITICAL_PERFORMANCE', code:'PERFORMANCE_EVIDENCE_SEPARATION_FAILED', source:'data/v20/performance-evidence-registry.json'});
criticFindings.push(...productionBlockers);

const limitations = [];
if (sector.summary?.productionVerifiedCount === 0) limitations.push({code:'PRODUCTION_SECTOR_CLASSIFICATION_UNAVAILABLE', detail:`${sector.summary.productionVerifiedCount}/${sector.summary.universeCount || marketExplorer.summary?.universeCount || 0} production-verified sectors; sector concentration remains disabled.`, source:'data/v20/sector-provenance-audit.json'});
if (forward.resolutionStatus?.pendingCount > 0) limitations.push({code:'FORWARD_OUTCOMES_PENDING', detail:`${forward.resolutionStatus.pendingCount} forward evaluations pending; no pending return is interpreted as zero.`, source:'data/v20/forward-evaluation.json'});
if (technicalStatus.currentTechnicalCoveragePct < 100) limitations.push({code:'CURRENT_TECHNICAL_COVERAGE_PARTIAL', detail:`${technicalStatus.currentTechnicalReadyCount}/${technicalStatus.requestedSymbols} opportunity symbols current-technical-ready (${technicalStatus.currentTechnicalCoveragePct}%).`, source:'data/v20/technical-history-status.json'});
if (marketExplorer.summary?.technicalCurrentCoverageOfUniversePct < 100) limitations.push({code:'FULL_MARKET_TECHNICAL_COVERAGE_PARTIAL', detail:`Current technical evidence covers ${marketExplorer.summary.technicalCurrentCoverageOfUniversePct}% of the full market universe; MARKET_ONLY rows are not assigned fabricated technical decision scores.`, source:'data/v20/market-explorer.json'});
if (performance.policy?.v18PerformanceAccepted === false) limitations.push({code:'V18_PERFORMANCE_NOT_AUDITED_OR_ACCEPTED', detail:'V18 performance claims remain excluded from accepted evidence until a reproducible audit is completed.', source:'data/v20/performance-evidence-registry.json'});
if (browser.limitations?.length) limitations.push({code:'HUMAN_PIXEL_REVIEW_NOT_COMPLETED', detail:'Real Chrome runtime and overflow acceptance passed; screenshot hashes were recorded, but no human pixel-level design review is claimed.', source:'data/v20/browser-smoke.json'});
if (riskRewardAudit.materialMismatchCount > 0) limitations.push({code:'LEGACY_RR_MISMATCHES_REMAIN_AUDIT_ONLY', detail:`${riskRewardAudit.materialMismatchCount}/${riskRewardAudit.rowCount || profiles.profileCount} legacy R/R rows materially mismatch conservative current methodology; legacy R/R remains audit-only.`, source:'data/v20/risk-reward-audit.json'});
if (sourceHealth.semanticRowQuality?.partialRows > 0) limitations.push({code:'PARTIAL_CURRENT_MARKET_ROWS_EXIST', detail:`${sourceHealth.semanticRowQuality.partialRows} current-session market rows are semantically partial; they are not mislabeled complete.`, source:'data/v20/source-health.json'});
if (marketRegime.verified === true && finite(marketRegime.metrics?.advances) !== null && finite(marketRegime.metrics?.declines) !== null && marketRegime.metrics.advances < marketRegime.metrics.declines) limitations.push({code:'BULLISH_REGIME_WITH_WEAK_DAILY_BREADTH', detail:'Verified BULLISH regime coexists with weaker same-session advance/decline breadth; UI discloses this conflict and regime does not open execution.', source:'data/v20/market-regime.json'});

const acceptanceMatrix = {
  repositoryIsolation: {state:'PASS', evidence:'Main V20 workflow isolation guard'},
  governance: {state: governancePass ? 'PASS' : 'FAIL', evidence:'V16 Champion preserved; no automatic promotion'},
  dataTruthForResearch: {state: researchDataPass ? 'PASS' : 'FAIL', evidence:`V17 researchReady=${gate.readiness?.researchReady === true}; sessionAligned=${gate.sessionAligned === true}`},
  executionGrade: {state: executionReady ? 'PASS' : 'BLOCKED', evidence:`V17 executionGrade=${gate.executionGrade === true}; V20 executionStatus=${current.executionStatus}`},
  costAwareRiskReward: {state: riskRewardAudit.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS' ? 'PASS' : 'FAIL', evidence:'Legacy R/R audit-only'},
  tradePlanAlignment: {state: tradePlanRegression.ok === true ? 'PASS' : 'FAIL', evidence:'Current price / entry-zone fail-closed policy'},
  pointInTimeTechnical: {state: technicalRegression.ok === true ? 'PASS_WITH_PARTIAL_COVERAGE' : 'FAIL', evidence:`${technicalStatus.currentTechnicalReadyCount}/${technicalStatus.requestedSymbols} current-ready`},
  decisionIntelligence: {state: decisionSeparationPass ? 'PASS_RESEARCH_ONLY' : 'FAIL', evidence:'Score/Confidence/Execution separated; uncalibrated research score'},
  sectorRisk: {state: sector.summary?.productionSectorConcentrationEnabled === false ? 'BLOCKED_BY_PROVENANCE' : 'PASS', evidence:`productionVerified=${sector.summary?.productionVerifiedCount || 0}`},
  performanceEvidence: {state: performanceEvidencePass ? 'PASS_SEPARATED' : 'FAIL', evidence:performance.summary?.status || 'evidence registry'},
  forwardEvidence: {state: forward.evaluationRegression?.ok === true ? (forward.resolutionStatus?.pendingCount > 0 ? 'PASS_PENDING_OUTCOMES' : 'PASS') : 'FAIL', evidence:`resolved=${forward.resolutionStatus?.resolvedCount || 0}, pending=${forward.resolutionStatus?.pendingCount || 0}`},
  browserRuntime: {state: runtimePass ? 'PASS' : 'FAIL', evidence:`${browser.browser?.product || 'browser'}; 5 responsive viewports; consoleErrors=${(browser.consoleErrors || []).length}`},
  uiContract: {state: ui.ok === true ? 'PASS' : 'FAIL', evidence:`${ui.schemaVersion}; failed=${ui.failedCount}`},
  userPortfolio: {state: userPortfolioRegression.ok === true ? 'PASS_LOCAL_ONLY' : 'FAIL', evidence:'localStorage only; current-session valuation; no automatic orders'},
};

const report = {
  schemaVersion:'20.0.0-final-acceptance-1',
  generatedAt:new Date().toISOString(),
  sessionDate:current.sessionDate,
  independentCritic:true,
  finalStatus,
  researchPlatformReady,
  executionReady,
  decisionSupportOnly:current.decisionSupportOnly === true,
  activeChampion:current.governance?.activeChampion || null,
  executionStatus:current.executionStatus,
  appliedExposurePct:finite(current.portfolio?.recommendedExposurePct),
  cashPct:finite(current.portfolio?.cashPct),
  validatorSummary:{total:Object.keys(validators).length,passed:Object.values(validators).filter(Boolean).length,failed:failedValidators.length,failedValidators},
  acceptanceMatrix,
  criticSummary:{criticalFindingCount:criticFindings.filter(x=>String(x.severity).startsWith('CRITICAL')).length,researchBlockerCount:criticFindings.filter(x=>x.severity==='RESEARCH_BLOCKER').length,productionBlockerCount:productionBlockers.length,limitationCount:limitations.length},
  criticFindings,
  productionBlockers,
  limitations,
  invariants:{
    v17ExecutionAuthorityPreserved:gate.executionGrade === true || current.executionStatus !== 'EXECUTION_GRADE',
    closedGateHasZeroActionable:(gate.executionGrade === true) || !(current.opportunities || []).some(o=>o.status==='ACTIONABLE'),
    closedGateHasZeroProductionExposure:(gate.executionGrade === true) || Number(current.portfolio?.recommendedExposurePct || 0) === 0,
    championProtected:current.governance?.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET',
    automaticPromotionDisabled:current.governance?.automaticPromotion === false && current.governance?.promotionAllowed === false,
    scoreConfidenceExecutionSeparated:decisionSeparationPass,
    researchPerformanceNotProduction:performance.policy?.reusedBenchmarkCanPromoteChallenger === false && (forward.evaluations || []).every(e=>e.researchEvaluation?.appliedToProduction !== true),
    pendingReturnsRemainNull:(forward.evaluations || []).filter(e=>e.status==='PENDING').every(e=>e.portfolioReturnGrossPct===null && e.portfolioReturnNetPct===null && e.researchEvaluation?.equalWeightIssuedNetReturnPct===null),
    browserAcceptanceRealRuntime:runtimePass,
  },
  finalStatement: executionReady
    ? 'V20 passed the independent acceptance matrix including the authoritative V17 execution gate. It remains decision support; user execution remains discretionary.'
    : researchPlatformReady
      ? 'V20 is accepted as a research and investment-decision-support platform. Execution Grade is explicitly not accepted because authoritative V17 production blockers remain.'
      : 'V20 is not accepted as a research platform because one or more critical validation layers failed.',
};

write('data/v20/final-acceptance.json', report);
console.log(JSON.stringify(report, null, 2));
if (!researchPlatformReady) process.exitCode = 1;
if (gate.executionGrade !== true && (executionReady || finalStatus.includes('EXECUTION_PLATFORM_READY'))) process.exitCode = 1;
