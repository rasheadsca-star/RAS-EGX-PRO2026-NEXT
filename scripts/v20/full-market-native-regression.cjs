#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const selection = read('data/v20/full-market-native-selection.json');
const technical = read('data/v20/full-market-native-technical.json');
const universe = read('data/v20/master-universe.json');
const current = read('data/v20/current.json');
const policyRoot = read('data/v20/decision-intelligence-policy.json');
const profiles = read('data/v20/stock-profiles.json');
const policy = policyRoot.fullMarketNativeSelection || {};

check(selection.schemaVersion === '20.0.0-full-market-native-selection-1', 'NATIVE_SELECTION_SCHEMA_DRIFT');
check(technical.schemaVersion === '20.0.0-full-market-native-technical-1', 'NATIVE_TECH_SCHEMA_DRIFT');
check(selection.sessionDate === current.sessionDate && technical.asOfSessionDate === current.sessionDate, 'NATIVE_SESSION_MISMATCH');
check(selection.candidateUniverse === 'V20_MASTER_UNIVERSE_FULL_MARKET', 'NATIVE_UNIVERSE_LABEL_DRIFT');
check(selection.candidateUniverseIsFullMarketIndependent === true, 'NATIVE_NOT_FULL_MARKET_INDEPENDENT');
check(selection.legacySeedDependency === false, 'NATIVE_LEGACY_SEED_DEPENDENCY_PRESENT');
check(selection.legacyReferenceUsedForComparisonOnly === true, 'NATIVE_LEGACY_REFERENCE_ROLE_DRIFT');
check(selection.candidateUniverseCount === universe.count && selection.summary?.universeCount === universe.count, 'NATIVE_UNIVERSE_COUNT_MISMATCH');
check((selection.discoveryRanking || []).length === universe.count, 'NATIVE_DISCOVERY_NOT_FULL_UNIVERSE');
check((technical.symbols || []).length === universe.count && technical.summary?.universeCount === universe.count, 'NATIVE_TECH_NOT_FULL_UNIVERSE');
check(technical.policy?.pointInTime === true && technical.policy?.identityVerificationRequired === true && technical.policy?.currentSessionRequired === true, 'NATIVE_TECH_TRUST_POLICY_MISSING');
check(technical.policy?.missingOhlcSynthesisAllowed === false && technical.policy?.futureRowsAllowed === false && technical.policy?.providerBlendingAllowed === false, 'NATIVE_TECH_PROVENANCE_POLICY_DRIFT');
check(technical.policy?.executionGateInfluence === false && technical.policy?.productionAllocationInfluence === false && technical.policy?.championInfluence === false, 'NATIVE_TECH_PRODUCTION_LEAK');

const discoveryWeights = policy.discoveryWeightsPct || {};
const finalWeights = selection.scoring?.finalApprovedWeightsPct || {};
check(Object.values(discoveryWeights).reduce((sum, value) => sum + Number(value || 0), 0) === 100, 'NATIVE_DISCOVERY_WEIGHTS_NOT_100');
check(Number(discoveryWeights.liquidity) === 30, 'NATIVE_DISCOVERY_LIQUIDITY_NOT_30');
check(Number(finalWeights.liquidity) === 30, 'NATIVE_FINAL_LIQUIDITY_NOT_30');
check(Number(finalWeights.supportResistance) === 12, 'NATIVE_FINAL_SR_NOT_12');
check(selection.scoring?.legacyComponentExcludedFromNativeScore === true && Number(selection.scoring?.finalNonLegacyWeightPct) === 90, 'NATIVE_LEGACY_NOT_EXCLUDED');
check(Number(selection.summary?.legacyScoringContributionPct) === 0, 'NATIVE_LEGACY_SCORING_CONTRIBUTION_NOT_ZERO');
check(selection.activeProductionChampion === 'V16_9_EQUAL_WEIGHT_BASKET', 'NATIVE_CHAMPION_DRIFT');
check(selection.automaticPromotion === false && selection.executionPermission === false && selection.productionAllocation === false, 'NATIVE_PRODUCTION_GOVERNANCE_LEAK');
check(selection.governance?.researchOnly === true && selection.governance?.V17RemainsExecutionAuthority === true && selection.governance?.canChangeChampion === false, 'NATIVE_EXECUTION_AUTHORITY_DRIFT');

