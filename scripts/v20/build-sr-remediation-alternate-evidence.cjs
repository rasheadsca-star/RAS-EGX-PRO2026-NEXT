#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {fetchTargetedTicker,evaluateSparseEvidence}=require('../history/adapters/starta-targeted-adapter.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return f}};
const write=(r,v)=>{const file=P(r);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const finite=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=4)=>{const n=finite(v);if(n===null)return null;const p=10**d;return Math.round(n*p)/p};
const safe=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9_-]/g,'');
const uniq=a=>[...new Set((a||[]).filter(Boolean).map(String))];
const PROTECTED=['data/v17/resilient-session-status.json','data/v17/internal-ohlc-support-resistance.json','data/history-50.json'];
const CONCURRENCY=Math.max(1,Math.min(4,Number(process.env.V20_SR_STARTA_CONCURRENCY||3)));
const PRICE_TOLERANCE_PCT=Number(process.env.V20_SR_STARTA_PRICE_TOLERANCE_PCT||5);
function sha(rel){return crypto.createHash('sha256').update(fs.readFileSync(P(rel))).digest('hex')}
function hashes(){return Object.fromEntries(PROTECTED.map(rel=>[rel,sha(rel)]))}
function validOhlc(r){return finite(r?.open)>0&&finite(r?.high)>0&&finite(r?.low)>0&&finite(r?.close)>0&&finite(r.high)>=Math.max(finite(r.open),finite(r.close),finite(r.low))&&finite(r.low)<=Math.min(finite(r.open),finite(r.close),finite(r.high))}
function h50Rows(doc,symbol,session){const hit=Object.entries(doc?.symbols||{}).find(([k])=>safe(k)===safe(symbol));return (Array.isArray(hit?.[1])?hit[1]:[]).filter(r=>String(r?.date||'')<=session&&validOhlc(r)).map(r=>({date:String(r.date),open:finite(r.open),high:finite(r.high),low:finite(r.low),close:finite(r.close),volume:finite(r.volume)}))}
function mapPool(items,worker,n){const out=Array(items.length);let cursor=0;async function run(){for(;;){const i=cursor++;if(i>=items.length)return;out[i]=await worker(items[i],i)}}return Promise.all(Array.from({length:Math.min(n,items.length||1)},run)).then(()=>out)}
function diffPct(a,b){const x=finite(a),y=finite(b);return x>0&&y>0?Math.abs(x-y)/x*100:null}

