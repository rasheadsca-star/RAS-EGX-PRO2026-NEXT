#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const current = read('data/v20/current.json');
const audit = read('data/v20/risk-reward-audit.json');
const profiles = read('data/v20/stock-profiles.json');
const decisionPolicy = read('data/v20/decision-intelligence-policy.json');
const archiveIndex = read('data/v20/signal-archive/index.json');
const forward = read('data/v20/forward-evaluation.json');

const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(current.riskRewardPolicy?.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS', 'PRIMARY_RR_POLICY_NOT_NET_COST_AWARE');
check(audit.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS', 'AUDIT_PRIMARY_RR_POLICY_DRIFT');
check(audit.legacyMetricPolicy === 'AUDIT_ONLY_REFERENCE_UNVERIFIED', 'LEGACY_RR_NOT_AUDIT_ONLY');
check(audit.methodology?.exactLegacyFormulaClaimed === false, 'UNVERIFIED_LEGACY_RR_FORMULA_CLAIMED');
check(profiles.schemaVersion === '20.0.0-stock-profiles-3', 'STOCK_PROFILES_SCHEMA_NOT_V3');
check(profiles.profileCount === (current.opportunities || []).length, 'PROFILE_COUNT_MISMATCH');
check(profiles.technicalIndicatorPolicy === 'POINT_IN_TIME_TRUSTED_OHLC_ONLY_STALE_CONTEXT_NEVER_CURRENT_DECISION', 'TECHNICAL_INDICATOR_POLICY_DRIFT');

check(decisionPolicy.status === 'SHADOW_RESEARCH_ONLY_UNCALIBRATED', 'DECISION_POLICY_NOT_SHADOW_RESEARCH');
check(decisionPolicy.scoreIsConfidence === false, 'DECISION_POLICY_SCORE_CONFIDENCE_MIX');
check(decisionPolicy.scoreCanOpenExecutionGate === false, 'DECISION_POLICY_EXECUTION_GATE_LEAK');
check(decisionPolicy.scoreCanCreateActionableStatus === false, 'DECISION_POLICY_ACTIONABLE_LEAK');
check(decisionPolicy.scoreCanDriveProductionAllocation === false, 'DECISION_POLICY_ALLOCATION_LEAK');
check(decisionPolicy.scoreCanChangeChampion === false, 'DECISION_POLICY_CHAMPION_LEAK');
check(decisionPolicy.scoreCanTriggerAutomaticPromotion === false, 'DECISION_POLICY_PROMOTION_LEAK');
check(decisionPolicy.modelConfidenceMayBeInferredFromScore === false, 'DECISION_POLICY_MODEL_CONFIDENCE_INFERENCE');
check(decisionPolicy.rankingMayReplaceProductionChampionRanking === false, 'DECISION_POLICY_PRODUCTION_RANKING_REPLACEMENT');
const decisionKeys = ['legacyOpportunity','dataEvidence','liquidity','supportResistance','netRiskReward','tradePlanAlignment','currentTechnical'];
check(decisionKeys.reduce((sum, key) => sum + Number(decisionPolicy.componentWeightsPct?.[key] || 0), 0) === 100, 'DECISION_POLICY_WEIGHTS_NOT_100');
check(profiles.decisionIntelligencePolicy?.schemaVersion === decisionPolicy.schemaVersion, 'DECISION_POLICY_NOT_EMBEDDED_IN_PROFILES');
check(profiles.decisionIntelligenceSummary?.status === 'SHADOW_RESEARCH_ONLY_UNCALIBRATED', 'DECISION_SUMMARY_NOT_RESEARCH_ONLY');
check(profiles.decisionIntelligenceSummary?.scoreIsConfidence === false, 'DECISION_SUMMARY_SCORE_CONFIDENCE_MIX');
check(profiles.decisionIntelligenceSummary?.usedForExecutionGate === false, 'DECISION_SUMMARY_EXECUTION_GATE_LEAK');
check(profiles.decisionIntelligenceSummary?.usedForProductionAllocation === false, 'DECISION_SUMMARY_ALLOCATION_LEAK');
check(profiles.decisionIntelligenceSummary?.usedForChampionSelection === false, 'DECISION_SUMMARY_CHAMPION_LEAK');
check((profiles.researchDecisionRanking || []).length === profiles.profileCount, 'DECISION_RESEARCH_RANKING_COUNT_MISMATCH');

for (const row of current.opportunities || []) {
  const rr = row.riskReward || {};
  const t1Net = finite(row.tradePlan?.target1Metrics?.netRiskReward);
  const primary = finite(rr.primaryTarget1NetRiskReward);
  check(rr.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS', `PRIMARY_RR_NOT_CONSERVATIVE_NET_${row.ticker}`);
  check(rr.legacyIsPrimary === false, `LEGACY_RR_PRIMARY_${row.ticker}`);
  check(primary === t1Net, `PRIMARY_NET_RR_MISMATCH_${row.ticker}`);
  if (finite(rr.legacyRiskReward) !== null) check(rr.legacyReference === 'UNVERIFIED_PRICE_REFERENCE', `LEGACY_REFERENCE_NOT_UNVERIFIED_${row.ticker}`);
  if (rr.materialMismatch === true) check((rr.auditReasons || []).includes('LEGACY_RR_MATERIAL_MISMATCH_VS_CONSERVATIVE_ENTRY_HIGH_REFERENCE'), `MISMATCH_NOT_EXPLICIT_${row.ticker}`);
}

function expectedDecisionTier(score, coveragePct) {
  if (finite(score) === null || finite(coveragePct) === null || coveragePct < decisionPolicy.minimumEvidenceCoverageForTierPct) return 'UNRATED_INSUFFICIENT_EVIDENCE';
  if (score >= decisionPolicy.tierThresholds.RESEARCH_A) return 'RESEARCH_A';
  if (score >= decisionPolicy.tierThresholds.RESEARCH_B) return 'RESEARCH_B';
  if (score >= decisionPolicy.tierThresholds.RESEARCH_C) return 'RESEARCH_C';
  return 'RESEARCH_D';
}

for (const profile of profiles.profiles || []) {
  check(profile.opportunity?.scoreIsConfidence === false, `SCORE_CONFIDENCE_MIXED_${profile.ticker}`);
  check(profile.confidence?.dimensionsAreIndependent === true, `CONFIDENCE_DIMENSIONS_MIXED_${profile.ticker}`);
  check(['CURRENT_POINT_IN_TIME_READY','HISTORICAL_CONTEXT_ONLY','INSUFFICIENT_TRUSTED_HISTORY','UNAVAILABLE'].includes(profile.technicalAnalysis?.status), `TECHNICAL_STATUS_UNEXPECTED_${profile.ticker}`);
  if (profile.technicalAnalysis?.usedForCurrentDecision === true) {
    check(profile.technicalAnalysis?.currentTechnicalReady === true, `UNREADY_TECHNICAL_USED_FOR_CURRENT_DECISION_${profile.ticker}`);
    check(profile.technicalAnalysis?.asOfSession === current.sessionDate, `TECHNICAL_ASOF_SESSION_MISMATCH_${profile.ticker}`);
    check(profile.whyThisStock?.technicalEvidenceUsed === true, `TECHNICAL_USAGE_NOT_DISCLOSED_${profile.ticker}`);
  } else {
    check(profile.whyThisStock?.technicalEvidenceUsed !== true, `STALE_TECHNICAL_STRENGTH_LEAK_${profile.ticker}`);
    check(!(profile.whyThisStock?.strengths || []).some(x => String(x).startsWith('CURRENT_TRUSTED_TECHNICAL_') || String(x).startsWith('CURRENT_RSI_')), `STALE_TECHNICAL_STRENGTH_${profile.ticker}`);
  }
  check(profile.sectorContext?.sector === null, `UNVERIFIED_SECTOR_INFERRED_${profile.ticker}`);

  const di = profile.decisionIntelligence;
  check(Boolean(di), `DECISION_INTELLIGENCE_MISSING_${profile.ticker}`);
  if (!di) continue;
  check(di.scoreIsConfidence === false, `DECISION_SCORE_CONFIDENCE_MIX_${profile.ticker}`);
  check(di.calibrationStatus === 'UNVALIDATED_RESEARCH_HEURISTIC_REQUIRES_FORWARD_AND_INDEPENDENT_HOLDOUT', `DECISION_CALIBRATION_LABEL_DRIFT_${profile.ticker}`);
  check(di.execution?.permissionSource === 'data/v17/resilient-session-status.json', `DECISION_EXECUTION_SOURCE_DRIFT_${profile.ticker}`);
  check(di.execution?.issuedStatus === profile.status, `DECISION_ISSUED_STATUS_MUTATED_${profile.ticker}`);
  check(di.execution?.scoreMayOpenExecutionGate === false, `DECISION_GATE_LEAK_${profile.ticker}`);
  check(di.execution?.scoreMayCreateActionableStatus === false, `DECISION_ACTIONABLE_LEAK_${profile.ticker}`);
  check(di.execution?.scoreMayChangePositionWeight === false, `DECISION_WEIGHT_LEAK_${profile.ticker}`);
  check(di.confidenceSeparation?.marketConfidencePct === profile.confidence?.marketConfidencePct, `DECISION_MARKET_CONFIDENCE_CHANGED_${profile.ticker}`);
  check(di.confidenceSeparation?.dataConfidencePct === profile.confidence?.dataConfidencePct, `DECISION_DATA_CONFIDENCE_CHANGED_${profile.ticker}`);
  check(di.confidenceSeparation?.modelConfidencePct === profile.confidence?.modelConfidencePct, `DECISION_MODEL_CONFIDENCE_CHANGED_${profile.ticker}`);
  check(di.confidenceSeparation?.executionConfidencePct === profile.confidence?.executionConfidencePct, `DECISION_EXECUTION_CONFIDENCE_CHANGED_${profile.ticker}`);
  check(di.confidenceSeparation?.copiedFromStockProfileWithoutScoreInference === true, `DECISION_CONFIDENCE_COPY_CONTRACT_MISSING_${profile.ticker}`);
  check(expectedDecisionTier(di.researchDecisionScore, di.scoreEvidenceCoveragePct) === di.researchTier, `DECISION_TIER_NONDETERMINISTIC_${profile.ticker}`);
  check(finite(di.scoreEvidenceCoveragePct) !== null && di.scoreEvidenceCoveragePct >= 0 && di.scoreEvidenceCoveragePct <= 100, `DECISION_EVIDENCE_COVERAGE_INVALID_${profile.ticker}`);
  check(finite(di.researchDecisionScore) === null || (di.researchDecisionScore >= 0 && di.researchDecisionScore <= 100), `DECISION_SCORE_RANGE_INVALID_${profile.ticker}`);
  for (const key of decisionKeys) {
    const comp = di.components?.[key];
    check(Boolean(comp), `DECISION_COMPONENT_MISSING_${profile.ticker}_${key}`);
    if (!comp) continue;
    check(typeof comp.provenance === 'string' && comp.provenance.length > 0, `DECISION_COMPONENT_PROVENANCE_MISSING_${profile.ticker}_${key}`);
    if (comp.available === false) check(comp.score === null, `DECISION_UNAVAILABLE_COMPONENT_SCORED_${profile.ticker}_${key}`);
    if (comp.available === true) check(finite(comp.score) !== null && comp.score >= 0 && comp.score <= 100, `DECISION_COMPONENT_SCORE_INVALID_${profile.ticker}_${key}`);
  }
  if (profile.technicalAnalysis?.currentTechnicalReady !== true || profile.technicalAnalysis?.usedForCurrentDecision !== true) {
    check(di.components?.currentTechnical?.available === false, `DECISION_STALE_TECHNICAL_SCORED_${profile.ticker}`);
    check(di.components?.currentTechnical?.score === null, `DECISION_STALE_TECHNICAL_SCORE_POPULATED_${profile.ticker}`);
  }
  const alignmentState = String(profile.tradePlan?.alignment?.state || '');
  const blockers = profile.whyThisStock?.blockers || [];
  if (alignmentState.startsWith('REBUILD_REQUIRED') || alignmentState === 'INVALID_PLAN_RELATION') check(di.researchDecisionScore <= decisionPolicy.defensiveCaps.invalidOrRebuildRequiredTradePlanMaxScore, `DECISION_INVALID_PLAN_SCORE_NOT_CAPPED_${profile.ticker}`);
  if (blockers.includes('CRITICAL_SOURCE_CONFLICT')) check(di.researchDecisionScore <= decisionPolicy.defensiveCaps.criticalSourceConflictMaxScore, `DECISION_CONFLICT_SCORE_NOT_CAPPED_${profile.ticker}`);
  if (blockers.includes('MISSING_CRITICAL_SYMBOL_EVIDENCE')) check(di.researchDecisionScore <= decisionPolicy.defensiveCaps.missingCriticalEvidenceMaxScore, `DECISION_MISSING_EVIDENCE_SCORE_NOT_CAPPED_${profile.ticker}`);
  if (alignmentState === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') check(di.researchDecisionScore <= decisionPolicy.defensiveCaps.aboveEntryRangeDoNotChaseMaxScore, `DECISION_DO_NOT_CHASE_SCORE_NOT_CAPPED_${profile.ticker}`);
  check(typeof di.decisionNarrativeAr === 'string' && di.decisionNarrativeAr.includes('ليست Confidence ولا Execution Permission'), `DECISION_NARRATIVE_SEPARATION_MISSING_${profile.ticker}`);
}

const sortedDecision = [...(profiles.profiles || [])]
  .sort((a, b) => (finite(b.decisionIntelligence?.researchDecisionScore) ?? -1) - (finite(a.decisionIntelligence?.researchDecisionScore) ?? -1) || a.rank - b.rank);
check(sortedDecision.every((profile, index) => profiles.researchDecisionRanking?.[index]?.ticker === profile.ticker), 'DECISION_RESEARCH_RANKING_ORDER_DRIFT');

const immutableCore = {
  schemaVersion: '20.0.0-immutable-signal-core-1',
  sessionDate: current.sessionDate,
  activeChampion: current.governance?.activeChampion || null,
  executionStatus: current.executionStatus,
  decisionSupportOnly: current.decisionSupportOnly === true,
  portfolio: {
    riskState: current.portfolio?.riskState || null,
    recommendedExposurePct: finite(current.portfolio?.recommendedExposurePct) || 0,
    cashPct: finite(current.portfolio?.cashPct) || 100,
  },
  opportunities: (current.opportunities || []).map(row => ({
    ticker: row.ticker,
    status: row.status,
    entryLow: finite(row.tradePlan?.entryLow),
    entryHigh: finite(row.tradePlan?.entryHigh),
    stop: finite(row.tradePlan?.stop),
    target1: finite(row.tradePlan?.target1),
    target2: finite(row.tradePlan?.target2),
    positionWeightPct: finite(row.suggestedPositionWeightPct) || 0,
  })),
};
const expectedHash = sha(immutableCore);
const archiveEntry = (archiveIndex.entries || []).find(entry => entry.immutableSignalHash === expectedHash);
check(Boolean(archiveEntry), 'CURRENT_SIGNAL_NOT_ARCHIVED');
if (archiveEntry) {
  const archived = read(archiveEntry.file);
  check(archived.immutableSignalHash === expectedHash, 'ARCHIVE_HASH_MISMATCH');
  check(JSON.stringify(archived.immutableCore) === JSON.stringify(immutableCore), 'ARCHIVE_CORE_MISMATCH');
}

check(forward.schemaVersion === '20.0.0-forward-evaluation-3', 'FORWARD_AUTHORITATIVE_SCHEMA_NOT_V3');
check(forward.asOfSessionDate === current.sessionDate, 'FORWARD_AUTHORITATIVE_ASOF_MISMATCH');
check(forward.authoritativeEvidence?.file === 'data/v20/forward-evaluation.json', 'FORWARD_AUTHORITATIVE_FILE_NOT_DECLARED');
check(forward.authoritativeEvidence?.selfContainedStatus === true, 'FORWARD_EMBEDDED_STATUS_NOT_REQUIRED');
check(forward.authoritativeEvidence?.selfContainedRegression === true, 'FORWARD_EMBEDDED_REGRESSION_NOT_REQUIRED');
check(forward.authoritativeEvidence?.derivedSidecarsAreAuthoritative === false, 'FORWARD_SIDECARS_MISTAKENLY_AUTHORITATIVE');
check(forward.resolutionStatus?.schemaVersion === '20.0.0-forward-resolution-status-2', 'FORWARD_EMBEDDED_STATUS_MISSING');
check(forward.resolutionStatus?.asOfSessionDate === forward.asOfSessionDate, 'FORWARD_STATUS_ASOF_MISMATCH');
check(forward.evaluationRegression?.schemaVersion === '20.0.0-forward-evaluation-regression-2', 'FORWARD_EMBEDDED_REGRESSION_MISSING');
check(forward.evaluationRegression?.ok === true, 'FORWARD_EMBEDDED_REGRESSION_FAILED');
check(forward.evaluationRegression?.authoritativeFile === 'data/v20/forward-evaluation.json', 'FORWARD_REGRESSION_AUTHORITY_DRIFT');
check(forward.evaluationRegression?.evidence?.fabricatedSameSessionResolutionCount === 0, 'FORWARD_SAME_SESSION_FABRICATION_DETECTED');

const evaluations = forward.evaluations || [];
check(forward.resolutionStatus?.evaluationCount === evaluations.length, 'FORWARD_STATUS_COUNT_MISMATCH');
check(forward.resolutionStatus?.resolvedCount === evaluations.filter(x => x.status === 'RESOLVED').length, 'FORWARD_STATUS_RESOLVED_MISMATCH');
check(forward.resolutionStatus?.pendingCount === evaluations.filter(x => x.status === 'PENDING').length, 'FORWARD_STATUS_PENDING_MISMATCH');
check(forward.evaluationRegression?.evidence?.evaluationCount === evaluations.length, 'FORWARD_REGRESSION_COUNT_MISMATCH');
check(forward.evaluationRegression?.evidence?.resolvedCount === evaluations.filter(x => x.status === 'RESOLVED').length, 'FORWARD_REGRESSION_RESOLVED_MISMATCH');
check(forward.evaluationRegression?.evidence?.pendingCount === evaluations.filter(x => x.status === 'PENDING').length, 'FORWARD_REGRESSION_PENDING_MISMATCH');

const currentForward = evaluations.filter(x => x.immutableSignalHash === expectedHash);
for (const horizon of [1, 3, 5, 10, 20]) {
  const item = currentForward.find(x => x.horizonSessions === horizon);
  check(Boolean(item), `MISSING_FORWARD_HORIZON_${horizon}`);
  if (item) {
    check(['PENDING', 'RESOLVED'].includes(item.status), `INVALID_FORWARD_STATUS_${horizon}`);
    if (item.status === 'PENDING') {
      check(item.evaluationSessionDate === null, `FABRICATED_PENDING_FORWARD_DATE_${horizon}`);
      check(item.portfolioReturnGrossPct === null && item.portfolioReturnNetPct === null, `FABRICATED_PENDING_FORWARD_RETURN_${horizon}`);
      check(item.appliedPortfolio?.grossReturnPct === null && item.appliedPortfolio?.netReturnPct === null, `FABRICATED_PENDING_APPLIED_RETURN_${horizon}`);
      check(item.researchEvaluation?.equalWeightIssuedGrossReturnPct === null && item.researchEvaluation?.equalWeightIssuedNetReturnPct === null, `FABRICATED_PENDING_RESEARCH_RETURN_${horizon}`);
    } else {
      check(item.researchEvaluation?.appliedToProduction === false, `RESEARCH_FORWARD_APPLIED_TO_PRODUCTION_${horizon}`);
      check(item.portfolioReturnNetPct === item.appliedPortfolio?.netReturnPct, `FORWARD_APPLIED_RETURN_SEMANTICS_DRIFT_${horizon}`);
    }
  }
}

if (current.executionStatus !== 'EXECUTION_GRADE') {
  check((profiles.profiles || []).every(p => p.status !== 'ACTIONABLE'), 'DECISION_INTELLIGENCE_CREATED_ACTIONABLE_WHILE_GATE_CLOSED');
  check(current.portfolio?.recommendedExposurePct === 0, 'DECISION_INTELLIGENCE_CHANGED_CLOSED_GATE_EXPOSURE');
}
check(current.governance?.activeChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'DECISION_INTELLIGENCE_CHANGED_CHAMPION');
check(current.governance?.automaticPromotion === false && current.governance?.promotionAllowed === false, 'DECISION_INTELLIGENCE_CHANGED_PROMOTION_GOVERNANCE');

const report = {
  schemaVersion: '20.0.0-phase3-regression-4',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    conservativeNetRiskRewardPrimary: true,
    legacyRiskRewardAuditOnly: true,
    technicalIndicatorsRequirePointInTimeTrust: true,
    staleTechnicalCannotDriveCurrentDecision: true,
    scoreConfidenceSeparated: true,
    decisionIntelligenceResearchOnly: true,
    decisionIntelligenceDeterministicTiers: true,
    decisionIntelligenceDefensiveCaps: true,
    decisionIntelligenceComponentProvenance: true,
    decisionIntelligenceModelConfidenceNotInferred: true,
    decisionIntelligenceExecutionPermissionSeparated: true,
    decisionIntelligenceChampionGovernancePreserved: true,
    immutableSignalArchive: true,
    forwardHorizonsSeparated: true,
    forwardEvidenceSelfContained: true,
    forwardDerivedSidecarsNonAuthoritative: true,
    forwardSameSessionFabricationBlocked: true,
    forwardResearchProductionSeparation: true,
  },
};

fs.writeFileSync(P('data/v20/phase3-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