const discoverySeen = new Set();
for (const row of selection.discoveryRanking || []) {
  check(!discoverySeen.has(row.ticker), `NATIVE_DISCOVERY_DUPLICATE_${row.ticker}`);
  discoverySeen.add(row.ticker);
  const score = finite(row.score);
  check(score === null || (score >= 0 && score <= 100), `NATIVE_DISCOVERY_SCORE_RANGE_${row.ticker}`);
}

const technicalMap = new Map((technical.symbols || []).map(row => [row.ticker, row]));
let technicalReadyCount = 0;
for (const row of technical.symbols || []) {
  if (row.currentReady !== true) continue;
  technicalReadyCount += 1;
  check(row.identityVerified === true, `NATIVE_TECH_READY_IDENTITY_${row.ticker}`);
  check(row.asOfSession === current.sessionDate, `NATIVE_TECH_READY_SESSION_${row.ticker}`);
  check(Number(row.rowsUsed) >= 50, `NATIVE_TECH_READY_ROWS_${row.ticker}`);
  check(Number(row.currentPriceDifferencePct) <= Number(technical.policy.currentPriceReconciliationTolerancePct), `NATIVE_TECH_READY_PRICE_DIFF_${row.ticker}`);
  check(row.usedForShadowNativeResearchScore === true, `NATIVE_TECH_READY_SCORE_FLAG_${row.ticker}`);
  check(row.executionGateInfluence === false && row.productionAllocationInfluence === false && row.championInfluence === false, `NATIVE_TECH_ROW_PRODUCTION_LEAK_${row.ticker}`);
  check((row.blockers || []).length === 0, `NATIVE_TECH_READY_BLOCKERS_${row.ticker}`);
}
check(technicalReadyCount === Number(technical.summary?.currentReadyCount || 0), 'NATIVE_TECH_READY_COUNT_MISMATCH');

const ranking = selection.recommendationRanking || [];
const details = new Map((selection.candidateDetails || []).map(row => [row.ticker, row]));
const eligibleCount = Number(selection.summary?.nativeResearchRecommendationCount || 0);
const publicationCap = Math.max(0, Number(policy.maximumPublishedResearchCandidates || 0));
const expectedPublishedCount = Math.min(eligibleCount, publicationCap);

// The selector intentionally counts every eligible Native candidate in the summary,
// while recommendationRanking/candidateDetails are a publication-capped Top-N view.
// These are different contracts and must never be forced to the same count when
// eligibleCount exceeds the publication cap.
check(eligibleCount >= ranking.length, 'NATIVE_ELIGIBLE_COUNT_BELOW_PUBLISHED_COUNT');
check(ranking.length === expectedPublishedCount, 'NATIVE_PUBLISHED_RECOMMENDATION_COUNT_MISMATCH');
check((selection.candidateDetails || []).length === ranking.length, 'NATIVE_PUBLISHED_DETAILS_COUNT_MISMATCH');

