#!/usr/bin/env node
'use strict';
// Incident-forensics only. The live price truth remains FAIL-CLOSED on source failure.
// Older validated Git objects are NEVER a fallback feed or an executable snapshot.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const PRICE='data/stable/v15-price-truth.json';
const HANDOFF='data/ops/g22-main-app-handoff.json';
const OUT=process.env.EGX_AUDIT_OUT||'data/ops/v15-last-accepted-price-truth-audit.json';
function read(file){try{return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'))}catch{return{}}}
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?String(s):null;
function eligible(doc,handoff){
 if(!doc||doc.ready!==true||doc.executionGrade!==true||!iso(doc.expectedSession))return false;
 const minimum=Number(doc.minimumExecutionRows||80);
 if(!Number.isFinite(minimum)||minimum<80)return false;
 // The original validator's technical floor is 80; forensic corroboration uses
 // the independently published acceptedRows and 180 history-file evidence.
 const minimumEvidence=Math.max(180,minimum);
 if(!(doc.acceptedRows>=minimumEvidence&&doc.updatedHistoryFiles>=180))return false;
 if(doc.source?.preciseSource!==true||doc.source?.realFetch!==true)return false;
 if(!(doc.source?.verifiedExpectedSessionRows>=minimumEvidence))return false;
 // Handoff may be absent, but if supplied require independent source/session/count parity.
 if(handoff&&Object.keys(handoff).length){
  if(!(handoff.sourceReady===true&&handoff.currentSessionReady===true
    &&handoff.executionGrade===true&&handoff.final===true
    &&doc.expectedSession===handoff.sessionDate
    &&doc.acceptedRows===handoff.acceptedRows))return false;
 }
 return true;
}
function classify(current,candidate,handoff,commit){
 const currentReady=Boolean(current.ready===true&&current.executionGrade===true);
 const accepted=eligible(candidate,handoff);
 const sameDate=Boolean(accepted&&candidate.expectedSession===current.expectedSession);
 return {schemaVersion:'egx-last-accepted-price-truth-audit-1',createdAt:current.generatedAt||null,
  purpose:'AUDIT_ONLY_NO_TRADING_NO_PRODUCTION_FALLBACK',
  activeDecisionSource:'data/stable/v15-price-truth.json',
  activeFailClosed:!currentReady,
  current:{session:iso(current.expectedSession),ready:currentReady,
   acceptedRows:Number.isFinite(Number(current.acceptedRows))?Number(current.acceptedRows):null,
   sourceSessionVerifiedRows:current.source?.verifiedExpectedSessionRows??null,
   generatedAt:current.generatedAt||null},
  historicalEvidence:accepted?{commit,session:candidate.expectedSession,
   acceptedRows:candidate.acceptedRows,updatedHistoryFiles:candidate.updatedHistoryFiles,
   verifiedExpectedSessionRows:candidate.source.verifiedExpectedSessionRows,
   reportSha256:crypto.createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
   corroboratedWithImmutableHandoff:Boolean(handoff&&Object.keys(handoff).length),
   sameTargetSessionAsFailedAttempt:sameDate}:null,
  needsLicensedData:Boolean(!currentReady),
  executionAllowed:false,producerStatus:'RESEARCH_EVIDENCE_ONLY',
  warning:'Historical success is forensic evidence only; never resurrect stale prices for execution.'};
}
function audit(){
 const current=read(PRICE),handoff=read(HANDOFF);
 let candidate=null,commit=null,scanned=0,reason='NO_VALID_HISTORICAL_GIT_PRICE_TRUTH';
 const anchored=[handoff.canonicalDataHead,handoff.producerHeadSha]
   .filter(x=>/^[a-f0-9]{40}$/.test(String(x||'')));
 const git=(args,timeout=7000)=>cp.spawnSync('git',args,
   {cwd:ROOT,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
 const scan=(hash)=>{
   scanned++;
   let x=git(['show',hash+':'+PRICE],5000);
   if(x.status!==0&&process.env.EGX_AUDIT_FETCH_ANCHOR==='1'&&anchored.includes(hash)){
     // One shallow, exact-SHA fetch: no full repository history necessary.
     const fetch=git(['fetch','--no-tags','--depth=1','origin',hash],25000);
     if(fetch.status===0)x=git(['show',hash+':'+PRICE],5000);
   }
   if(x.status!==0)return false;
   try{
     const d=JSON.parse(x.stdout);
     if(!eligible(d,handoff))return false;
     candidate=d;commit=hash;reason='MATCHED_IMMUTABLE_HANDOFF_ANCHOR';
     return true;
   }catch{return false}
 };
 for(const sha of anchored)if(scan(sha))break;
 if(!candidate){
   const result=git(['log','--max-count=100','--format=%H','--',PRICE],12000);
   if(result.status===0){
     for(const sha of result.stdout.split(/\s+/).filter(x=>/^[a-f0-9]{40}$/.test(x))){
       if(anchored.includes(sha))continue;
       if(scan(sha)){reason='MATCHED_HISTORICAL_VALIDATED_HANDOFF';break}
     }
   }else reason='GIT_HISTORY_NOT_AVAILABLE';
 }
 const out=classify(current,candidate,handoff,commit);
 out.historicalSourceStatus=candidate?reason:reason;
 out.gitHistoryObjectsScanned=scanned;
 const file=path.join(ROOT,OUT);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n','utf8');
 console.log('EGX_PRICE_TRUTH_AUDIT',JSON.stringify({
  currentReady:out.current.ready,currentAccepted:out.current.acceptedRows,
  historicAccepted:out.historicalEvidence?.acceptedRows||0,commit:out.historicalEvidence?.commit||null,
  found:!!candidate,scanned}));
 return out;
}
if(require.main===module)try{audit()}catch(e){console.error(e);process.exitCode=1}
module.exports={eligible,classify,audit};
