#!/usr/bin/env node
'use strict';
// Research crosswalk: exact historical market source vs persistent G11 gaps.
// Zero price promotions. Session accepted previously does NOT certify each individual row.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {focusFromPersistent}=require('./egx-recovery-focus.cjs');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.resolve(process.env.EGX_RECOVERY_OUT||path.join(ROOT,'artifacts/history-recovery'));
const get=p=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return{}}};
function gitBlob(sha,p){
 if(!/^[a-f0-9]{40}$/.test(String(sha||'')))throw Error('Invalid pinned Git SHA');
 const run=args=>cp.spawnSync('git',args,{cwd:ROOT,encoding:'utf8',timeout:22000,maxBuffer:8*1024*1024});
 let x=run(['show',sha+':'+p]);
 if(x.status!==0){
  if(process.env.EGX_AUDIT_FETCH_ANCHOR==='1'){
   const f=run(['fetch','--depth=1','--no-tags','origin',sha]);
   if(f.status!==0)throw Error('Pinned Git commit fetch not available');
   x=run(['show',sha+':'+p]);
  }
 }
 if(x.status!==0)throw Error('Pinned market artifact cannot be verified');
 return JSON.parse(x.stdout);
}
function candle(x,date){
 if(String(x?.sourceSessionDate||'').slice(0,10)!==date)return null;
 const o=Number(x.open),h=Number(x.high),l=Number(x.low),c=Number(x.last??x.price??x.close),v=Number(x.volume);
 if(![o,h,l,c,v].every(Number.isFinite))return null;
 if(!(o>0&&h>0&&l>0&&c>0&&h>=Math.max(o,c)&&l<=Math.min(o,c)&&v>=0&&Number.isInteger(v)))return null;
 const quality={open:o,high:h,low:l,close:c,volume:v};
 return quality;
}
function analyze({handoff,originalMarket,originalTruth,currentTruth,historySummary,symbolMap}){
 if(!(handoff?.final===true&&handoff.executionGrade===true&&handoff.sourceReady===true))throw Error('G22 handoff not certified');
 const expected=handoff.sessionDate;
 if(!(originalTruth?.ready===true&&originalTruth.executionGrade===true&&originalTruth.expectedSession===expected
  &&originalTruth.acceptedRows===handoff.acceptedRows
  &&originalTruth.updatedHistoryFiles>=180))throw Error('Pinned original price truth does not match signed G22 handoff');
 const focus=focusFromPersistent({truth:currentTruth,historySummary,symbolMap,expectedSession:expected});
 const by=new Map((originalMarket.rows||[]).filter(x=>x?.symbol||x?.ticker)
  .map(x=>[String(x.symbol||x.ticker).toUpperCase(),x]));
 const rejected=new Map((originalTruth.sampleRejected||[]).filter(x=>x?.ticker)
  .map(x=>[String(x.ticker).toUpperCase(),x]));
 const acceptedSample=new Set((originalTruth.sampleAccepted||[]).filter(x=>x?.ticker).map(x=>x.ticker.toUpperCase()));
 const records=[];
 for(const f of focus){
  const raw=by.get(f.ticker),date=String(raw?.sourceSessionDate||'').slice(0,10);
  const bar=candle(raw,expected),r=rejected.get(f.ticker);
  let status=bar?'PINNED_DATED_OHLCV_RESEARCH_ONLY':
   date===expected?'PINNED_DATE_INVALID_OR_INCOMPLETE_OHLCV':'NO_CERTIFIABLE_SAME_SESSION_ROW';
  if(r)status='PRICE_TRUTH_REJECTED_NEEDS_INDEPENDENT_CAUSE_REVIEW';
  const hmac=bar?crypto.createHash('sha256').update(JSON.stringify([f.ticker,expected,bar,raw?.sourceUrl||null])).digest('hex'):null;
  records.push({ticker:f.ticker,historyBars:f.historySessions,currentHistoryLastSession:f.lastSession,
   targetSession:expected,sourceSessionDate:date||null,source:raw?.source||null,
   sourceEvidence:raw?.sourceSessionEvidence||null,sourceURL:raw?.sourceUrl||null,
   ohlcv:bar,ohlcvSha256:hmac,
   sampleAccepted:acceptedSample.has(f.ticker),sampleRejectedReason:r?.reason||null,
   classification:status,identityNeedsReview:f.reasons.includes('UNVERIFIED_HISTORY_SYMBOL_IDENTITY'),
   missingOriginalHistory:f.reasons.includes('NO_HISTORIC_BARS'),
   promotionApproved:false,
   requiredAction:r?'RESOLVE_REJECTION_AND_CORPORATE_ACTION_WITH_INDEPENDENT_SOURCE':
    bar?'VERIFY_SECURITY_IDENTITY_ISIN_CURRENCY_CORPORATE_ACTION_AND_60_SESSIONS':
    'GET_LICENSED_OR_OFFICIAL_DATED_OHLCV'});
 }
 const counts={focus:focus.length,pinnedComplete:records.filter(x=>x.ohlcv!==null).length,
  pinnedNotRejected:records.filter(x=>x.ohlcv!==null&&!x.sampleRejectedReason).length,
  pinnedRejected:records.filter(x=>!!x.sampleRejectedReason).length,
  withoutAnyHistoryButDated:records.filter(x=>x.ohlcv&&x.missingOriginalHistory).length,
  hasExistingHistoryDated:records.filter(x=>x.ohlcv&&x.historyBars>=60).length,
  under60Dated:records.filter(x=>x.ohlcv&&x.historyBars>0&&x.historyBars<60).length,
  noExactCompletedCandles:records.filter(x=>!x.ohlcv).length,automaticallyPromoted:0};
 return {schemaVersion:'egx-pinned-20261026-gap-evidence-1',handoffSession:expected,
  anchoredGitCommit:handoff.canonicalDataHead,anchoredAcceptedRows:handoff.acceptedRows,
  researchOnly:true,tradingAllowed:false,counts,records,
  warning:'Published snapshot row matching is not per-ticker accepted proof. No source is rescued into live history.'};
}
function main(){
 const handoff=get('data/ops/g22-main-app-handoff.json');
 const sha=handoff?.canonicalDataHead;
 const report=analyze({
   handoff,originalMarket:gitBlob(sha,'data/market.json'),
   originalTruth:gitBlob(sha,'data/stable/v15-price-truth.json'),
   currentTruth:get('data/stable/v15-price-truth.json'),
   historySummary:get('data/history-summary.json'),
   symbolMap:get('data/symbol-map.json')
 });
 fs.mkdirSync(OUT,{recursive:true});
 fs.writeFileSync(path.join(OUT,'pinned-20261026-gap-crosswalk.json'),JSON.stringify(report,null,2)+'\n');
 console.log('EGX_PINNED_SESSION_GAP_CROSSWALK',JSON.stringify(report.counts));
 return report;
}
if(require.main===module)try{main()}catch(e){console.error(e);process.exitCode=1}
module.exports={analyze,candle,main};
