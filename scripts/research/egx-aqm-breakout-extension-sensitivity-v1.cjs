'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Development-only AQM sensitivity');
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {computeSignals,replay}=require('./egx-aqm-research-v1.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function diagnose(universe){
 const settings=[1.5,2.5,3.0];
 return {schemaVersion:'egx-aqm-breakout-extension-sensitivity-1',generatedAt:new Date().toISOString(),researchOnly:true,autoPromotionDisabled:true,oneFactor:'breakoutMaxDistanceAtr',unchanged:{minDailyTurnoverEgp:30000000,topMarketRankFraction:0.2,minScore:70,maximumPositions:4},results:settings.map(maxDistanceAtr=>{
  const scan=computeSignals(universe,{liquidityEgp:30000000,marketMode:'technicalDiagnostic',breakoutMaxDistanceAtr:maxDistanceAtr});
  const x=replay(universe,scan.signals,'aqm_breakout');const y=replay(universe,scan.signals,'aqm_pullback');
  return {maxDistanceAtr,rawBreakouts:scan.setupFunnel.rawBreakout,liquidBreakouts:scan.setupFunnel.liquidBreakout,trendBreakouts:scan.setupFunnel.trendQualifiedBreakout,notOverextendedBreakouts:scan.setupFunnel.notOverextendedBreakout,topRankBreakouts:scan.setupFunnel.topRankBreakout,breakoutSignals:scan.signals.filter(a=>a.variant==='aqm_breakout').length,breakout:{returnPct:x.portfolioReturnPct,closedTrades:x.closedTrades,winRatePct:x.winRatePct,maxDrawdownPct:x.maxDrawdownPct,exitReasonCounts:x.tradeLedger.reduce((o,t)=>(o[t.exitReason]=(o[t.exitReason]||0)+1,o),{})},unchangedPullbackCheck:{signals:scan.signals.filter(a=>a.variant==='aqm_pullback').length,returnPct:y.portfolioReturnPct,closedTrades:y.closedTrades}};
 }) ,limitations:['Only exploratory threshold sensitivity on history already examined: NOT untouched out-of-sample evidence','Strict AQM remains blocked because benchmark, financial, corporate-action and halt histories lack as-of certification','Reference stocks and market regime suffer provenance, survivorship and index-benchmark limitations']};
}
if(require.main===module){const d=diagnose(loadUniverse().universe);const output=path.join(root,'data/research/egx-aqm-breakout-extension-sensitivity-v1.json');fs.writeFileSync(output,JSON.stringify(d,null,2)+'\n');console.log(JSON.stringify(d,null,2))}
module.exports={diagnose};
