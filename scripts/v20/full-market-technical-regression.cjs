#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const evidence = read('data/v20/full-market-technical.json');
const universe = read('data/v20/master-universe.json');
const current = read('data/v20/current.json');
const profiles = read('data/v20/stock-profiles.json');
const decisionTechnical = read('data/v20/technical-indicators.json');

check(evidence.schemaVersion === '20.0.0-full-market-technical-2', 'FULL_TECH_SCHEMA_DRIFT');
check(evidence.asOfSessionDate === current.sessionDate, 'FULL_TECH_SESSION_MISMATCH');
check(evidence.policy?.pointInTime === true, 'FULL_TECH_POINT_IN_TIME_MISSING');
check(evidence.policy?.identityVerificationRequired === true, 'FULL_TECH_IDENTITY_REQUIREMENT_MISSING');
check(evidence.policy?.currentSessionRequired === true, 'FULL_TECH_CURRENT_SESSION_REQUIREMENT_MISSING');
check(evidence.policy?.missingOhlcSynthesisAllowed === false, 'FULL_TECH_SYNTHETIC_OHLC_ALLOWED');
check(evidence.policy?.futureRowsAllowed === false, 'FULL_TECH_FUTURE_ROWS_ALLOWED');
check(evidence.policy?.primaryProvider === 'YAHOO', 'FULL_TECH_PRIMARY_PROVIDER_DRIFT');
check(evidence.policy?.secondaryProvider === 'STARTA', 'FULL_TECH_SECONDARY_PROVIDER_DRIFT');
check(evidence.policy?.secondaryProviderResearchOnly === true, 'FULL_TECH_STARTA_ROLE_OVERSTATED');
check(evidence.policy?.providerBlendingAllowed === false, 'FULL_TECH_PROVIDER_BLENDING_ALLOWED');
check(evidence.policy?.usedForDecisionScore === false && evidence.policy?.usedForExecutionGate === false && evidence.policy?.usedForProductionAllocation === false, 'FULL_TECH_PRODUCTION_LEAK');
check((evidence.symbols || []).length === universe.count, 'FULL_TECH_UNIVERSE_COUNT_MISMATCH');

