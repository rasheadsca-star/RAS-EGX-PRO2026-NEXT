#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const sha256=rel=>crypto.createHash('sha256').update(fs.readFileSync(P(rel))).digest('hex');
const failures=[];const check=(ok,code)=>{if(!ok)failures.push(code)};
const uniq=a=>[...new Set((a||[]).filter(Boolean).map(String))];
const audit=read('data/v20/sr-remediation-audit.json');
const gap=read('data/v20/execution-gap-regression.json');
const gate=read('data/v17/resilient-session-status.json');
const sr=read('data/v17/internal-ohlc-support-resistance.json');
const current=read('data/v20/current.json');
const protectedInputs=['data/v17/resilient-session-status.json','data/v17/internal-ohlc-support-resistance.json','data/history-50.json'];
const currentHashes=Object.fromEntries(protectedInputs.map(rel=>[rel,sha256(rel)]));
const missing=uniq(gap.symbols?.missingCandidateSymbols||[]),stale=uniq(gap.symbols?.staleTrustedCandidateSymbols||[]),conflicts=uniq(gap.symbols?.conflictSymbols||[]),expected=uniq([...missing,...stale,...conflicts]).sort(),actual=uniq((audit.targets||audit.symbols||[]).map(x=>x.symbol)).sort();
const t=sr.thresholds||{},coverageThreshold=Number(t.minimumCandidateCoveragePct??t.minimumCoveragePct??95),freshnessThreshold=Number(t.minimumCandidateFreshnessPct??t.minimumFreshnessPct??98),criticalThreshold=Number(t.minimumCandidateCriticalFieldsPct??95),confidenceThreshold=Number(t.minimumAverageFreshConfidence??t.minimumConfidence??0.8),total=Number(sr.candidateUniverseCount||0),req=p=>Math.ceil(total*Number(p)/100-1e-9),criticalEquivalent=Math.round(total*Number(sr.criticalFieldsPct??sr.coveragePct??0)/100);

check(audit.schemaVersion==='20.0.0-sr-remediation-audit-3','SR3_SCHEMA_DRIFT');
check(audit.status==='REMEDIATION_CANDIDATE_RESEARCH_ONLY','SR3_STATUS_DRIFT');
check(audit.sessionDate===current.sessionDate&&audit.sessionDate===gate.priceTruth?.verifiedSessionDate&&audit.sessionDate===sr.referenceSessionDate,'SR3_SESSION_MISMATCH');
check(audit.readOnly===true&&audit.automaticV17MutationAllowed===false&&audit.automaticTrustUpgradeAllowed===false&&audit.automaticConflictResolutionAllowed===false,'SR3_MUTATION_OR_AUTO_UPGRADE_ALLOWED');
check(audit.guaranteesExecutionGrade===false&&audit.requiresV17InternalSrRebuild===true&&audit.requiresV17GateRebuild===true,'SR3_FALSE_EXECUTION_GUARANTEE');
check(audit.authoritativeInputPath==='data/history-50.json','SR3_AUTHORITATIVE_HISTORY_PATH_DRIFT');
check(audit.supplementalProvider==='YAHOO'&&audit.supplementalInputRole==='REVIEW_CANDIDATE_ONLY_NOT_V17_TRUSTED_EXECUTION_EVIDENCE','SR3_SUPPLEMENTAL_ROLE_DRIFT');
check(JSON.stringify(expected)===JSON.stringify(actual),'SR3_TARGET_SET_MISMATCH');
check(audit.summary?.targetCount===expected.length,'SR3_TARGET_COUNT_MISMATCH');
check(audit.summary?.missingTargetCount===missing.length&&audit.summary?.staleTargetCount===stale.length&&audit.summary?.conflictTargetCount===conflicts.length,'SR3_ROLE_COUNT_MISMATCH');
check(audit.summary?.automaticResolutionCount===0,'SR3_AUTOMATIC_RESOLUTION_RECORDED');
check(audit.inputIntegrity?.unchanged===true,'SR3_BUILDER_REPORTED_INPUT_MUTATION');
for(const rel of protectedInputs){check(audit.inputIntegrity?.before?.[rel]===audit.inputIntegrity?.after?.[rel],`SR3_BEFORE_AFTER_HASH_MISMATCH_${rel}`);check(audit.inputIntegrity?.after?.[rel]===currentHashes[rel],`SR3_POST_BUILD_HASH_DRIFT_${rel}`)}