async function main(){
  const before=hashes();
  const packet=read('data/v20/sr-remediation-review-packet.json');
  const audit=read('data/v20/sr-remediation-audit.json');
  const symbolMap=read('data/symbol-map.json',{});
  const history50=read('data/history-50.json',{symbols:{}});
  const baseConfig=read('data/history-targeted-seven-config.json',read('data/history-starta-gap-config.json',{}))||{};
  if(packet?.schemaVersion!=='20.0.0-sr-remediation-review-packet-1')throw new Error('Review packet missing or incompatible');
  const session=packet.sessionDate;
  const auditMap=new Map((audit.targets||audit.symbols||[]).map(x=>[safe(x.symbol),x]));
  const configuredTargets=new Map([...(baseConfig.targets||[]),...((read('data/history-starta-gap-config.json',{})||{}).targets||[])].map(x=>[safe(x.ticker),x]));
  const targets=(packet.rows||[]).filter(x=>x.cleanSupplementalCandidate!==true);
  const config={...baseConfig,requestTimeoutMs:Number(process.env.V20_SR_STARTA_TIMEOUT_MS||7000),retryCount:1,retryBaseDelayMs:200,periodCandidates:['1y'],maximumRowsPerRequest:500,sourceConfidence:Number(baseConfig.sourceConfidence||70)};
  const rows=await mapPool(targets,async review=>{
    const symbol=safe(review.symbol),auditRow=auditMap.get(symbol)||{},mapEntry=symbolMap[symbol]||null,specific=configuredTargets.get(symbol)||{};
    const target={ticker:symbol,isin:specific.isin||mapEntry?.isin||null,companyNameEn:specific.companyNameEn||mapEntry?.companyNameEn||null,companyNameAr:specific.companyNameAr||mapEntry?.companyNameAr||null,periodCandidates:['1y']};
    const currentPrice=finite(auditRow.currentMarket?.price),authRows=h50Rows(history50,symbol,session);
    const result={symbol,reviewState:review.reviewState,reviewPriority:review.reviewPriority,source:'STARTA',sourceRole:'SECONDARY_SUPPLEMENTAL_TRIANGULATION_ONLY',status:'UNAVAILABLE',identityVerified:false,currentSession:false,currentSessionOhlc:null,currentPrice,currentPriceDifferencePct:null,priceReconciled:false,priceTolerancePct:PRICE_TOLERANCE_PCT,acceptedRowCount:0,latestSession:null,historyContinuity:{accepted:false,method:null},yahooComparison:{status:'NOT_COMPARABLE',closeDifferencePct:null},trustedForV17Execution:false,executionEligible:false,automaticTrustUpgrade:false,automaticConflictResolution:false,usedForDecisionScore:false,usedForExecutionGate:false,usedForProductionAllocation:false,diagnostics:[],error:null};
    if(!mapEntry){result.status='SYMBOL_MAP_ENTRY_MISSING';return result}
    try{
      const fetched=await fetchTargetedTicker(symbol,mapEntry,target,config);
      result.identityVerified=fetched.identity?.verified===true;
      result.identity={exactSymbol:fetched.identity?.exactSymbol===true,egxMarket:fetched.identity?.egxMarket===true,nameAccepted:fetched.identity?.nameAccepted===true,exactIsin:fetched.identity?.exactIsin===true,isinAccepted:fetched.identity?.isinAccepted===true,nameSimilarity:finite(fetched.identity?.nameSimilarity),warnings:fetched.identity?.warnings||[],providerLastPrice:finite(fetched.identity?.identity?.lastPrice),providerNameEn:fetched.identity?.identity?.nameEn||null,providerIsin:fetched.identity?.identity?.isin||null};
      const valid=(fetched.rows||[]).filter(r=>String(r?.date||'')<=session&&validOhlc(r)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const current=valid.find(r=>String(r.date)===session)||null,last=valid.at(-1)||null,diff=diffPct(currentPrice,current?.close),reconciled=diff!==null&&diff<=PRICE_TOLERANCE_PCT;
      const continuity=evaluateSparseEvidence(authRows,valid,fetched.identity,config);
      const yahoo=auditRow.supplementalCandidate||{},yahooClose=finite(yahoo.currentSessionOhlc?.close),crossDiff=diffPct(yahooClose,current?.close);
      let comparison='NOT_COMPARABLE';if(yahooClose>0&&finite(current?.close)>0){if(yahoo.priceReconciled===true&&reconciled)comparison='BOTH_SUPPLEMENTAL_SOURCES_RECONCILED_TO_CURRENT_REFERENCE';else if(reconciled)comparison='STARTA_RECONCILED_YAHOO_NOT_RECONCILED';else if(yahoo.priceReconciled===true)comparison='YAHOO_RECONCILED_STARTA_NOT_RECONCILED';else comparison='NEITHER_SUPPLEMENTAL_SOURCE_RECONCILED'}
      Object.assign(result,{status:result.identityVerified&&current&&reconciled?'CURRENT_REVIEW_CANDIDATE':'SUPPLEMENTAL_EVIDENCE_INCOMPLETE',currentSession:!!current,currentSessionOhlc:current?{open:finite(current.open),high:finite(current.high),low:finite(current.low),close:finite(current.close),volume:finite(current.volume),valid:validOhlc(current),sourceUrl:current.sourceUrls?.primary||null}:null,currentPriceDifferencePct:round(diff,3),priceReconciled:reconciled,acceptedRowCount:valid.length,latestSession:last?.date||null,historyContinuity:{accepted:continuity.accepted===true,method:continuity.method||null,exact:continuity.exact||null,shifted:continuity.shifted||null,bridge:continuity.bridge||null},yahooComparison:{status:comparison,closeDifferencePct:round(crossDiff,3),yahooCurrentClose:yahooClose,startaCurrentClose:finite(current?.close)},diagnostics:(fetched.diagnostics||[]).map(x=>({status:x.status,url:x.url,attempt:x.attempt,bytes:x.bytes})),fetchErrors:fetched.fetchErrors||[]});
    }catch(error){result.status='FETCH_FAILED';result.error=error.message;result.errorDetails=error.details||null}
    return result;
  },CONCURRENCY);
  const after=hashes(),unchanged=PROTECTED.every(rel=>before[rel]===after[rel]);if(!unchanged)throw new Error('Protected V17/history-50 mutation detected during Starta triangulation');
  const out={schemaVersion:'20.0.0-sr-remediation-alternate-evidence-1',generatedAt:new Date().toISOString(),sessionDate:session,status:'SECONDARY_SUPPLEMENTAL_TRIANGULATION_RESEARCH_ONLY',provider:'STARTA',sourceRole:'SECONDARY_SUPPLEMENTAL_TRIANGULATION_ONLY',readOnly:true,automaticV17MutationAllowed:false,automaticTrustUpgradeAllowed:false,automaticConflictResolutionAllowed:false,guaranteesExecutionGrade:false,priceTolerancePct:PRICE_TOLERANCE_PCT,inputIntegrity:{protectedInputs:PROTECTED,before,after,unchanged},summary:{targetCount:rows.length,fetchedCount:rows.filter(x=>x.status!=='FETCH_FAILED'&&x.status!=='UNAVAILABLE'&&x.status!=='SYMBOL_MAP_ENTRY_MISSING').length,currentReviewCandidateCount:rows.filter(x=>x.status==='CURRENT_REVIEW_CANDIDATE').length,currentSessionCount:rows.filter(x=>x.currentSession).length,priceReconciledCount:rows.filter(x=>x.priceReconciled).length,historyContinuityAcceptedCount:rows.filter(x=>x.historyContinuity?.accepted).length,fetchFailedCount:rows.filter(x=>x.status==='FETCH_FAILED').length,bothSupplementalReconciledCount:rows.filter(x=>x.yahooComparison?.status==='BOTH_SUPPLEMENTAL_SOURCES_RECONCILED_TO_CURRENT_REFERENCE').length,startaOnlyReconciledCount:rows.filter(x=>x.yahooComparison?.status==='STARTA_RECONCILED_YAHOO_NOT_RECONCILED').length,yahooOnlyReconciledCount:rows.filter(x=>x.yahooComparison?.status==='YAHOO_RECONCILED_STARTA_NOT_RECONCILED').length},rows,interpretation:{triangulationOnly:true,startaIsNotV17TrustedExecutionEvidence:true,currentReviewCandidateDoesNotResolveV17Blocker:true,providerAgreementDoesNotOpenExecution:true,noAutomaticCorporateActionOrAdjustmentInference:true,manualV17ReviewStillRequired:true,note:'Starta is used only as a second supplemental source for the current remediation targets. Its evidence never mutates history-50 or V17, never resolves AFMC automatically, and never opens Execution Grade.'}};
  write('data/v20/sr-remediation-alternate-evidence.json',out);
  console.log(JSON.stringify({status:out.status,summary:out.summary,rows:Object.fromEntries(rows.map(x=>[x.symbol,{status:x.status,current:x.currentSession,reconciled:x.priceReconciled,continuity:x.historyContinuity?.accepted,yahooComparison:x.yahooComparison?.status}]))},null,2));
}
main().catch(error=>{console.error(error.stack||error.message);process.exit(1)});
