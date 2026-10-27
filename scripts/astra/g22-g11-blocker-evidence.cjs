'use strict';
const fs=require('node:fs'),path=require('node:path');
function diagnose(h,expected){
 const active=(h.universe?.records||[]).filter(x=>x.active!==false);
 const stats=new Map((h.historyStats||[]).map(x=>[x.ticker,x]));
 const critical=(h.strategyReadiness?.rows||[]).filter(x=>x.productionCritical===true);
 const byTicker=new Map(critical.map(x=>[x.ticker,x]));
 const gaps=[],reasons={};
 for(const x of active){
  const t=x.ticker,s=stats.get(t)||{},p=byTicker.get(t)||{};
  const current=s.currentSessionAvailable===true,ready=p.status==='READY';
  if(current&&ready)continue;
  let reason=!s.symbolVerified?'SYMBOL_UNVERIFIED':!current?'CURRENT_SESSION_PRICE_MISSING':p.reason||'SOURCE_FEATURE_OR_INDICATOR_NOT_READY';
  const y={ticker:t,current,ready,reason,validSessions:s.validSessions||0,lastSession:s.latestValidSession||null,sourceStatus:s.sourceStatus||null,processingStatus:s.processingStatus||null,productionCriticalStatus:p.status||'UNKNOWN',productionCriticalReason:p.reason||'UNKNOWN'};
  gaps.push(y);(reasons[reason]??=[]).push(t);
 }
 const counts={active:active.length,currentCanonical:Number(h.metrics?.currentCanonicalSecurities?.numerator||0),pipelineReady:Number(h.metrics?.decisionPipeline?.pipelineReadySecurities||0)};
 return {schemaVersion:'g22-g11-current-blocker-evidence-1',session:expected,counts,
  missingToCurrent90:Math.max(0,Math.ceil(counts.active*.9)-counts.currentCanonical),
  missingToPipeline80:Math.max(0,Math.ceil(counts.active*.8)-counts.pipelineReady),
  reasons,gaps,automaticPromotion:false,gateChange:false,
  note:'G11 diagnostic snapshot, not a market data repair or certification'};
}
function emit(h,expected,out){
 const report=diagnose(h,expected);
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log('G22_G11_TICKER_DIAGNOSTICS '+JSON.stringify({session:report.session,counts:report.counts,currentShortfall:report.missingToCurrent90,pipelineShortfall:report.missingToPipeline80,reasonCounts:Object.fromEntries(Object.entries(report.reasons).map(([k,v])=>[k,v.length]))}));
 return report;
}
module.exports={diagnose,emit};