let ready = 0, yahooReady = 0, startaReady = 0, cachedReady = 0;
const seen = new Set(), allowedReadySources = new Set(['LIVE_YAHOO_REFRESH','LIVE_STARTA_SECONDARY_REFRESH','CACHED_VERIFIED_HISTORY_DOCUMENT']);
for (const row of evidence.symbols || []) {
  check(!seen.has(row.ticker), `FULL_TECH_DUPLICATE_${row.ticker}`); seen.add(row.ticker);
  check(row.decisionUse === 'MARKET_TECHNICAL_EVIDENCE_ONLY_NOT_SCORE_EXECUTION_OR_ALLOCATION', `FULL_TECH_DECISION_USE_LABEL_DRIFT_${row.ticker}`);
  check(row.usedForDecisionScore !== true, `FULL_TECH_SCORE_LEAK_${row.ticker}`);
  check(row.usedForExecutionGate !== true, `FULL_TECH_EXECUTION_LEAK_${row.ticker}`);
  check(row.usedForProductionAllocation !== true, `FULL_TECH_ALLOCATION_LEAK_${row.ticker}`);
  check(row.providerBlended === false, `FULL_TECH_PROVIDER_BLEND_${row.ticker}`);
  check(Number(row.futureRowsRejected || 0) >= 0, `FULL_TECH_FUTURE_REJECT_COUNT_INVALID_${row.ticker}`);
  if (row.currentReady === true) {
    ready += 1;
    check(allowedReadySources.has(row.sourceKind), `FULL_TECH_READY_SOURCE_KIND_INVALID_${row.ticker}`);
    check(row.identityVerified === true, `FULL_TECH_READY_IDENTITY_UNVERIFIED_${row.ticker}`);
    check(row.asOfSession === current.sessionDate, `FULL_TECH_READY_SESSION_MISMATCH_${row.ticker}`);
    check(Number(row.rowsUsed) >= 50, `FULL_TECH_READY_ROWS_LT50_${row.ticker}`);
    check(Number(row.currentPriceDifferencePct) <= Number(evidence.policy.currentPriceReconciliationTolerancePct), `FULL_TECH_READY_PRICE_DIFF_${row.ticker}`);
    for (const key of ['sma20','sma50','ema12','ema26','rsi14','macd','macdSignal','atr14','momentum5Pct','momentum20Pct']) check(Number.isFinite(Number(row.indicators?.[key])), `FULL_TECH_READY_INDICATOR_MISSING_${row.ticker}_${key}`);
    check((row.blockers || []).length === 0, `FULL_TECH_READY_HAS_BLOCKERS_${row.ticker}`);
    if (row.sourceKind === 'LIVE_YAHOO_REFRESH') { yahooReady += 1; check(row.providerRole === 'PRIMARY_PUBLIC_RESEARCH_PROVIDER', `FULL_TECH_YAHOO_ROLE_DRIFT_${row.ticker}`); }
    if (row.sourceKind === 'LIVE_STARTA_SECONDARY_REFRESH') { startaReady += 1; check(row.providerRole === 'SECONDARY_NON_OFFICIAL_RESEARCH_ONLY', `FULL_TECH_STARTA_ROLE_DRIFT_${row.ticker}`); check(row.source === 'starta_ohlc_api', `FULL_TECH_STARTA_SOURCE_DRIFT_${row.ticker}`); check((row.attempts || []).some(a => a.source === 'starta_live' && a.ok === true), `FULL_TECH_STARTA_READY_WITHOUT_FETCH_${row.ticker}`); }
    if (row.sourceKind === 'CACHED_VERIFIED_HISTORY_DOCUMENT') cachedReady += 1;
  }
}
check(ready === evidence.summary?.currentReadyCount, 'FULL_TECH_READY_COUNT_MISMATCH');
check(evidence.summary?.currentReadyCoveragePct === Math.round(ready / universe.count * 10000) / 100, 'FULL_TECH_COVERAGE_MISMATCH');
check(yahooReady === evidence.summary?.liveYahooReadyCount, 'FULL_TECH_YAHOO_READY_COUNT_MISMATCH');
check(startaReady === evidence.summary?.liveStartaReadyCount, 'FULL_TECH_STARTA_READY_COUNT_MISMATCH');
check(cachedReady === evidence.summary?.cachedReadyCount, 'FULL_TECH_CACHED_READY_COUNT_MISMATCH');
check(Number(evidence.summary?.startaAttemptCount || 0) >= startaReady, 'FULL_TECH_STARTA_READY_EXCEEDS_ATTEMPTS');
check(Number(evidence.summary?.startaFetchSuccessCount || 0) >= startaReady, 'FULL_TECH_STARTA_READY_EXCEEDS_FETCH_SUCCESS');
check(Number(evidence.summary?.unavailableCount || 0) === universe.count - ready, 'FULL_TECH_UNAVAILABLE_COUNT_MISMATCH');
check(profiles.technicalIndicatorPolicy === 'POINT_IN_TIME_TRUSTED_OHLC_ONLY_STALE_CONTEXT_NEVER_CURRENT_DECISION', 'FULL_TECH_PROFILE_POLICY_DRIFT');
check(decisionTechnical.indicatorMethodology?.pointInTime === true, 'FULL_TECH_DECISION_PIPELINE_NOT_POINT_IN_TIME');
for (const profile of profiles.profiles || []) if (profile.technicalAnalysis?.usedForCurrentDecision === true) { const source = (decisionTechnical.symbols || []).find(x => x.ticker === profile.ticker); check(source?.usedForCurrentDecision === true && source?.currentTechnicalReady === true, `FULL_TECH_DECISION_PIPELINE_SOURCE_MISSING_${profile.ticker}`); }

