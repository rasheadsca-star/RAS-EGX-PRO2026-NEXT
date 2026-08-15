#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>fs.writeFileSync(P(r),`${JSON.stringify(v,null,2)}\n`,'utf8');
const finite=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const packet=read('data/v20/sr-remediation-review-packet.json');
const audit=read('data/v20/sr-remediation-audit.json');
const failures=[];const check=(ok,code)=>{if(!ok)failures.push(code)};
const auditMap=new Map((audit.targets||audit.symbols||[]).map(x=>[x.symbol,x]));
check(packet.schemaVersion==='20.0.0-sr-remediation-review-packet-1','SR_REVIEW_PACKET_SCHEMA_DRIFT');
check(packet.status==='MANUAL_REVIEW_PACKET_RESEARCH_ONLY','SR_REVIEW_PACKET_STATUS_DRIFT');
check(packet.sessionDate===audit.sessionDate,'SR_REVIEW_PACKET_SESSION_MISMATCH');
check(packet.readOnly===true&&packet.automaticV17MutationAllowed===false&&packet.automaticTrustUpgradeAllowed===false&&packet.automaticConflictResolutionAllowed===false&&packet.guaranteesExecutionGrade===false,'SR_REVIEW_PACKET_SAFETY_DRIFT');
check((packet.rows||[]).length===(audit.targets||audit.symbols||[]).length,'SR_REVIEW_PACKET_TARGET_COUNT_MISMATCH');
for(const row of packet.rows||[]){
  const src=auditMap.get(row.symbol);check(!!src,`SR_REVIEW_PACKET_UNKNOWN_SYMBOL_${row.symbol}`);if(!src)continue;
  check(row.causeVerified===false,`SR_REVIEW_PACKET_FALSE_CAUSE_VERIFIED_${row.symbol}`);
  check(row.supplementalTrustedForV17Execution===false&&row.supplementalExecutionEligible===false,`SR_REVIEW_PACKET_SUPPLEMENTAL_TRUST_LEAK_${row.symbol}`);
  check(row.automaticMutationAllowed===false&&row.automaticResolutionAllowed===false,`SR_REVIEW_PACKET_AUTOMATION_LEAK_${row.symbol}`);
  check(row.decisionEffect?.usedForDecisionScore===false&&row.decisionEffect?.usedForExecutionGate===false&&row.decisionEffect?.usedForProductionAllocation===false&&row.decisionEffect?.opensExecutionGrade===false,`SR_REVIEW_PACKET_DECISION_EFFECT_LEAK_${row.symbol}`);
  const identity=src.supplementalCandidate?.identityEvidence||{},diff=finite(identity.localDifferencePct),guard=finite(identity.guardedMaxDifferencePct),expectedIdentityConflict=diff!==null&&guard!==null&&diff>guard;
  check(row.providerIdentityReference?.conflict===expectedIdentityConflict,`SR_REVIEW_PACKET_IDENTITY_CONFLICT_MISMATCH_${row.symbol}`);
  if(expectedIdentityConflict)check((row.blockers||[]).some(x=>x.code==='SUPPLEMENTAL_IDENTITY_REFERENCE_PRICE_CONFLICT'),`SR_REVIEW_PACKET_IDENTITY_CONFLICT_BLOCKER_MISSING_${row.symbol}`);
  if(src.acquisitionAttempt?.status==='FETCH_FAILED')check(row.reviewState==='ALTERNATE_PROVIDER_REQUIRED'||(src.remediationRoles||[]).includes('CONFLICT'),`SR_REVIEW_PACKET_FETCH_FAILURE_STATE_${row.symbol}`);
  if(src.supplementalCandidate?.currentSession!==true&&src.acquisitionAttempt?.status==='FETCHED'&&!expectedIdentityConflict)check(['CURRENT_SESSION_EVIDENCE_REQUIRED','AUTHORITATIVE_OHLC_REPAIR_REQUIRED','CRITICAL_SOURCE_CONFLICT_MANUAL_REVIEW'].includes(row.reviewState),`SR_REVIEW_PACKET_CURRENT_SESSION_STATE_${row.symbol}`);
  if(src.supplementalCandidate?.priceReconciled!==true&&src.supplementalCandidate?.currentSession===true&&!expectedIdentityConflict&&!(src.remediationRoles||[]).includes('CONFLICT'))check(row.reviewState==='PRICE_REFERENCE_RECONCILIATION_REQUIRED'||row.reviewState==='AUTHORITATIVE_OHLC_REPAIR_REQUIRED',`SR_REVIEW_PACKET_PRICE_STATE_${row.symbol}`);
  if((src.remediationRoles||[]).includes('CONFLICT')){check(row.reviewState==='CRITICAL_SOURCE_CONFLICT_MANUAL_REVIEW',`SR_REVIEW_PACKET_CONFLICT_STATE_${row.symbol}`);check((row.blockers||[]).some(x=>x.code==='V17_CRITICAL_SOURCE_CONFLICT'),`SR_REVIEW_PACKET_CONFLICT_BLOCKER_MISSING_${row.symbol}`)}
  if(src.authoritativeV17?.history50?.currentSessionRowPresent===true&&src.authoritativeV17?.history50?.currentSessionOhlcValid!==true){check(row.reviewState==='AUTHORITATIVE_OHLC_REPAIR_REQUIRED'||(src.remediationRoles||[]).includes('CONFLICT'),`SR_REVIEW_PACKET_INVALID_AUTH_OHLC_STATE_${row.symbol}`);check((row.blockers||[]).some(x=>x.code==='V17_HISTORY50_CURRENT_OHLC_INVALID'),`SR_REVIEW_PACKET_INVALID_AUTH_OHLC_BLOCKER_${row.symbol}`)}
  const highSupplementalBlock=(row.blockers||[]).some(x=>x.scope==='SUPPLEMENTAL'&&['HIGH','CRITICAL'].includes(x.severity));
  const expectedClean=src.supplementalCandidate?.eligibleForV17Review===true&&!expectedIdentityConflict&&!highSupplementalBlock;
  check(row.cleanSupplementalCandidate===expectedClean,`SR_REVIEW_PACKET_CLEAN_CLASSIFICATION_MISMATCH_${row.symbol}`);
  if(row.cleanSupplementalCandidate===true)check(row.reviewState==='SUPPLEMENTAL_CANDIDATE_CLEAN_FOR_MANUAL_V17_REVIEW'||(src.remediationRoles||[]).includes('CONFLICT'),`SR_REVIEW_PACKET_CLEAN_STATE_MISMATCH_${row.symbol}`);
  check((row.reviewActions||[]).every(a=>a.automatic===false),`SR_REVIEW_PACKET_AUTOMATIC_ACTION_${row.symbol}`);
}
const rows=packet.rows||[];
check(packet.summary?.targetCount===rows.length,'SR_REVIEW_PACKET_SUMMARY_TARGET_COUNT');
check(packet.summary?.cleanSupplementalCandidateCount===rows.filter(x=>x.cleanSupplementalCandidate).length,'SR_REVIEW_PACKET_SUMMARY_CLEAN_COUNT');
check(packet.summary?.supplementalEligibleButNotCleanCount===rows.filter(x=>x.supplementalEligibleForV17Review&&!x.cleanSupplementalCandidate).length,'SR_REVIEW_PACKET_SUMMARY_ELIGIBLE_NOT_CLEAN');
check(packet.summary?.providerIdentityReferenceConflictCount===rows.filter(x=>x.providerIdentityReference?.conflict===true).length,'SR_REVIEW_PACKET_SUMMARY_IDENTITY_CONFLICT');
check(packet.interpretation?.manualReviewOnly===true&&packet.interpretation?.cleanSupplementalCandidateDoesNotMeanV17Trusted===true&&packet.interpretation?.providerIdentityDiagnosticGuardIsNotAnExecutionThreshold===true&&packet.interpretation?.noCorporateActionCauseInferred===true&&packet.interpretation?.v17RebuildStillRequired===true,'SR_REVIEW_PACKET_INTERPRETATION_GUARD');
const afmc=rows.find(x=>x.symbol==='AFMC');if(afmc){check(afmc.reviewState==='CRITICAL_SOURCE_CONFLICT_MANUAL_REVIEW','SR_REVIEW_PACKET_AFMC_NOT_CONFLICT_REVIEW');check(afmc.providerIdentityReference?.conflict===true,'SR_REVIEW_PACKET_AFMC_IDENTITY_ANOMALY_NOT_FLAGGED');check(afmc.cleanSupplementalCandidate===false,'SR_REVIEW_PACKET_AFMC_FALSELY_CLEAN')}
const report={schemaVersion:'20.0.0-sr-remediation-review-packet-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,checks:{sameRunAuditTargetSetPreserved:true,noV17MutationOrTrustUpgrade:true,noDecisionExecutionOrAllocationEffect:true,providerIdentityReferenceConflictDerivedFromAdapterEvidence:true,afmcConflictRemainsUnresolved:true,afmcProviderIdentityAnomalyFlagged:true,cleanCandidateNeverMeansV17Trusted:true,noCorporateActionCauseInferred:true,allReviewActionsManual:true},evidence:{targetCount:rows.length,cleanSupplementalCandidateCount:packet.summary?.cleanSupplementalCandidateCount??null,supplementalEligibleButNotCleanCount:packet.summary?.supplementalEligibleButNotCleanCount??null,providerIdentityReferenceConflictCount:packet.summary?.providerIdentityReferenceConflictCount??null,stateCounts:packet.summary?.stateCounts||{}}};
write('data/v20/sr-remediation-review-packet-regression.json',report);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