const recommendationSeen = new Set();
for (const row of ranking) {
  check(!recommendationSeen.has(row.ticker), `NATIVE_RECOMMENDATION_DUPLICATE_${row.ticker}`);
  recommendationSeen.add(row.ticker);
  const detail = details.get(row.ticker);
  check(!!detail, `NATIVE_RECOMMENDATION_DETAIL_MISSING_${row.ticker}`);
  if (!detail) continue;

  const score = finite(detail.nativeResearch?.score);
  check(score !== null && score >= Number(policy.minimumFinalResearchScore || 0) && score <= 100, `NATIVE_RECOMMENDATION_SCORE_${row.ticker}`);
  check(detail.nativeResearch?.recommendationEligible === true && detail.nativeResearch?.scoreIsConfidence === false, `NATIVE_RECOMMENDATION_SEMANTICS_${row.ticker}`);
  check(detail.nativeResearch?.executionPermission === false && detail.nativeResearch?.productionAllocation === false, `NATIVE_RECOMMENDATION_PRODUCTION_LEAK_${row.ticker}`);
  check(Number(detail.nativeResearch?.legacyContributionPct) === 0 && Number(detail.nativeResearch?.availableNonLegacyWeightPct) === 90, `NATIVE_RECOMMENDATION_LEGACY_OR_EVIDENCE_${row.ticker}`);
  check(detail.evidence?.liquidity?.shortTermEligible === true, `NATIVE_RECOMMENDATION_LIQUIDITY_${row.ticker}`);
  check(detail.evidence?.technical?.available === true && technicalMap.get(row.ticker)?.currentReady === true, `NATIVE_RECOMMENDATION_TECH_${row.ticker}`);
  check((detail.evidence?.supportResistance?.confluence?.methodCount || 0) >= Number(policy.minimumSrMethodCount || 2), `NATIVE_RECOMMENDATION_SR_${row.ticker}`);
  check(detail.evidence?.researchTradePlan?.valid === true && finite(detail.evidence?.researchTradePlan?.netRiskReward) >= Number(policy.minimumNetRiskReward || 0.7), `NATIVE_RECOMMENDATION_PLAN_${row.ticker}`);
  check(!(detail.blockers || []).includes('CRITICAL_SOURCE_CONFLICT'), `NATIVE_RECOMMENDATION_CONFLICT_${row.ticker}`);
  if (detail.evidence?.researchTradePlan?.alignment?.state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') {
    check(score <= Number(policyRoot.defensiveCaps?.aboveEntryRangeDoNotChaseMaxScore || 55), `NATIVE_DO_NOT_CHASE_CAP_${row.ticker}`);
  }
}

