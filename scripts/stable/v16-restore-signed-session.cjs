#!/usr/bin/env node
'use strict';
// Preserve a previously published, immutable SAME-session source snapshot when
// a subsequent live fetch fails. Never authorize a new publication.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const FILES=['data/stable/v15-price-truth.json','data/fetch-status.json','data/market.json'];
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const day=x=>String(x||'').slice(0,10),num=x=>Number(x);
const round2=x=>Math.round((x+Number.EPSILON)*100)/100;
const ticker=x=>String(x||'').toUpperCase().replace(/\.CA$/,'');
const observed=r=>['open','high','low','close','volume'].every(k=>Number.isFinite(num(r?.[k])))
 && num(r.open)>0 && num(r.high)>=Math.max(num(r.open),num(r.close))
 && num(r.low)>0 && num(r.low)<=Math.min(num(r.open),num(r.close)) && num(r.volume)>=0;
const equal=(a,b)=>Math.abs(num(a)-num(b))<=0.000001*Math.max(1,Math.abs(num(a)));
function validateSigned(marker,truth,status,market,failedSession){
 const session=day(marker.sessionDate);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(session)||session!==day(failedSession)
 ||session!==day(marker.expectedSession)||session!==day(truth.expectedSession)
 ||session!==day(status.expectedSession))throw Error('SIGNED_SESSION_IDENTITY_MISMATCH');
 if(marker.final!==true||marker.pagesPublished!==true||marker.sourceReady!==true
 ||marker.executionGrade!==true||truth.ready!==true||truth.executionGrade!==true
 ||status.executionGrade!==true||!market?.rows?.length
 ||num(marker.sourceSessionEvidenceCoveragePct)<90)throw Error('SIGNED_SOURCE_NOT_READY');
 const accepted=num(truth.acceptedRows),rejected=num(truth.rejectedRows),dropped=num(truth.droppedRows||0);
 const input=num(truth.source?.inputRows);
 if(!Number.isInteger(accepted)||accepted<=0||!Number.isInteger(input)||input<=0
 ||!Number.isInteger(rejected)||!Number.isInteger(dropped)||accepted+rejected+dropped!==input
 ||accepted!==num(marker.acceptedRows)||accepted!==num(status.currentSessionRows)
 ||accepted!==num(status.marketRows)||input!==num(status.inputRows)
 ||rejected!==num(status.rejectedCurrentSessionRows)||dropped!==num(status.droppedCurrentSessionRows)
 ||Math.abs(num(status.coveragePct)-round2(100*accepted/input))>0.011
 ||Math.abs(num(status.sourceSessionEvidenceCoveragePct)-num(truth.source?.sourceSessionEvidenceCoveragePct))>0.011
 ||Math.abs(num(marker.sourceSessionEvidenceCoveragePct)-num(truth.source?.sourceSessionEvidenceCoveragePct))>0.011)
 throw Error('SIGNED_SOURCE_COUNTS_INCONSISTENT');
 return {session,accepted,input,coveragePct:num(status.coveragePct)};
}
function verifyHistory(root,market,session,accepted){
 const matched=new Set();
 for(const r of market.rows||[]){
  const t=ticker(r.symbol||r.ticker);
  const quote={...r,close:r.close??r.price??r.last};
  if(!/^[A-Z0-9]{3,8}$/.test(t)||day(r.sourceSessionDate)!==session||!observed(quote))continue;
  let h;try{h=JSON.parse(fs.readFileSync(path.join(root,'data/history',t+'.json'),'utf8'));}catch{continue;}
  // Published canonical histories can have verified ticker identity without ISIN.
  // This is retention only: no new security is admitted or recovered here.
  if(h.symbolVerified!==true||ticker(h.ticker)!==t
    ||(h.isin && !/^EG[A-Z0-9]{9,}$/i.test(String(h.isin))))continue;
  const bar=(h.sessions||[]).find(x=>day(x.date||x.sessionDate)===session);
  if(!bar||!observed(bar))continue;
  if(['open','high','low','close','volume'].every(k=>equal(quote[k],bar[k])))matched.add(t);
 }
 if(matched.size<accepted)throw Error('SIGNED_HISTORY_BAR_MISMATCH_'+matched.size+'_OF_'+accepted);
 return matched.size;
}
function gitJson(sha,p){return JSON.parse(cp.execFileSync('git',['show',sha+':'+p],{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024}));}
function main(){
 const failedTruth=read('data/stable/v15-price-truth.json');
 const failedStatus=read('data/fetch-status.json');
 const marker=read('data/ops/g22-main-app-handoff.json');
 if(failedTruth.ready===true&&failedTruth.executionGrade===true)return console.log('SIGNED_SOURCE_RESTORE_NOT_NEEDED');
 if(day(marker.sessionDate)!==day(failedTruth.expectedSession))return console.log('SIGNED_SOURCE_RESTORE_SKIPPED_DIFFERENT_SESSION');
 const sha=String(marker.canonicalDataHead||'');
 if(!/^[0-9a-f]{40}$/.test(sha))throw Error('SIGNED_CANONICAL_SHA_INVALID');
 const docs=Object.fromEntries(FILES.map(p=>[p,gitJson(sha,p)]));
 const signed=validateSigned(marker,docs[FILES[0]],docs[FILES[1]],docs[FILES[2]],failedTruth.expectedSession);
 const matchingHistory=verifyHistory(ROOT,docs[FILES[2]],signed.session,signed.accepted);
 const failure={schemaVersion:'v16-signed-source-failed-retry-1',generatedAt:new Date().toISOString(),
  expectedSession:day(failedTruth.expectedSession),failedAttempt:{mode:failedStatus.mode||null,
   inputRows:failedStatus.inputRows??null,currentSessionRows:failedStatus.currentSessionRows??null,
   sourceSessionEvidenceCoveragePct:failedStatus.sourceSessionEvidenceCoveragePct??null},
  preservedPublishedSource:{canonicalDataHead:sha,acceptedRows:signed.accepted,
   inputRows:signed.input,coveragePct:signed.coveragePct,matchedCurrentHistoryBars:matchingHistory},
  newPublicationAuthorized:false};
 // All guards complete before any file is modified.
 for(const p of FILES)fs.writeFileSync(path.join(ROOT,p),JSON.stringify(docs[p],null,2)+'\n');
 fs.writeFileSync(path.join(ROOT,'data/stable/v16-source-retry-failure.json'),JSON.stringify(failure,null,2)+'\n');
 console.log('SIGNED_SAME_SESSION_SOURCE_PRESERVED '+JSON.stringify(failure.preservedPublishedSource));
}
if(require.main===module)main();
module.exports={validateSigned,verifyHistory,observed};
