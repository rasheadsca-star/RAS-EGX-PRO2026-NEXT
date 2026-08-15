#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fetchTargetedTicker}=require('../history/adapters/starta-targeted-adapter.cjs');
const {sanitizeSessions}=require('./build-trusted-technical-history.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>fs.writeFileSync(P(r),`${JSON.stringify(v,null,2)}\n`,'utf8');
const finite=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=4)=>{const n=finite(v);if(n===null)return null;const p=10**d;return Math.round(n*p)/p};
const safe=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9_-]/g,'');
const hash=r=>crypto.createHash('sha256').update(fs.readFileSync(P(r))).digest('hex');
const protectedFiles=['data/v17/resilient-session-status.json','data/v17/internal-ohlc-support-resistance.json','data/history-50.json','data/v20/current-market-snapshot.json'];
const before=Object.fromEntries(protectedFiles.map(r=>[r,hash(r)]));
const current=read('data/v20/current.json'),tech=read('data/v20/full-market-technical.json'),reg=read('data/v20/full-market-technical-regression.json'),smRaw=read('data/symbol-map.json');
const config=(()=>{try{return read('data/history-targeted-seven-config.json')}catch{return read('data/history-starta-gap-config.json')}})();
const session=current.sessionDate,tol=Number(tech.policy?.currentPriceReconciliationTolerancePct||5),smEntries=Array.isArray(smRaw)?smRaw:Object.values(smRaw||{}),sm=new Map(smEntries.map(x=>[safe(x.ticker),x])),techMap=new Map((tech.symbols||[]).map(x=>[safe(x.ticker),x]));
const targets=(reg.unresolvedReview?.rows||[]).filter(x=>x.primaryReviewState==='INDEPENDENT_CURRENT_MARKET_REFERENCE_REQUIRED').map(x=>safe(x.ticker));
const startaConfig={...config,requestTimeoutMs:7000,retryCount:1,retryBaseDelayMs:200,periodCandidates:['1y'],maximumRowsPerRequest:500,sourceConfidence:Number(config.sourceConfidence||70)};
async function one(ticker){
  const base=techMap.get(ticker)||{},map=sm.get(ticker),yahooCurrent=base.identityVerified===true&&base.asOfSession===session&&finite(base.latestClose)>0?finite(base.latestClose):null;
  let startaCurrent=null,startaIdentity=false,startaError=null,startaRows=0;
  if(map){try{const target={ticker,isin:map.isin||null,companyNameEn:map.companyNameEn||null,companyNameAr:map.companyNameAr||null,periodCandidates:['1y']},f=await fetchTargetedTicker(ticker,map,target,startaConfig),san=sanitizeSessions(f.rows||[],ticker,session),last=(san.rows||[]).at(-1)||null;startaIdentity=f.identity?.verified===true;startaRows=(san.rows||[]).length;if(startaIdentity&&last?.date===session&&finite(last.close)>0)startaCurrent=finite(last.close)}catch(e){startaError=e.message}}
  const candidates=[yahooCurrent!==null?{provider:'YAHOO',close:yahooCurrent}:null,startaCurrent!==null?{provider:'STARTA',close:startaCurrent}:null].filter(Boolean),providers=[...new Set(candidates.map(x=>x.provider))];
  const diff=providers.length>=2?Math.abs(candidates[0].close-candidates[1].close)/Math.max(Math.abs(candidates[0].close),Math.abs(candidates[1].close))*100:null;
  const within=diff!==null&&diff<=tol;
  const state=providers.length>=2?(within?'DUAL_PROVIDER_CURRENT_CLOSE_WITHIN_EXISTING_TOLERANCE':'DUAL_PROVIDER_CURRENT_CLOSE_CONFLICT'):providers.length===1?'SINGLE_PROVIDER_CURRENT_CLOSE_ONLY':'NO_CURRENT_SESSION_PROVIDER_CLOSE';
  return{ticker,state,candidates,providerCount:providers.length,differencePct:round(diff,3),diagnosticTolerancePct:tol,withinExistingReconciliationTolerance:within,manualReferenceReviewCandidate:within,currentMarketReferenceAuthoritative:false,autoFillCurrentMarketPriceAllowed:false,causeVerified:false,corporateActionInferred:false,usedForDecisionScore:false,usedForExecutionGate:false,usedForProductionAllocation:false,startaDiagnostics:{identityVerified:startaIdentity,currentSessionClose:startaCurrent,rows:startaRows,error:startaError},selectedTechnicalEvidence:{sourceKind:base.sourceKind||null,asOfSession:base.asOfSession||null,identityVerified:base.identityVerified===true,latestClose:finite(base.latestClose)}}
}
async function main(){const rows=[];for(const t of targets)rows.push(await one(t));const counts=rows.reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{}),after=Object.fromEntries(protectedFiles.map(r=>[r,hash(r)])),unchanged=protectedFiles.every(r=>before[r]===after[r]);const out={schemaVersion:'20.0.0-current-reference-candidate-audit-1',generatedAt:new Date().toISOString(),sessionDate:session,status:'MANUAL_CURRENT_REFERENCE_REVIEW_RESEARCH_ONLY',targetCount:rows.length,stateCounts:counts,manualReferenceReviewCandidateCount:rows.filter(x=>x.manualReferenceReviewCandidate).length,policy:{diagnosticOnly:true,existingReconciliationTolerancePct:tol,authoritativeCurrentMarketReference:false,autoFillCurrentMarketPriceAllowed:false,causeInferenceAllowed:false,corporateActionInferenceAllowed:false,usedForDecisionScore:false,usedForExecutionGate:false,usedForProductionAllocation:false},inputIntegrity:{unchanged,hashes:before},rows};write('data/v20/current-reference-candidate-audit.json',out);console.log(JSON.stringify({targetCount:out.targetCount,stateCounts:out.stateCounts,manualReferenceReviewCandidateCount:out.manualReferenceReviewCandidateCount,inputIntegrityUnchanged:unchanged},null,2));if(!unchanged)process.exitCode=1}
main().catch(e=>{console.error(e.stack||e.message);process.exit(1)});