function classifyUnresolved(row) {
  const blockers = [...new Set(row.blockers || [])];
  let primaryReviewState = 'OTHER_TECHNICAL_REVIEW_REQUIRED', recommendedAction = 'REVIEW_PROVIDER_EVIDENCE_MANUALLY', historicalProviderCanResolveAlone = false;
  if (blockers.includes('CURRENT_MARKET_PRICE_UNAVAILABLE')) { primaryReviewState = 'INDEPENDENT_CURRENT_MARKET_REFERENCE_REQUIRED'; recommendedAction = 'ACQUIRE_INDEPENDENT_CURRENT_MARKET_REFERENCE_BEFORE_RECONCILIATION'; }
  else if (blockers.includes('LAST_HISTORY_SESSION_NOT_CURRENT')) { primaryReviewState = 'CURRENT_SESSION_OHLC_REQUIRED'; recommendedAction = 'ACQUIRE_CURRENT_SESSION_OHLC_FROM_ACCEPTED_SINGLE_PROVIDER'; historicalProviderCanResolveAlone = true; }
  else if (blockers.includes('LATEST_CLOSE_NOT_RECONCILED_WITH_CURRENT_PRICE')) { primaryReviewState = 'PRICE_REFERENCE_RECONCILIATION_REVIEW'; recommendedAction = 'TRIANGULATE_CURRENT_PRICE_AND_PROVIDER_CLOSE_WITHOUT_CAUSE_INFERENCE'; }
  else if (blockers.includes('INSUFFICIENT_TRUSTED_ROWS_LT_50') || blockers.some(code => code.startsWith('INDICATOR_UNAVAILABLE_'))) { primaryReviewState = 'HISTORY_DEPTH_OR_INDICATOR_EVIDENCE_REQUIRED'; recommendedAction = 'ACQUIRE_LONGER_VERIFIED_HISTORY_FROM_ONE_ACCEPTED_PROVIDER'; historicalProviderCanResolveAlone = true; }
  return { ticker:row.ticker, primaryReviewState, blockers, recommendedAction, historicalProviderCanResolveAlone, currentMarketPrice:row.currentPrice ?? null, latestProviderClose:row.latestClose ?? null, latestHistorySession:row.asOfSession ?? null, rowsUsed:row.rowsUsed ?? 0, currentPriceDifferencePct:row.currentPriceDifferencePct ?? null, selectedProvider:row.sourceKind ?? null, selectedProviderRole:row.providerRole ?? null, providerAttempts:(row.attempts || []).map(a => ({source:a.source ?? null,ok:a.ok===true,sessions:a.sessions ?? null,period:a.period ?? null})), providerCandidates:row.providerCandidates || [], causeVerified:false, corporateActionInferred:false, automaticRepairAllowed:false, automaticTrustUpgradeAllowed:false, usedForDecisionScore:false, usedForExecutionGate:false, usedForProductionAllocation:false };
}
const unresolvedReviewRows = (evidence.symbols || []).filter(row => row.currentReady !== true).map(classifyUnresolved);
const reviewStateCounts = unresolvedReviewRows.reduce((acc,row) => { acc[row.primaryReviewState] = (acc[row.primaryReviewState] || 0) + 1; return acc; }, {});
check(unresolvedReviewRows.length === Number(evidence.summary?.unavailableCount || 0), 'FULL_TECH_REVIEW_UNRESOLVED_COUNT_MISMATCH');
check(unresolvedReviewRows.every(row => row.blockers.length > 0), 'FULL_TECH_REVIEW_ROW_WITHOUT_BLOCKER');
check(unresolvedReviewRows.every(row => row.causeVerified === false && row.corporateActionInferred === false), 'FULL_TECH_REVIEW_CAUSE_INFERENCE_DETECTED');
check(unresolvedReviewRows.every(row => row.automaticRepairAllowed === false && row.automaticTrustUpgradeAllowed === false), 'FULL_TECH_REVIEW_AUTO_REPAIR_OR_TRUST_ALLOWED');
check(unresolvedReviewRows.every(row => row.usedForDecisionScore === false && row.usedForExecutionGate === false && row.usedForProductionAllocation === false), 'FULL_TECH_REVIEW_PRODUCTION_LEAK');
check(unresolvedReviewRows.filter(row => row.primaryReviewState === 'INDEPENDENT_CURRENT_MARKET_REFERENCE_REQUIRED').every(row => row.historicalProviderCanResolveAlone === false), 'FULL_TECH_MARKET_REFERENCE_WRONGLY_RESOLVABLE_BY_HISTORY_ONLY');
check(unresolvedReviewRows.filter(row => row.primaryReviewState === 'PRICE_REFERENCE_RECONCILIATION_REVIEW').every(row => row.historicalProviderCanResolveAlone === false), 'FULL_TECH_PRICE_CONFLICT_WRONGLY_AUTO_RESOLVABLE');
check(Object.values(reviewStateCounts).reduce((a,b) => a + b, 0) === unresolvedReviewRows.length, 'FULL_TECH_REVIEW_STATE_COUNT_MISMATCH');

