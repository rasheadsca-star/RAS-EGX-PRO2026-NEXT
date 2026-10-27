#!/usr/bin/env node
'use strict';
// Research-only G11 baseline and ticker-level blockers; reads genuine certified source code.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.resolve(process.env.EGX_RECOVERY_OUT||path.join(ROOT,'artifacts/history-recovery'));
function summarize(h,truth,sources={}){
 const expected=truth.expectedSession||null,actual=h.sessionIntegrity?.latestExpectedSession||null;
 const universe=Number(h.metrics?.activeUniverse?.count||0);
 const canonical=Number(h.metrics?.currentCanonicalSecurities?.numerator||0);
 const pipelineReady=Number(h.metrics?.decisionPipeline?.pipelineReadySecurities||0);
 const minCanonical=Math.ceil(universe*.9),minPipeline=Math.ceil(universe*.8);
 const stats=new Map((h.historyStats||[]).map(x=>[x.ticker,x]));
 const prod=new Map((h.strategyReadiness?.rows||[]).filter(x=>x.productionCritical).map(x=>[x.ticker,x]));
 const sourceMissing=new Set((truth.missingHistoryFiles||[]).map(String));
 const blockReasonCounts={},blockers=[];
 for(const u of h.universe?.records||[]){
  if(!u.active)continue;
  const s=stats.get(u.ticker)||{},p=prod.get(u.ticker)||{};
  const reasons=[];
  if(!s.symbolVerified)reasons.push('IDENTITY_UNVERIFIED');
  if(!s.currentSessionAvailable)reasons.push('CURRENT_CANONICAL_SESSION_MISSING');
  if(s.currentSessionAvailable&&Number(s.validSessions||0)<60)reasons.push('LESS_THAN_60_VALID_SESSIONS');
  if(p.status!=='READY')reasons.push('G11_'+String(p.reason||p.status||'UNKNOWN'));
  if(sourceMissing.has(u.ticker))reasons.push('SOURCE_HISTORY_MISSING');
  if(!reasons.length)continue;
  for(const reason of new Set(reasons))blockReasonCounts[reason]=(blockReasonCounts[reason]||0)+1;
  blockers.push({ticker:u.ticker,companyName:u.companyNameEn||u.companyNameAr||null,
   g11Status:p.status||null,g11Reason:p.reason||null,sourceHistoryMissing:sourceMissing.has(u.ticker),
   historySessions:Number(s.validSessions||0),latestValidSession:s.latestValidSession||null,
   currentSessionAvailable:s.currentSessionAvailable===true,symbolVerified:s.symbolVerified===true,
   reasons:[...new Set(reasons)]});
 }
 blockers.sort((a,b)=>b.reasons.length-a.reasons.length||a.ticker.localeCompare(b.ticker));
 const issueDetails=(h.issues?.issues||[]).map(x=>({code:x.code,severity:x.severity,affectedCount:x.affectedCount,
  affectedTickers:x.affectedTickers||[],summary:x.summary}));
 const missingSearch=issueDetails.find(x=>x.code==='FULL_MARKET_SEARCH_MISSING_SECURITY')?.affectedTickers||[];
 const listingQueue=missingSearch.map(t=>{
  const a=sources.symbolMap?.[t]||{};
  return {ticker:t,companyNameEn:a.companyNameEn||null,companyNameAr:a.companyNameAr||null,
   discoverySources:a.discoverySources||[],identityVerified:a.symbolVerified===true,
   marketRowPresent:(sources.marketTickers||[]).includes(t),
   decision:'REQUIRES_OFFICIAL_LISTING_AND_ALIAS_RECONCILIATION_NO_AUTO_EXCLUSION'};
 });
 return {schemaVersion:'egx-g11-data-recovery-diagnostics-1',generatedAt:new Date().toISOString(),
  mode:'READ_ONLY_CERTIFIED_G11_SHADOW',expectedSession:expected,g11ExpectedSession:actual,
  exactSessionMatch:expected===actual,productionEligible:false,
  metrics:{activeUniverse:universe,currentCanonical:canonical,requiredCanonical:minCanonical,
   canonicalShortfall:Math.max(0,minCanonical-canonical),pipelineReady,requiredPipeline:minPipeline,
   pipelineShortfall:Math.max(0,minPipeline-pipelineReady),
   priceTruthAcceptedRows:truth.acceptedRows??null,priceTruthHistoryUpdated:truth.updatedHistoryFiles??null,
   priceTruthHistoryMissing:truth.missingHistoryFiles?.length??null,
   priceTruthAcceptedVsG11CanonicalDelta:Number.isFinite(Number(truth.acceptedRows))?Number(truth.acceptedRows)-canonical:null,
   productionCriticalReady:Number(h.strategyReadiness?.productionCritical?.readySecurities||0),
   globalTrainingSessions:h.strategyReadiness?.productionCritical?.globalTrainingSessions??null,
   highIssueCount:h.issues?.highUnresolved??null,criticalIssueCount:h.issues?.criticalUnresolved??null,
   pipelineOk:h.pipeline?.ok===true,decisionSnapshotAvailable:Boolean(h.pipeline?.decisionSnapshot)},
  blockedReasons:blockReasonCounts,blockers,issueDetails,unindexedActiveListingReview:listingQueue,
  diagnostics:h.pipeline?.diagnostics||[],
  outputGuarantee:'No canonical prices updated; G11 buildHealth is invoked solely for diagnostic evidence'};
}
function run(){
 const truth=JSON.parse(fs.readFileSync(path.join(ROOT,'data/stable/v15-price-truth.json'),'utf8'));
 const {buildHealth}=require('../../astra/data-health/g11-data-health.cjs');
 const h=buildHealth();
 const symbolMap=JSON.parse(fs.readFileSync(path.join(ROOT,'data/symbol-map.json'),'utf8'));
 const market=JSON.parse(fs.readFileSync(path.join(ROOT,'data/market.json'),'utf8'));
 const doc=summarize(h,truth,{symbolMap,marketTickers:(market.rows||[]).map(x=>String(x.symbol||x.ticker||x.code||'').toUpperCase())});
 fs.mkdirSync(OUT,{recursive:true});
 fs.writeFileSync(path.join(OUT,'g11-ticker-gap-diagnostics.json'),JSON.stringify(doc,null,2)+'\n');
 console.log('EGX_G11_GAP_DIAGNOSTICS',JSON.stringify({session:doc.expectedSession,g11Session:doc.g11ExpectedSession,
  ...doc.metrics,blockedReasons:doc.blockedReasons}));
 if(!doc.exactSessionMatch)process.exitCode=2;
 return doc;
}
if(require.main===module){try{run()}catch(e){console.error('EGX_G11_DIAGNOSTICS_FAILURE',e.stack);process.exitCode=1}}
module.exports={summarize,run};