const roleExpected=new Map();for(const s of missing){const x=roleExpected.get(s)||[];x.push('MISSING');roleExpected.set(s,x)}for(const s of stale){const x=roleExpected.get(s)||[];x.push('STALE');roleExpected.set(s,x)}for(const s of conflicts){const x=roleExpected.get(s)||[];x.push('CONFLICT');roleExpected.set(s,x)}
for(const row of audit.targets||audit.symbols||[]){
  const roles=uniq(row.remediationRoles||[]).sort(),wanted=uniq(roleExpected.get(row.symbol)||[]).sort();
  check(JSON.stringify(roles)===JSON.stringify(wanted),`SR3_ROLE_MISMATCH_${row.symbol}`);
  check(row.status==='REMEDIATION_CANDIDATE_RESEARCH_ONLY',`SR3_ROW_STATUS_DRIFT_${row.symbol}`);
  check(row.causeVerified===false,`SR3_CAUSE_FALSELY_VERIFIED_${row.symbol}`);
  check(row.automaticMutationPerformed===false&&row.automaticTrustUpgrade===false&&row.automaticConflictResolution===false,`SR3_ROW_AUTOMATION_VIOLATION_${row.symbol}`);
  check(row.authoritativeV17?.history50?.inputPath==='data/history-50.json',`SR3_ROW_AUTHORITATIVE_PATH_DRIFT_${row.symbol}`);
  const sup=row.supplementalCandidate||{};
  check(sup.provider==='YAHOO'&&sup.sourceRole==='SUPPLEMENTAL_REVIEW_CANDIDATE_ONLY',`SR3_SUPPLEMENTAL_PROVIDER_ROLE_DRIFT_${row.symbol}`);
  check(sup.trustedForV17Execution===false&&sup.executionEligible===false&&sup.autoResolveConflict===false,`SR3_SUPPLEMENTAL_TRUST_LEAK_${row.symbol}`);
  if(sup.eligibleForV17Review===true){
    check(sup.identityVerified===true,`SR3_REVIEW_READY_IDENTITY_UNVERIFIED_${row.symbol}`);
    check(sup.currentSession===true&&sup.latestSession===audit.sessionDate,`SR3_REVIEW_READY_SESSION_MISMATCH_${row.symbol}`);
    check(sup.currentSessionOhlc?.valid===true,`SR3_REVIEW_READY_OHLC_INVALID_${row.symbol}`);
    check(sup.priceReconciled===true&&Number(sup.currentPriceDifferencePct)<=Number(sup.priceTolerancePct),'SR3_REVIEW_READY_PRICE_NOT_RECONCILED_'+row.symbol);
    check(Number(sup.futureRowsRejected)>=0,`SR3_REVIEW_READY_FUTURE_ROW_ACCOUNTING_MISSING_${row.symbol}`);
  }
  if(roles.includes('CONFLICT')){
    check(!!row.authoritativeV17?.conflict,`SR3_CONFLICT_EVIDENCE_MISSING_${row.symbol}`);
    check(row.automaticConflictResolution===false&&sup.autoResolveConflict===false,`SR3_CONFLICT_AUTO_RESOLVED_${row.symbol}`);
  }
  if(roles.includes('STALE'))check(row.authoritativeV17?.internalSr?.rowExists===true,`SR3_STALE_SR_ROW_MISSING_${row.symbol}`);
}

check(audit.currentGap?.trustedGap===Math.max(0,req(coverageThreshold)-Number(sr.candidateTrustedCount||0)),'SR3_TRUSTED_GAP_MISMATCH');
check(audit.currentGap?.trustedFreshGap===Math.max(0,req(freshnessThreshold)-Number(sr.candidateTrustedFreshCount||0)),'SR3_FRESH_GAP_MISMATCH');
check(audit.currentGap?.criticalGap===Math.max(0,req(criticalThreshold)-criticalEquivalent),'SR3_CRITICAL_GAP_MISMATCH');
check(audit.currentGap?.sourceConflictCount===(sr.sourceConflicts||[]).length,'SR3_CONFLICT_COUNT_MISMATCH');
check(audit.currentGap?.minimumAverageFreshConfidence===confidenceThreshold,'SR3_CONFIDENCE_THRESHOLD_MISMATCH');
check(coverageThreshold===95&&freshnessThreshold===98&&criticalThreshold===95&&confidenceThreshold===0.8,'SR3_THRESHOLD_DRIFT');
check(audit.interpretation?.v17AuthoritativeInputSeparatedFromSupplementalCandidate===true&&audit.interpretation?.yahooHistoryIsNotV17TrustedExecutionEvidence===true&&audit.interpretation?.eligibleForV17ReviewDoesNotMeanExecutionEligible===true&&audit.interpretation?.noCandidateEffectSimulation===true,'SR3_INTERPRETATION_GUARD_MISSING');

const report={schemaVersion:'20.0.0-sr-remediation-regression-3',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,evidence:{targetCount:expected.length,missingCount:missing.length,staleCount:stale.length,conflictCount:conflicts.length,supplementalFetchedCount:audit.summary?.supplementalFetchedCount??null,supplementalReviewReadyCount:audit.summary?.supplementalReviewReadyCount??null,protectedInputHashes:currentHashes},checks:{readOnlyNoV17Mutation:failures.every(x=>!x.includes('HASH')&&!x.includes('MUTATION')),targetSetDerivedFromSameRunExecutionGap:JSON.stringify(expected)===JSON.stringify(actual),authoritativeHistory50SeparatedFromSupplementalYahoo:true,supplementalNeverTrustedForV17Execution:true,supplementalNeverExecutionEligible:true,conflictNeverAutoResolved:true,reviewReadinessRequiresIdentitySessionOhlcAndPriceReconciliation:true,gapsRecomputedFromOfficialThresholds:true,noExecutionGuarantee:true,fullV17RebuildRequired:true,noCandidateEffectSimulation:true}};
fs.writeFileSync(P('data/v20/sr-remediation-regression.json'),`${JSON.stringify(report,null,2)}\n`,'utf8');
console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
