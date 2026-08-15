#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>{const file=P(r);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const finite=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=3)=>{const n=finite(v);if(n===null)return null;const p=10**d;return Math.round(n*p)/p};
const diffPct=(reference,value)=>{const r=finite(reference),v=finite(value);return r>0&&v>0?round(Math.abs(v-r)/r*100,3):null};

const audit=read('data/v20/sr-remediation-audit.json');
const packet=read('data/v20/sr-remediation-review-packet.json');
const alt=read('data/v20/sr-remediation-alternate-evidence.json');
if(audit.schemaVersion!=='20.0.0-sr-remediation-audit-3')throw new Error('S/R remediation audit v3 required');
if(packet.schemaVersion!=='20.0.0-sr-remediation-review-packet-1')throw new Error('S/R review packet required');
if(alt.schemaVersion!=='20.0.0-sr-remediation-alternate-evidence-1')throw new Error('Starta alternate evidence required');
if(audit.sessionDate!==packet.sessionDate||audit.sessionDate!==alt.sessionDate)throw new Error('S/R remediation evidence session mismatch');

const auditMap=new Map((audit.targets||audit.symbols||[]).map(x=>[x.symbol,x]));
const altMap=new Map((alt.rows||[]).map(x=>[x.symbol,x]));

function classify(review,a,starta){
  const roles=review.roles||[];
  const h=a.authoritativeV17?.history50||{};
  if(roles.includes('CONFLICT'))return'CRITICAL_SOURCE_CONFLICT_REMAINS';
  if(h.currentSessionRowPresent===true&&h.currentSessionOhlcValid!==true)return'AUTHORITATIVE_OHLC_REPAIR_REQUIRED';
  if(starta?.status==='CURRENT_REVIEW_CANDIDATE'&&starta.historyContinuity?.accepted!==true&&roles.includes('STALE'))return'STARTA_CURRENT_RECONCILED_SR_REFRESH_REVIEW';
  if(starta?.status==='CURRENT_REVIEW_CANDIDATE'&&starta.historyContinuity?.accepted!==true)return'STARTA_CURRENT_RECONCILED_HISTORY50_REVIEW_REQUIRED';
  if(starta?.currentSession===true&&starta.priceReconciled!==true&&finite(starta.currentPrice)===null)return'STARTA_CURRENT_MARKET_REFERENCE_MISSING';
  if(starta?.currentSession!==true)return'NO_CURRENT_STARTA_SESSION';
  return'MANUAL_AUTHORITATIVE_REVIEW_REQUIRED';
}
function actionFor(state){return({
  CRITICAL_SOURCE_CONFLICT_REMAINS:'Resolve the authoritative V17 source conflict through documented comparison/rebuild; supplemental agreement cannot auto-select a winner.',
  AUTHORITATIVE_OHLC_REPAIR_REQUIRED:'Restore a valid authoritative current-session OHLC and current price reference from an accepted source before rebuilding Internal S/R.',
  STARTA_CURRENT_RECONCILED_SR_REFRESH_REVIEW:'Review the stale Internal S/R row against the current authoritative market reference and Starta supplemental row, then rebuild only through V17.',
  STARTA_CURRENT_RECONCILED_HISTORY50_REVIEW_REQUIRED:'Reconcile the current history-50 row/provenance against the authoritative market reference and Starta supplemental row; do not overwrite history-50 automatically.',
  STARTA_CURRENT_MARKET_REFERENCE_MISSING:'Acquire/restore the authoritative current market reference first; a current Starta row without that baseline cannot be accepted for repair.',
  NO_CURRENT_STARTA_SESSION:'Acquire current-session evidence from an accepted authoritative source; the Starta history available here is not current enough.',
  MANUAL_AUTHORITATIVE_REVIEW_REQUIRED:'Perform manual V17 provenance review and rebuild the affected evidence only after the authoritative source is established.'
}[state]||'Manual V17 review required.')}

