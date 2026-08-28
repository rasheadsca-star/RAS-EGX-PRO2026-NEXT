#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const OUT_DIR=path.join(__dirname,'data');
const OUT=path.join(OUT_DIR,'current.json');
const MIN_BARS=60;
// GANN's current volume ratio = current session / average of the PRIOR 20 sessions.
// Therefore 21 real volume observations are required to prevent Unknown -> 0 bias.
const VOLUME_WINDOW=21;
const Fusion=require(path.join(ROOT,'gann-fusion-x','engine','fusion.js'));
const Planner=require(path.join(ROOT,'gann-fusion-x','engine','planner.js'));
const Sepa=require(path.join(ROOT,'gann-fusion-x','engine','sepa-adapter.js'));
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const num=v=>finite(v)?Number(v):null;
const ticker=x=>String(x||'').trim().toUpperCase();
const dateOf=x=>x?.marketDate||x?.sessionDate||x?.marketSession||x?.meta?.marketSession||x?.analysisSession||null;
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const uniq=a=>[...new Set(a)];
const rawSessions=doc=>Array.isArray(doc?.sessions)?doc.sessions:[];
function normalizedBars(doc,marketDate){
  return rawSessions(doc).filter(r=>r&&r.date&&(!marketDate||String(r.date)<=String(marketDate))).sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(r=>{
    const close=num(r.close),adjusted=num(r.adjustedClose??r.close),factor=close&&adjusted?adjusted/close:1;
    return {date:String(r.date),open:num(r.open)===null?null:num(r.open)*factor,high:num(r.high)===null?null:num(r.high)*factor,low:num(r.low)===null?null:num(r.low)*factor,close:adjusted,volume:num(r.volume)};
  });
}
function assessHistory(t,marketDate,summaryRow,stock){
  const reasons=[];
  if(!summaryRow)reasons.push('HISTORY_SUMMARY_MISSING');
  if(summaryRow?.symbolVerified!==true)reasons.push('SYMBOL_IDENTITY_NOT_VERIFIED');
  if(summaryRow?.staleData===true)reasons.push('STALE_DATA_FLAG');
  if(summaryRow?.updateFailed===true||String(summaryRow?.processingStatus||'').toLowerCase()==='failed')reasons.push('UPDATE_FAILED');
  if(stock?.historyAvailable===false)reasons.push('HISTORY_NOT_AVAILABLE_FLAG');
  if(finite(summaryRow?.availableSessions)&&Number(summaryRow.availableSessions)<MIN_BARS)reasons.push('INSUFFICIENT_HISTORY');
  if(marketDate&&summaryRow?.lastSession&&String(summaryRow.lastSession)!==String(marketDate))reasons.push('SESSION_BEHIND_REFERENCE');
  const doc=read(path.join(ROOT,'data','history',`${t}.json`));
  if(!doc)return {ready:false,reasons:uniq([...reasons,'HISTORY_FILE_MISSING']),sessions:0,lastSession:null,bars:[]};
  const bars=normalizedBars(doc,marketDate);
  if(bars.length<MIN_BARS)reasons.push('INSUFFICIENT_HISTORY');
  const last=bars.at(-1)?.date||doc.lastSession||null;
  if(!marketDate||String(last)!==String(marketDate))reasons.push('SESSION_BEHIND_REFERENCE');
  const window=bars.slice(-VOLUME_WINDOW);
  if(window.length<VOLUME_WINDOW)reasons.push('INSUFFICIENT_LIQUIDITY_WINDOW');
  if(window.some(r=>![r.open,r.high,r.low,r.close].every(finite)))reasons.push('OHLC_INCOMPLETE');
  if(window.some(r=>!finite(r.volume)))reasons.push('VOLUME_MISSING');
  const finalReasons=uniq(reasons);
  return {ready:finalReasons.length===0,reasons:finalReasons,sessions:bars.length,lastSession:last,bars,missingDataPolicy:'UNKNOWN_NEVER_ZERO'};
}
function benchmark(prepared,marketDate){
  const dates=new Map();
  for(const item of prepared){
    const bs=item.bars;if(bs.length<MIN_BARS||bs.at(-1)?.date!==marketDate)continue;
    const base=bs[0].close;if(!finite(base)||base<=0)continue;
    for(const b of bs){if(!finite(b.close)||b.close<=0)continue;if(!dates.has(b.date))dates.set(b.date,[]);dates.get(b.date).push(b.close/base*100)}
  }
  return [...dates.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,values])=>{const c=values.reduce((s,v)=>s+v,0)/values.length;return{date,open:c,high:c,low:c,close:c,volume:1}});
}
function currentGannRows(stocks,readiness,marketDate,sepaRaw){
  if(!marketDate)return {rows:[],analyzed:0,actionable:0};
  const sepa=Sepa.normalize(sepaRaw||{}),stockByTicker=new Map(stocks.map(s=>[ticker(s.ticker||s.symbol),s]));
  const prepared=Object.entries(readiness).filter(([,r])=>r.ready).map(([t,r])=>({ticker:t,stock:stockByTicker.get(t)||{},bars:r.bars})).filter(x=>x.bars.length>=MIN_BARS);
  const marketBars=benchmark(prepared,marketDate),actionable=[];let analyzed=0;
  for(const item of prepared){
    const s=item.stock,t=item.ticker,ev=sepa?.byTicker?.[t],fund=ev?{score:ev.qualityScore,verified:Boolean(ev.fundamentals?.verified)}:{score:50,verified:false};
    const a=Fusion.analyze({ticker:t,nameAr:s.companyNameAr||t,bars:item.bars,marketBars,fundamentals:fund,dataQuality:{fresh:true,conflict:false}});
    if(!a.valid)continue;analyzed++;
    const lp=num(s.liquidityPercentile);
    a.marketMeta={technicalRank:s.technicalRank,liquidityPercentile:lp,riskScore:s.riskScore,riskLabelAr:s.riskLabelAr,moneyFlowQualityScore:s.momentumMoneyFlow?.moneyFlowQualityScore};
    a.sepaEvidence=ev||null;
    const p=Planner.buildPlan(a,'speculative',{portfolioValue:100000,riskPct:.5,verifiedFundamentals:Boolean(ev?.fundamentals?.verified)});
    if(p?.decision?.code!=='ACTIONABLE')continue;
    actionable.push({ticker:t,decision:'ACTIONABLE',score:round(p.rankScore??p.score,2),horizonScore:round(p.horizonScore??p.score,2),executionQuality:round(p.executionQuality,2),executionTier:p.executionTier||null,activationPrice:round(p.levels?.trigger??p.levels?.entryHigh,4),rankRaw:p.rankScore??p.score??0});
  }
  actionable.sort((a,b)=>Number(b.rankRaw)-Number(a.rankRaw)||a.ticker.localeCompare(b.ticker));
  return {rows:actionable.slice(0,5).map((x,i)=>{const {rankRaw,...rest}=x;return{...rest,rank:i+1}}),analyzed,actionable:actionable.length};
}
function normalizeSource(enabled,rows,getTicker,getDecision,getScore){
  if(!enabled)return [];
  return (Array.isArray(rows)?rows:[]).map((x,i)=>({ticker:ticker(getTicker(x)),rank:Number(x.rank||i+1),decision:getDecision(x),score:getScore(x),raw:x})).filter(x=>x.ticker);
}
function main(){
  const market=read(path.join(ROOT,'data','quant','market-search-index-v13-17.json'),{}),marketDate=dateOf(market),stocks=Array.isArray(market.stocks)?market.stocks:[];
  const historySummary=read(path.join(ROOT,'data','history-summary.json'),{}),summaryMap=new Map((historySummary?.symbols||[]).map(x=>[ticker(x.ticker),x]));
  const readiness={},reasonCounts={},reasonCombinationCounts={};
  for(const s of stocks){const t=ticker(s.ticker||s.symbol);if(!t)continue;const r=assessHistory(t,marketDate,summaryMap.get(t),s);readiness[t]=r;for(const reason of r.reasons)reasonCounts[reason]=(reasonCounts[reason]||0)+1;if(r.reasons.length){const key=r.reasons.slice().sort().join(' + ');reasonCombinationCounts[key]=(reasonCombinationCounts[key]||0)+1}}
  const readySet=new Set(Object.entries(readiness).filter(([,r])=>r.ready).map(([t])=>t));
  const v16=read(path.join(ROOT,'data','stable','v15-practical-decision.json'),{}),sepaRaw=read(path.join(ROOT,'gann-fusion-x','data','sepa-x-snapshot.json'),{}),gann=currentGannRows(stocks,readiness,marketDate,sepaRaw);
  const sourceSession={V16_9:dateOf(v16),SEPA_X:dateOf(sepaRaw),GANN_FUSION_X:marketDate};
  const sourceFresh={V16_9:Boolean(marketDate&&sourceSession.V16_9===marketDate),SEPA_X:Boolean(marketDate&&sourceSession.SEPA_X===marketDate),GANN_FUSION_X:Boolean(marketDate&&gann.analyzed>0)};
  const v16Rows=normalizeSource(sourceFresh.V16_9,v16.recommendations,x=>x.ticker,x=>x.status||x.category||'CANDIDATE',x=>x.score??x.combinedScore??x.estimatedTop10ProbabilityPct??null).filter(x=>readySet.has(x.ticker));
  const sepaRows=normalizeSource(sourceFresh.SEPA_X,sepaRaw.rows||sepaRaw?.views?.top,x=>x.symbol||x.ticker,x=>x.action||x.status||'WATCH',x=>x.final_score??x.entry_readiness_score??null).filter(x=>readySet.has(x.ticker));
  const gannRows=gann.rows;
  const maps={V16_9:new Map(v16Rows.map(x=>[x.ticker,x])),SEPA_X:new Map(sepaRows.map(x=>[x.ticker,x])),GANN_FUSION_X:new Map(gannRows.map(x=>[x.ticker,x]))};
  const union=new Set([...maps.V16_9.keys(),...maps.SEPA_X.keys(),...maps.GANN_FUSION_X.keys()]);
  const rows=[...union].map(t=>{const engines={};let count=0;for(const name of Object.keys(maps)){const hit=maps[name].get(t);engines[name]=hit?{present:true,decision:hit.decision,score:hit.score??null,rank:hit.rank??null}:{present:false,decision:'NO_SIGNAL',score:null,rank:null};if(hit)count++}return{ticker:t,ready:true,engineCount:count,consensus:count===3?'3/3':count===2?'2/3':'1/3',status:count===3?'TRIPLE_CONFIRMED':count===2?'PARTIAL_OVERLAP':'SINGLE_ENGINE_ONLY',engines}}).sort((a,b)=>b.engineCount-a.engineCount||a.ticker.localeCompare(b.ticker));
  const allFresh=Object.values(sourceFresh).every(Boolean),three=rows.filter(x=>x.engineCount===3),two=rows.filter(x=>x.engineCount===2),total=Object.keys(readiness).length,ready=readySet.size;
  const output={schemaVersion:'triple-engine-consensus-v1.1',generatedAt:new Date().toISOString(),mode:'RESEARCH_SHADOW_ONLY',marketSession:marketDate,dataReadiness:{policy:{minBars:MIN_BARS,currentVolumeObservationsRequired:VOLUME_WINDOW,volumeDefinition:'CURRENT_PLUS_PRIOR_20',missingData:'UNKNOWN_NEVER_ZERO',historySummaryIdentityRequired:true,staleOrUpdateFailed:'QUARANTINE'},total,ready,quarantined:Math.max(0,total-ready),reasonCounts,reasonCombinationCounts},sources:{V16_9:{session:sourceSession.V16_9,fresh:sourceFresh.V16_9,source:'data/stable/v15-practical-decision.json',signalsAfterReadiness:v16Rows.length},SEPA_X:{session:sourceSession.SEPA_X,fresh:sourceFresh.SEPA_X,source:'gann-fusion-x/data/sepa-x-snapshot.json',signalsAfterReadiness:sepaRows.length},GANN_FUSION_X:{session:sourceSession.GANN_FUSION_X,fresh:sourceFresh.GANN_FUSION_X,source:'CURRENT_GANN_CODE_RECOMPUTED_ON_SHARED_READY_SET',analyzedReady:gann.analyzed,actionableBeforeTop5:gann.actionable,signalsAfterReadiness:gannRows.length}},consensusStatus:allFresh?'ELIGIBLE_SAME_SESSION':'BLOCKED_SOURCE_STALE',allSourcesFresh:allFresh,threeOfThree:three,twoOfThree:two,rows,executionLocks:{researchOnly:true,executionAllowed:false,automaticOrders:false,automaticPromotion:false},notes:['All three engines use one shared symbol/session/OHLCV readiness set before consensus.','GANN is recomputed from the current repository engine code on only the shared READY universe; the older forward-shadow snapshot is not used as the live GANN source.','GANN current volume requires 21 real observations: current session plus the prior 20.','Missing volume is never converted to zero in the triple-engine layer.','3/3 requires all three sources on the market session and the ticker to be READY.']};
  fs.mkdirSync(OUT_DIR,{recursive:true});fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({marketSession:marketDate,allFresh,readiness:output.dataReadiness,sources:output.sources,threeOfThree:three.map(x=>x.ticker),twoOfThree:two.map(x=>x.ticker)},null,2));
  if(!marketDate)process.exitCode=2;
}
main();