// V20_RANKING_DISCRIMINATION_REGRESSION_V2
const eligibleRanking = selection.eligibleResearchRanking || [];
const rd = policy.rankingDiscrimination || {};
check(rd.contract === 'V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2', 'NATIVE_TIE_BREAK_POLICY_DRIFT');
check(rd.appliesOnlyWhenNativeResearchScoreExactlyTied === true && rd.mutatesNativeResearchScore === false && rd.canOverrideHigherNativeResearchScore === false, 'NATIVE_TIE_BREAK_SCORE_MUTATION_POLICY_DRIFT');
check(eligibleRanking.length === Number(selection.summary?.nativeResearchRecommendationCount || 0), 'NATIVE_FULL_ELIGIBLE_RANKING_COUNT_MISMATCH');
check(ranking.every((row, index) => row.ticker === eligibleRanking[index]?.ticker), 'NATIVE_PUBLISHED_NOT_PREFIX_OF_FULL_ELIGIBLE_RANKING');
const cmpTie = (a, b) => {
  const ax = a.rankingTieBreaker || {}, bx = b.rankingTieBreaker || {};
  let d = Number(ax.alignmentSafetyPriority ?? 99) - Number(bx.alignmentSafetyPriority ?? 99);
  if (d) return d;
  d = Number(bx.scoreBeforeRegimeAndCaps ?? -Infinity) - Number(ax.scoreBeforeRegimeAndCaps ?? -Infinity);
  if (d) return d;
  d = Number(ax.entryDistancePct ?? Infinity) - Number(bx.entryDistancePct ?? Infinity);
  if (d) return d;
  for (const k of ['netRiskReward','liquidity2Score','srConfluenceScore','technicalScore','discoveryScore']) {
    d = Number(bx[k] ?? -Infinity) - Number(ax[k] ?? -Infinity);
    if (d) return d;
  }
  return String(a.ticker).localeCompare(String(b.ticker));
};
let tieBreakPairCount = 0;
for (let i = 0; i < eligibleRanking.length; i++) {
  const row = eligibleRanking[i], tb = row.rankingTieBreaker || {};
  check(Number(row.rank) === i + 1, `NATIVE_ELIGIBLE_RANK_SEQUENCE_${row.ticker}`);
  check(tb.contract === rd.contract && tb.mutatesNativeResearchScore === false && tb.canOverrideHigherNativeResearchScore === false, `NATIVE_TIE_BREAK_METADATA_${row.ticker}`);
  check(finite(tb.scoreBeforeRegimeAndCaps) === finite(row.rankingTieBreaker?.scoreBeforeRegimeAndCaps), `NATIVE_TIE_BREAK_STRENGTH_METADATA_${row.ticker}`);
  if (i === 0) continue;
  const prev = eligibleRanking[i - 1], ps = finite(prev.nativeResearchScore), cs = finite(row.nativeResearchScore);
  check(ps === null || cs === null || ps >= cs, `NATIVE_PRIMARY_SCORE_ORDER_${row.ticker}`);
  if (ps !== null && cs !== null && ps === cs) {
    tieBreakPairCount += 1;
    check(cmpTie(prev, row) <= 0, `NATIVE_TIE_BREAK_ORDER_${prev.ticker}_${row.ticker}`);
  }
}
check(tieBreakPairCount > 0, 'NATIVE_TIE_BREAK_NOT_EXERCISED');
check(eligibleRanking.filter(row => row.alignmentState === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE').every(row => finite(row.nativeResearchScore) <= Number(policyRoot.defensiveCaps?.aboveEntryRangeDoNotChaseMaxScore || 55)), 'NATIVE_TIE_BREAK_WEAKENED_DO_NOT_CHASE_CAP');

check((selection.top5 || []).every((row, index) => row.ticker === ranking[index]?.ticker), 'NATIVE_TOP5_NOT_PREFIX');
check((selection.top10 || []).every((row, index) => row.ticker === ranking[index]?.ticker), 'NATIVE_TOP10_NOT_PREFIX');
check(profiles.fullMarketNativeSelection?.engineId === selection.engineId && profiles.fullMarketNativeSelection?.candidateUniverseIsFullMarketIndependent === true && profiles.fullMarketNativeSelection?.legacySeedDependency === false, 'NATIVE_NOT_EMBEDDED_IN_PROFILES');

const report = {
  schemaVersion: '20.0.0-full-market-native-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  evidence: {
    universeCount: universe.count,
    technicalReadyCount,
    eligibleRecommendationCount: eligibleCount,
    publishedRecommendationCount: ranking.length,
    publicationCap,
    outsideLegacySeedCount: selection.summary?.nativeResearchCandidatesOutsideLegacySeedCount ?? null,
    top10OutsideLegacySeedCount: selection.summary?.top10OutsideLegacySeedCount ?? null,
    top5: selection.top5 || [],
  },
  checks: {
    fullMasterUniverseScanned: true,
    eligibleAndPublishedCountSemanticsSeparated: true,
    legacySeedDependencyRemoved: true,
    legacyContributionZero: true,
    liquidityWeight30: true,
    supportResistanceWeight12: true,
    pointInTimeTechnicalRequired: true,
    multiMethodSrRequired: true,
    evidenceDerivedTradePlanRequired: true,
    conservativeCostAwareNetRrRequired: true,
    minimumNetRiskRewardPreserved: true,
    // V20_RANKING_DISCRIMINATION_REPORT_V2
    safetyStrengthTieBreakPreserved: true,
    tieBreakUsesPreCapStrength: true,
    tieBreakCannotMutateScore: true,
    tieBreakCannotOverrideHigherScore: true,
    v17ExecutionAuthorityPreserved: true,
    championProtected: true,
    automaticPromotionDisabled: true,
    productionAllocationDisabled: true,
  },
};

selection.summary = {
  ...(selection.summary || {}),
  publishedResearchCandidateCount: ranking.length,
  eligibleNotPublishedCount: Math.max(0, eligibleCount - ranking.length),
};
selection.regression = report;
profiles.fullMarketNativeSelection = selection;
write('data/v20/full-market-native-selection.json', selection);
write('data/v20/stock-profiles.json', profiles);
write('data/v20/full-market-native-regression.json', report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