const rows=(packet.rows||[]).map(review=>{
  const a=auditMap.get(review.symbol)||{};
  const starta=altMap.get(review.symbol)||null;
  const h=a.authoritativeV17?.history50||{},y=a.supplementalCandidate||{},yIdentity=y.identityEvidence||{};
  const marketRef=finite(a.currentMarket?.price),history50Close=finite(h.currentSessionOhlc?.close),yahooHistoryClose=finite(y.currentSessionOhlc?.close),yahooMetadataPrice=finite(yIdentity.regularMarketPrice),startaClose=finite(starta?.currentSessionOhlc?.close),startaMetadataPrice=finite(starta?.identity?.providerLastPrice);
  const state=classify(review,a,starta);
  return{
    symbol:review.symbol,roles:review.roles||[],reviewPriority:review.reviewPriority,reviewState:review.reviewState,triangulationState:state,
    sessionDate:audit.sessionDate,
    evidenceMatrix:{
      marketReference:{price:marketRef,available:marketRef!==null,source:'data/v20/market-explorer.json'},
      history50:{close:history50Close,currentSessionRowPresent:h.currentSessionRowPresent===true,currentSessionOhlcValid:h.currentSessionOhlcValid===true,sourceSessionVerified:h.currentSessionSourceVerified===true,source:h.currentSessionSource||null,input:'data/history-50.json'},
      yahooHistory:{close:yahooHistoryClose,currentSession:y.currentSession===true,priceReconciled:y.priceReconciled===true,status:y.status||null,sourceRole:'SUPPLEMENTAL_REVIEW_CANDIDATE_ONLY'},
      yahooIdentity:{regularMarketPrice:yahooMetadataPrice,localDifferencePct:finite(yIdentity.localDifferencePct),diagnosticGuardPct:finite(yIdentity.guardedMaxDifferencePct),identityVerified:y.identityVerified===true},
      startaHistory:{close:startaClose,currentSession:starta?.currentSession===true,priceReconciled:starta?.priceReconciled===true,status:starta?.status||'UNAVAILABLE',latestSession:starta?.latestSession||null,identityVerified:starta?.identityVerified===true,historyContinuityAccepted:starta?.historyContinuity?.accepted===true,historyContinuityMethod:starta?.historyContinuity?.method||null,sourceRole:'SECONDARY_SUPPLEMENTAL_TRIANGULATION_ONLY'},
      startaIdentity:{lastPrice:startaMetadataPrice,name:starta?.identity?.providerNameEn||null,isin:starta?.identity?.providerIsin||null}
    },
    deltasPct:{
      marketVsHistory50:diffPct(marketRef,history50Close),marketVsYahooHistory:diffPct(marketRef,yahooHistoryClose),marketVsYahooMetadata:diffPct(marketRef,yahooMetadataPrice),marketVsStartaHistory:diffPct(marketRef,startaClose),marketVsStartaMetadata:diffPct(marketRef,startaMetadataPrice),history50VsStartaHistory:diffPct(history50Close,startaClose),history50VsYahooHistory:diffPct(history50Close,yahooHistoryClose),yahooHistoryVsStartaHistory:diffPct(yahooHistoryClose,startaClose)
    },
    supplementalAgreement:{yahooAndStartaCurrentRowsAvailable:y.currentSession===true&&starta?.currentSession===true,yahooAndStartaCloseDifferencePct:diffPct(yahooHistoryClose,startaClose),bothReconciledToMarket:y.priceReconciled===true&&starta?.priceReconciled===true},
    authoritativeReviewAction:actionFor(state),
    safety:{causeVerified:false,autoRepairAllowed:false,autoTrustUpgradeAllowed:false,autoConflictResolutionAllowed:false,usedForDecisionScore:false,usedForExecutionGate:false,usedForProductionAllocation:false,opensExecutionGrade:false}
  };
});
const stateCounts=Object.fromEntries([...new Set(rows.map(x=>x.triangulationState))].sort().map(s=>[s,rows.filter(x=>x.triangulationState===s).length]));
const out={schemaVersion:'20.0.0-sr-remediation-handoff-1',generatedAt:new Date().toISOString(),sessionDate:audit.sessionDate,status:'V17_MANUAL_REVIEW_HANDOFF_RESEARCH_ONLY',readOnly:true,sourceAudit:'data/v20/regression.json#supportResistanceRemediation',sourceReviewPacket:'data/v20/regression.json#supportResistanceReviewPacket',sourceStartaEvidence:'data/v20/regression.json#supportResistanceAlternateEvidence',summary:{targetCount:rows.length,stateCounts,startaCurrentReviewCandidateCount:rows.filter(x=>x.evidenceMatrix.startaHistory.status==='CURRENT_REVIEW_CANDIDATE').length,startaCurrentButContinuityRejectedCount:rows.filter(x=>x.evidenceMatrix.startaHistory.status==='CURRENT_REVIEW_CANDIDATE'&&x.evidenceMatrix.startaHistory.historyContinuityAccepted!==true).length,startaCurrentWithoutMarketReferenceCount:rows.filter(x=>x.evidenceMatrix.startaHistory.currentSession&&x.evidenceMatrix.marketReference.available!==true).length,startaNotCurrentCount:rows.filter(x=>x.evidenceMatrix.startaHistory.currentSession!==true).length,bothSupplementalCurrentAndReconciledCount:rows.filter(x=>x.supplementalAgreement.bothReconciledToMarket).length},rows,interpretation:{handoffOnly:true,noAuthoritativeMutation:true,noAutomaticRepair:true,noAutomaticTrustUpgrade:true,noAutomaticConflictResolution:true,supplementalConsensusIsNotAuthority:true,historyContinuityRejectionBlocksAutomaticRepair:true,noCorporateActionOrPriceScaleCauseInferred:true,v17RebuildStillRequired:true,note:'This handoff combines authoritative and supplemental observations into a manual-review matrix. It does not change V17 data, resolve conflicts, or open execution.'}};
write('data/v20/sr-remediation-handoff.json',out);
console.log(JSON.stringify({status:out.status,summary:out.summary,rows:Object.fromEntries(rows.map(x=>[x.symbol,{state:x.triangulationState,market:x.evidenceMatrix.marketReference.price,history50:x.evidenceMatrix.history50.close,yahoo:x.evidenceMatrix.yahooHistory.close,starta:x.evidenceMatrix.startaHistory.close,deltas:x.deltasPct}]))},null,2));
