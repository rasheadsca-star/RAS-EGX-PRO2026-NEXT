#!/usr/bin/env node
'use strict';
// Read-only gap state ledger: no prices are created, changed, or promoted.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function gitJson(root,ref,file){try{return JSON.parse(cp.execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'}))}catch{return null}}

function build(truth,summary,prior={}){
 if(!truth||typeof truth.expectedSession!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(truth.expectedSession))throw Error('MISSING_EXACT_PRICE_SESSION');
 if(!Array.isArray(truth.missingHistoryFiles))throw Error('MISSING_EXPLICIT_HISTORY_GAPS');
 const unique=[...new Set(truth.missingHistoryFiles.map(x=>String(x).toUpperCase()))].sort();
 if(unique.length!==truth.missingHistoryFiles.length)throw Error('DUPLICATE_MISSING_TICKERS');
 const history=new Map((summary?.symbols||[]).map(x=>[String(x.ticker||'').toUpperCase(),x]));
 const old=new Map((prior.records||[]).map(x=>[x.ticker,x]));
 const records=unique.map(t=>{
  const h=history.get(t)||{},p=old.get(t);
  const consecutive=p&&p.lastObservedSession===truth.expectedSession?Number(p.consecutiveObservedSessions||1):p&&p.lastObservedSession<truth.expectedSession?Number(p.consecutiveObservedSessions||0)+1:1;
  return {ticker:t,firstObservedSession:p?.firstObservedSession||truth.expectedSession,lastObservedSession:truth.expectedSession,
   consecutiveObservedSessions:consecutive,lastHistorySession:h.lastSession||null,availableSessions:h.availableSessions??null,
   symbolVerified:h.symbolVerified===true,status:'SOURCE_GAP_UNRESOLVED',
   recoveryClass:!h.symbolVerified&&Number(h.availableSessions||0)===0?'ZERO_HISTORY_IDENTITY_UNVERIFIED':!h.symbolVerified?'IDENTITY_UNVERIFIED':Number(h.availableSessions||0)===0?'ZERO_HISTORY_VERIFIED_IDENTITY':'CURRENT_SESSION_OR_SOURCE_GAP',
   nextAction:!h.symbolVerified?'VERIFY_EXCHANGE_SECURITY_IDENTITY_BEFORE_ANY_OHLCV_PROMOTION':'FETCH_INDEPENDENT_OHLCV_AND_VALIDATE_SESSION_CORPORATE_ACTIONS',
   eligibleForTrading:false};
 });
 const recovered=(prior.records||[]).filter(x=>!unique.includes(x.ticker)).map(x=>({ticker:x.ticker,previousStatus:x.status,status:'NO_LONGER_MISSING_IN_PRICE_TRUTH_NOT_YET_CERTIFIED',lastObservedSession:x.lastObservedSession}));
 return {schemaVersion:'egx-daily-gap-watch-1',session:truth.expectedSession,generatedAt:new Date().toISOString(),input:{acceptedRows:truth.acceptedRows??null,rejectedRows:truth.rejectedRows??null,missingHistoryCount:unique.length},records,recovered,unresolvedCount:records.length,productionEligibility:false,note:'A ticker leaving the missing list is NOT certified recovered; this file never mutates canonical data'};
}
function main(){
 const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd()),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
 const out=path.resolve(root,process.env.EGX_RECOVERY_OUT||'artifacts/history-recovery'),priorPath=path.join(out,'daily-gap-watch.json');
 const prior=fs.existsSync(priorPath)?JSON.parse(fs.readFileSync(priorPath,'utf8')):{};
 const source=process.env.EGX_MARKET_REF||null;
 const truth=source?gitJson(root,source,'data/stable/v15-price-truth.json'):read('data/stable/v15-price-truth.json');
 const summary=source?gitJson(root,source,'data/history-summary.json'):read('data/history-summary.json');
 if(!truth||!summary)throw Error('MARKET_SOURCE_EVIDENCE_MISSING');
 const doc=build(truth,summary,prior);
 if(prior.session&&prior.session>doc.session)throw Error('SESSION_REGRESSION');
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(priorPath,JSON.stringify(doc,null,2)+'\n');
 console.log(JSON.stringify({session:doc.session,unresolved:doc.unresolvedCount,recoveredNotCertified:doc.recovered.length}));
}
if(require.main===module){try{main()}catch(e){console.error(e.message);process.exitCode=2}}
module.exports={build};