const report = { schemaVersion:'20.0.0-full-market-technical-regression-5', generatedAt:new Date().toISOString(), ok:failures.length===0, failedCount:failures.length, failures, evidence:{ universeCount:universe.count,currentReadyCount:ready,currentReadyCoveragePct:evidence.summary?.currentReadyCoveragePct,liveYahooReadyCount:yahooReady,liveStartaReadyCount:startaReady,cachedReadyCount:cachedReady,startaAttemptCount:evidence.summary?.startaAttemptCount ?? null,startaFetchSuccessCount:evidence.summary?.startaFetchSuccessCount ?? null,startaFetchFailureCount:evidence.summary?.startaFetchFailureCount ?? null,unresolvedBlockerCounts:evidence.summary?.unresolvedBlockerCounts || {},opportunityProfilesUsingSeparateDecisionTechnical:(profiles.profiles || []).filter(p => p.technicalAnalysis?.usedForCurrentDecision === true).length }, unresolvedReview:{ status:'MANUAL_REVIEW_ROUTING_RESEARCH_ONLY',targetCount:unresolvedReviewRows.length,stateCounts:reviewStateCounts,blockerCountsOverlapAllowed:true,rows:unresolvedReviewRows,policy:{diagnosticOnly:true,causeInferenceAllowed:false,corporateActionInferenceAllowed:false,automaticRepairAllowed:false,automaticTrustUpgradeAllowed:false,usedForDecisionScore:false,usedForExecutionGate:false,usedForProductionAllocation:false}}, checks:{pointInTimeNoLookahead:true,identityRequired:true,currentSessionRequired:true,priceReconciliationRequired:true,noSyntheticOhlc:true,providerBlendingForbidden:true,startaSecondaryEvidenceResearchOnly:true,unresolvedReviewDerivedOnlyFromObservedBlockers:true,unresolvedReviewNeverInfersCorporateAction:true,unresolvedReviewNeverAutoRepairsOrUpgradesTrust:true,fullMarketTechnicalNeverDrivesDecisionScore:true,fullMarketTechnicalNeverDrivesExecutionGate:true,fullMarketTechnicalNeverDrivesProductionAllocation:true,opportunityDecisionTechnicalUsesSeparateAuthoritativePipeline:true} };

fs.writeFileSync(P('data/v20/full-market-technical-regression.json'), `${JSON.stringify(report,null,2)}\n`, 'utf8');
if(report.ok){
  try{
    execFileSync(process.execPath,[P('scripts/v20/build-current-reference-candidate-audit.cjs')],{cwd:root,env:process.env,stdio:'inherit'});
    execFileSync(process.execPath,[P('scripts/v20/current-reference-candidate-audit-regression.cjs')],{cwd:root,env:process.env,stdio:'inherit'});
    const currentReferenceCandidateAudit=read('data/v20/current-reference-candidate-audit.json'), currentReferenceCandidateAuditRegression=read('data/v20/current-reference-candidate-audit-regression.json');
    report.currentReferenceCandidateAudit=currentReferenceCandidateAudit;
    report.currentReferenceCandidateAuditRegression=currentReferenceCandidateAuditRegression;
    report.checks.currentReferenceCandidateAuditIntegrated=currentReferenceCandidateAuditRegression.ok===true;
    if(currentReferenceCandidateAuditRegression.ok!==true) failures.push('CURRENT_REFERENCE_CANDIDATE_AUDIT_REGRESSION_FAILED');
  }catch(e){failures.push('CURRENT_REFERENCE_CANDIDATE_AUDIT_RUNTIME_FAILED');report.currentReferenceCandidateAuditError=e.message;}
}
report.failures=failures;report.failedCount=failures.length;report.ok=failures.length===0;
fs.writeFileSync(P('data/v20/full-market-technical-regression.json'), `${JSON.stringify(report,null,2)}\n`, 'utf8');
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
