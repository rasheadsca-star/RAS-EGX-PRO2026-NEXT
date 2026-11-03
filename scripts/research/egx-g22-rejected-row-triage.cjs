#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
function build(truth,marker){
 const rejected=Array.isArray(truth.sampleRejected)?truth.sampleRejected:[];
 const missing=new Set(truth.missingHistoryFiles||[]);
 const byReason={};const rows=rejected.map(x=>{
  const reason=String(x.reason||'UNKNOWN');
  byReason[reason]=(byReason[reason]||0)+1;
  const action=reason==='SOURCE_SESSION_MISMATCH'?'GET_EXACT_DATE_2026_10_27_FROM_INDEPENDENT_SOURCE':
   reason==='SOURCE_SESSION_UNKNOWN'?'ESTABLISH_PRIMARY_SOURCE_SESSION_EVIDENCE':
   reason==='EXTREME_JUMP_REQUIRES_SECOND_SOURCE'?'CONFIRM_CORPORATE_ACTION_AND_SECOND_PRICE_SOURCE':
   reason==='REPORTED_CHANGE_MISMATCH'?'VERIFY_FULL_PRECISION_CLOSE_PREVIOUS_CLOSE_AND_CHANGE_FROM_INDEPENDENT_SOURCE':
   'MANUAL_EVIDENCE_REVIEW';
  return {ticker:x.ticker,reason,sourceSession:x.sourceSessionDate||null,close:x.close??null,
   reportedChangePct:x.reportedChangePct??null,impliedChangePct:x.impliedChangePct??null,
   historyMissing:missing.has(x.ticker),requiredAction:action,certified:false,autoPromote:false};
 });
 const accepted=Number(truth.acceptedRows)||0,minimum=200;
 return {schemaVersion:'egx-g22-rejected-recovery-1',expectedSession:truth.expectedSession,acceptedRows:accepted,
  acceptedShortfall:Math.max(0,minimum-accepted),rejectedRowsCount:rejected.length,
  missingHistoryCount:missing.size,rejectedAndMissingOverlap:rows.filter(x=>x.historyMissing).length,
  reasons:byReason,rows,eligibility:'BLOCKED_NO_UNVERIFIED_PROMOTION',thresholdUnchanged:true};
}
if(require.main===module){try{const root=process.env.GITHUB_WORKSPACE||process.cwd(),read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
 const result=build(read('data/stable/v15-price-truth.json'),read('data/ops/g22-main-app-handoff.json'));
 const out=path.join(root,'artifacts/history-recovery/g22-rejected-row-triage.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log('G22_REJECTED_REMEDIATION',JSON.stringify({shortfall:result.acceptedShortfall,rejected:result.rejectedRowsCount,overlap:result.rejectedAndMissingOverlap,reasons:result.reasons}));}catch(e){console.error(e);process.exitCode=2}}
module.exports={build};
