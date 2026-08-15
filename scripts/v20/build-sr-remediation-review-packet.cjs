#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>{const file=P(r);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const finite=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const uniq=a=>[...new Set((a||[]).filter(Boolean))];

const audit=read('data/v20/sr-remediation-audit.json');
if(audit.schemaVersion!=='20.0.0-sr-remediation-audit-3')throw new Error(`Unsupported S/R remediation schema ${audit.schemaVersion||'missing'}`);

function blocker(code,scope,severity,detail,evidence){return{code,scope,severity,detail,evidence}}
function action(code,owner,detail){return{code,owner,detail,automatic:false}}
function rowPacket(row){
  const roles=row.remediationRoles||[],h=row.authoritativeV17?.history50||{},sr=row.authoritativeV17?.internalSr||{},sup=row.supplementalCandidate||{},attempt=row.acquisitionAttempt||{},identity=sup.identityEvidence||{},conflict=row.authoritativeV17?.conflict||null;
  const blockers=[],actions=[];
  if(roles.includes('MISSING'))blockers.push(blocker('V17_CANDIDATE_EVIDENCE_MISSING','AUTHORITATIVE_V17','HIGH','The symbol remains in the authoritative V17 missing-candidate set.','data/v17/resilient-session-status.json'));
  if(h.currentSessionRowPresent===true&&h.currentSessionSourceVerified!==true){blockers.push(blocker('V17_HISTORY50_CURRENT_ROW_NOT_SOURCE_SESSION_VERIFIED','AUTHORITATIVE_V17','HIGH','The current-session history-50 row exists but sourceSessionVerified is not true.','data/history-50.json'));actions.push(action('REVERIFY_HISTORY50_CURRENT_SESSION_PROVENANCE','V17_REVIEW','Re-verify the current-session row provenance against an accepted source before rebuilding Internal S/R.'))}
  if(h.currentSessionRowPresent!==true){blockers.push(blocker('V17_HISTORY50_CURRENT_SESSION_ROW_MISSING','AUTHORITATIVE_V17','HIGH','The authoritative history-50 input has no row for the V17 reference session.','data/history-50.json'));actions.push(action('ACQUIRE_AUTHORITATIVE_CURRENT_SESSION_OHLC','V17_REVIEW','Acquire a valid current-session OHLC row from an accepted source and document provenance before any V17 rebuild.'))}
  if(h.currentSessionRowPresent===true&&h.currentSessionOhlcValid!==true){blockers.push(blocker('V17_HISTORY50_CURRENT_OHLC_INVALID','AUTHORITATIVE_V17','CRITICAL','The current-session authoritative history-50 OHLC is invalid or incomplete.','data/history-50.json'));actions.push(action('REPAIR_AUTHORITATIVE_CURRENT_SESSION_OHLC','V17_REVIEW','Repair the authoritative current-session OHLC from an accepted source; do not infer or synthesize missing OHLC.'))}
  if(roles.includes('STALE')||sr.rowExists===true&&sr.sessionAligned!==true){blockers.push(blocker('V17_INTERNAL_SR_STALE','AUTHORITATIVE_V17','HIGH','A trusted Internal S/R row exists but is not aligned to the current reference session.','data/v17/internal-ohlc-support-resistance.json'));actions.push(action('REBUILD_CURRENT_SESSION_INTERNAL_SR','V17_REVIEW','Rebuild Internal S/R from accepted current-session history after provenance is verified.'))}
  if(roles.includes('CONFLICT')||conflict?.critical===true){blockers.push(blocker('V17_CRITICAL_SOURCE_CONFLICT','AUTHORITATIVE_V17','CRITICAL',`Critical source conflict remains${conflict?.maxDiffPct!==undefined?` (maxDiffPct ${conflict.maxDiffPct})`:''}.`,'data/v17/resilient-session-status.json'));actions.push(action('DOCUMENT_AND_RESOLVE_SOURCE_CONFLICT','V17_REVIEW','Compare authoritative inputs and external validation sources, document the discrepancy, and resolve it only through the V17 review/rebuild path.'))}

  if(attempt.status==='FETCH_FAILED'){blockers.push(blocker('SUPPLEMENTAL_PROVIDER_FETCH_FAILED','SUPPLEMENTAL','MEDIUM',attempt.error||'Supplemental provider fetch failed.','Yahoo supplemental acquisition'));actions.push(action('TRY_ACCEPTED_ALTERNATE_PROVIDER','RESEARCH_REVIEW','Use an existing alternate provider only as supplemental review evidence; do not relabel it as V17 trusted execution evidence.'))}
  if(attempt.status==='NO_SYMBOL_MAP_ENTRY'){blockers.push(blocker('SUPPLEMENTAL_SYMBOL_MAP_ENTRY_MISSING','SUPPLEMENTAL','MEDIUM','No symbol-map entry was available for supplemental acquisition.','data/symbol-map.json'));actions.push(action('VERIFY_SYMBOL_IDENTITY_MAPPING','RESEARCH_REVIEW','Verify ticker/identity mapping before any alternate-provider acquisition.'))}
  if(attempt.status==='FETCHED'&&sup.identityVerified!==true){blockers.push(blocker('SUPPLEMENTAL_IDENTITY_UNVERIFIED','SUPPLEMENTAL','HIGH','Supplemental provider identity verification did not pass.','Yahoo identity evidence'));actions.push(action('VERIFY_SUPPLEMENTAL_IDENTITY','RESEARCH_REVIEW','Resolve symbol/exchange/currency/name identity before considering the supplemental history for review.'))}
  if(attempt.status==='FETCHED'&&sup.currentSession!==true){blockers.push(blocker('SUPPLEMENTAL_CURRENT_SESSION_MISSING','SUPPLEMENTAL','MEDIUM',`Supplemental latest session is ${sup.latestSession||'unavailable'}, not ${audit.sessionDate}.`,'Yahoo supplemental history'));actions.push(action('ACQUIRE_CURRENT_SESSION_FROM_ALTERNATE_PROVIDER','RESEARCH_REVIEW','Acquire current-session evidence from an existing alternate provider if available.'))}
  if(attempt.status==='FETCHED'&&sup.currentSession===true&&sup.currentSessionOhlc?.valid!==true){blockers.push(blocker('SUPPLEMENTAL_CURRENT_OHLC_INVALID','SUPPLEMENTAL','HIGH','Supplemental current-session OHLC failed validity checks.','Yahoo supplemental history'));actions.push(action('REJECT_INVALID_SUPPLEMENTAL_OHLC','RESEARCH_REVIEW','Do not use invalid supplemental OHLC; seek another accepted evidence source.'))}
  if(attempt.status==='FETCHED'&&sup.priceReconciled!==true){blockers.push(blocker('SUPPLEMENTAL_PRICE_NOT_RECONCILED','SUPPLEMENTAL','HIGH',`Supplemental/current reference difference is ${finite(sup.currentPriceDifferencePct)??'unavailable'}% versus tolerance ${finite(sup.priceTolerancePct)??'unavailable'}%.`,'Yahoo supplemental history + V20 current market reference'));actions.push(action('VERIFY_PRICE_SCALE_AND_REFERENCE','RESEARCH_REVIEW','Investigate the price/reference mismatch with authoritative evidence. Do not assume a split, adjustment, or corporate action without proof.'))}
  const identityDiff=finite(identity.localDifferencePct),identityGuard=finite(identity.guardedMaxDifferencePct),identityReferenceConflict=identityDiff!==null&&identityGuard!==null&&identityDiff>identityGuard;
  if(identityReferenceConflict){blockers.push(blocker('SUPPLEMENTAL_IDENTITY_REFERENCE_PRICE_CONFLICT','SUPPLEMENTAL','CRITICAL',`Provider identity metadata differs from the local reference by ${identityDiff}% and exceeds the adapter diagnostic guard ${identityGuard}%.`,'Yahoo identity metadata'));actions.push(action('RECONCILE_PROVIDER_IDENTITY_PRICE_REFERENCE','RESEARCH_REVIEW','Reconcile provider identity metadata versus the authoritative price reference before treating the supplemental candidate as clean review evidence.'))}

  const cleanSupplementalCandidate=sup.eligibleForV17Review===true&&!identityReferenceConflict&&blockers.every(x=>!(x.scope==='SUPPLEMENTAL'&&['HIGH','CRITICAL'].includes(x.severity)));
  let reviewState='V17_PROVENANCE_REVIEW_REQUIRED';
  if(roles.includes('CONFLICT'))reviewState='CRITICAL_SOURCE_CONFLICT_MANUAL_REVIEW';
  else if(h.currentSessionRowPresent===true&&h.currentSessionOhlcValid!==true)reviewState='AUTHORITATIVE_OHLC_REPAIR_REQUIRED';
  else if(attempt.status==='FETCH_FAILED'||attempt.status==='NO_SYMBOL_MAP_ENTRY')reviewState='ALTERNATE_PROVIDER_REQUIRED';
  else if(identityReferenceConflict)reviewState='PROVIDER_IDENTITY_REFERENCE_CONFLICT_REVIEW';
  else if(attempt.status==='FETCHED'&&sup.currentSession!==true)reviewState='CURRENT_SESSION_EVIDENCE_REQUIRED';
  else if(attempt.status==='FETCHED'&&sup.priceReconciled!==true)reviewState='PRICE_REFERENCE_RECONCILIATION_REQUIRED';
  else if(cleanSupplementalCandidate)reviewState='SUPPLEMENTAL_CANDIDATE_CLEAN_FOR_MANUAL_V17_REVIEW';
  const priority=blockers.some(x=>x.severity==='CRITICAL')?'HIGH':blockers.some(x=>x.severity==='HIGH')?'MEDIUM':'NORMAL';
  return{
    symbol:row.symbol,roles,reviewState,reviewPriority:priority,cleanSupplementalCandidate,
    authoritativeObservedCondition:row.observedCondition||row.diagnosis||null,causeVerified:false,
    supplementalStatus:sup.status||'UNAVAILABLE',supplementalEligibleForV17Review:sup.eligibleForV17Review===true,
    supplementalTrustedForV17Execution:false,supplementalExecutionEligible:false,
    providerIdentityReference:{localDifferencePct:identityDiff,diagnosticGuardPct:identityGuard,conflict:identityReferenceConflict,guardedPolicyRequested:identity.guardedPolicyRequested===true},
    blockers,reviewActions:uniq(actions.map(x=>JSON.stringify(x))).map(x=>JSON.parse(x)),
    automaticMutationAllowed:false,automaticResolutionAllowed:false,
    decisionEffect:{usedForDecisionScore:false,usedForExecutionGate:false,usedForProductionAllocation:false,opensExecutionGrade:false},
  };
}

const rows=(audit.targets||audit.symbols||[]).map(rowPacket);
const stateCounts=Object.fromEntries([...new Set(rows.map(x=>x.reviewState))].sort().map(state=>[state,rows.filter(x=>x.reviewState===state).length]));
const packet={
  schemaVersion:'20.0.0-sr-remediation-review-packet-1',generatedAt:new Date().toISOString(),sessionDate:audit.sessionDate,status:'MANUAL_REVIEW_PACKET_RESEARCH_ONLY',
  sourceAuditSchemaVersion:audit.schemaVersion,sourceAudit:'data/v20/regression.json#supportResistanceRemediation',readOnly:true,
  automaticV17MutationAllowed:false,automaticTrustUpgradeAllowed:false,automaticConflictResolutionAllowed:false,guaranteesExecutionGrade:false,
  summary:{targetCount:rows.length,cleanSupplementalCandidateCount:rows.filter(x=>x.cleanSupplementalCandidate).length,supplementalEligibleButNotCleanCount:rows.filter(x=>x.supplementalEligibleForV17Review&&!x.cleanSupplementalCandidate).length,alternateProviderRequiredCount:rows.filter(x=>x.reviewState==='ALTERNATE_PROVIDER_REQUIRED').length,currentSessionEvidenceRequiredCount:rows.filter(x=>x.reviewState==='CURRENT_SESSION_EVIDENCE_REQUIRED').length,priceReferenceReconciliationRequiredCount:rows.filter(x=>x.reviewState==='PRICE_REFERENCE_RECONCILIATION_REQUIRED').length,providerIdentityReferenceConflictCount:rows.filter(x=>x.providerIdentityReference?.conflict===true).length,criticalSourceConflictReviewCount:rows.filter(x=>x.reviewState==='CRITICAL_SOURCE_CONFLICT_MANUAL_REVIEW').length,authoritativeOhlcRepairRequiredCount:rows.filter(x=>x.reviewState==='AUTHORITATIVE_OHLC_REPAIR_REQUIRED').length,stateCounts},
  rows,
  interpretation:{manualReviewOnly:true,cleanSupplementalCandidateDoesNotMeanV17Trusted:true,providerIdentityDiagnosticGuardIsNotAnExecutionThreshold:true,noCorporateActionCauseInferred:true,v17RebuildStillRequired:true,note:'This packet converts same-run remediation evidence into explicit blockers and review actions. It never mutates V17, never upgrades trust, and never resolves a source conflict automatically.'}
};
write('data/v20/sr-remediation-review-packet.json',packet);
console.log(JSON.stringify({status:packet.status,summary:packet.summary,rows:Object.fromEntries(rows.map(x=>[x.symbol,{state:x.reviewState,priority:x.reviewPriority,clean:x.cleanSupplementalCandidate,blockers:x.blockers.map(b=>b.code)}]))},null,2));
