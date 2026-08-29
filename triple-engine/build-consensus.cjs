#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const OUT_DIR=path.join(__dirname,'data');
const OUT=path.join(OUT_DIR,'current.json');
const MIN_BARS=60;
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
  return rawSessions(doc)
    .filter(r=>r&&r.date&&(!marketDate||String(r.date)<=String(marketDate)))
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)))
    .map(r=>{
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
    const bs=item.bars;
    if(bs.length<MIN_BARS||bs.at(-1)?.date!==marketDate)continue;
    const base=bs[0].close;
    if(!finite(base)||base<=0)continue;
    for(const b of bs){
      if(!finite(b.close)||b.close<=0)continue;
      if(!dates.has(b.date))dates.set(b.date,[]);
      dates.get(b.date).push(b.close/base*100);
    }
  }
  return [...dates.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,values])=>{
    const c=values.reduce((s,v)=>s+v,0)/values.length;
    return {date,open:c,high:c,low:c,close:c,volume:1};
  });
}

function gannTradePlan(a,p){
  const lv=p?.levels||{};
  return {
    source:'GANN_FUSION_X',
    completeness:'FULL',
    horizon:p?.profile?.labelAr||'مضاربي 1–3 جلسات',
    currentPrice:round(a?.close,4),
    entryLow:round(lv.entryLow,4),
    entryHigh:round(lv.entryHigh,4),
    referenceEntry:round(lv.referenceEntry,4),
    trigger:round(lv.trigger,4),
    noChaseAbove:finite(lv.entryHigh)?round(Number(lv.entryHigh)*1.03,4):null,
    stopLoss:round(lv.stopLoss,4),
    target1:round(lv.target1,4),
    target2:round(lv.target2,4),
    target3:round(lv.target3,4),
    riskPct:round(lv.riskPct,2),
    rr1:round(lv.rr1,2),
    rr2:round(lv.rr2,2),
    rr3:round(lv.rr3,2),
    triggerDistancePct:round(p?.triggerDistancePct,2),
    activationRule:p?.reasonAr||'لا دخول قبل تحقق شرط التفعيل والسيولة الداعمة.',
    actionAr:p?.actionAr||p?.decision?.ar||'دخول مشروط',
    entryPlan:Array.isArray(p?.entryPlan)?p.entryPlan:[],
    exitPlan:Array.isArray(p?.exitPlan)?p.exitPlan:[],
    timeStopSessions:3
  };
}

function v16TradePlan(raw){
  if(!raw||![raw.entryLow,raw.entryHigh,raw.stopLoss,raw.target1].some(finite))return null;
  return {
    source:'V16_9',
    completeness:'PARTIAL_ONE_TARGET',
    horizon:finite(raw.holdingSessions)?`${Number(raw.holdingSessions)} جلسات`:'قصير الأجل',
    currentPrice:round(raw.close,4),
    entryLow:round(raw.entryLow,4),
    entryHigh:round(raw.entryHigh,4),
    referenceEntry:finite(raw.entryLow)&&finite(raw.entryHigh)?round((Number(raw.entryLow)+Number(raw.entryHigh))/2,4):null,
    trigger:null,
    noChaseAbove:null,
    stopLoss:round(raw.stopLoss,4),
    target1:round(raw.target1,4),
    target2:null,
    target3:null,
    riskPct:null,
    rr1:round(raw.riskReward,2),
    rr2:null,
    rr3:null,
    triggerDistancePct:null,
    activationRule:raw.statusAr||'الدخول فقط داخل نطاق الدخول وبعد تأكيد الافتتاح.',
    actionAr:raw.statusAr||'دخول مشروط بعد تأكيد الافتتاح',
    entryPlan:[raw.statusAr||'لا دخول خارج نطاق الدخول المحدد.'],
    exitPlan:[finite(raw.stopLoss)?`وقف الخسارة ${round(raw.stopLoss,4)}.`:'',finite(raw.target1)?`الهدف الأول ${round(raw.target1,4)}.`:''].filter(Boolean),
    timeStopSessions:finite(raw.holdingSessions)?Number(raw.holdingSessions):null
  };
}

function sepaTradePlan(raw){
  if(!raw||!finite(raw.pivot))return null;
  return {
    source:'SEPA_X',
    completeness:'TRIGGER_ONLY',
    horizon:'مراقبة اختراق',
    currentPrice:round(raw.last_price,4),
    entryLow:null,
    entryHigh:null,
    referenceEntry:null,
    trigger:round(raw.pivot,4),
    noChaseAbove:null,
    stopLoss:null,
    target1:null,
    target2:null,
    target3:null,
    riskPct:round(raw.risk_pct,2),
    rr1:round(raw.reward_risk,2),
    rr2:null,
    rr3:null,
    triggerDistancePct:finite(raw.last_price)&&finite(raw.pivot)?round((Number(raw.pivot)/Number(raw.last_price)-1)*100,2):null,
    activationRule:`WATCH TRIGGER: لا دخول قبل اختراق/ثبات أعلى Pivot ${round(raw.pivot,4)} مع سيولة داعمة.`,
    actionAr:'مراقبة حتى Trigger',
    entryPlan:[`انتظر اختراق/ثبات أعلى ${round(raw.pivot,4)} قبل اعتبار السهم مفعّلًا.`],
    exitPlan:[],
    timeStopSessions:null
  };
}

function currentGannRows(stocks,readiness,marketDate,sepaRaw){
  if(!marketDate)return {rows:[],analyzed:0,actionable:0};
  const sepa=Sepa.normalize(sepaRaw||{}),stockByTicker=new Map(stocks.map(s=>[ticker(s.ticker||s.symbol),s]));
  const prepared=Object.entries(readiness).filter(([,r])=>r.ready).map(([t,r])=>({ticker:t,stock:stockByTicker.get(t)||{},bars:r.bars})).filter(x=>x.bars.length>=MIN_BARS);
  const marketBars=benchmark(prepared,marketDate),actionable=[];let analyzed=0;
  for(const item of prepared){
    const s=item.stock,t=item.ticker,ev=sepa?.byTicker?.[t],fund=ev?{score:ev.qualityScore,verified:Boolean(ev.fundamentals?.verified)}:{score:50,verified:false};
    const a=Fusion.analyze({ticker:t,nameAr:s.companyNameAr||t,bars:item.bars,marketBars,fundamentals:fund,dataQuality:{fresh:true,conflict:false}});
    if(!a.valid)continue;
    analyzed++;
    const lp=num(s.liquidityPercentile);
    a.marketMeta={technicalRank:s.technicalRank,liquidityPercentile:lp,riskScore:s.riskScore,riskLabelAr:s.riskLabelAr,moneyFlowQualityScore:s.momentumMoneyFlow?.moneyFlowQualityScore};
    a.sepaEvidence=ev||null;
    const p=Planner.buildPlan(a,'speculative',{portfolioValue:100000,riskPct:.5,verifiedFundamentals:Boolean(ev?.fundamentals?.verified)});
    if(p?.decision?.code!=='ACTIONABLE')continue;
    actionable.push({
      ticker:t,
      decision:'ACTIONABLE',
      score:round(p.rankScore??p.score,2),
      horizonScore:round(p.horizonScore??p.score,2),
      executionQuality:round(p.executionQuality,2),
      executionTier:p.executionTier||null,
      activationPrice:round(p.levels?.trigger??p.levels?.entryHigh,4),
      tradePlan:gannTradePlan(a,p),
      rankRaw:p.rankScore??p.score??0
    });
  }
  actionable.sort((a,b)=>Number(b.rankRaw)-Number(a.rankRaw)||a.ticker.localeCompare(b.ticker));
  return {rows:actionable.slice(0,5).map((x,i)=>{const {rankRaw,...rest}=x;return {...rest,rank:i+1}}),analyzed,actionable:actionable.length};
}

function normalizeSource(enabled,rows,getTicker,getDecision,getScore,getPlan=()=>null){
  if(!enabled)return [];
  return (Array.isArray(rows)?rows:[]).map((x,i)=>({ticker:ticker(getTicker(x)),rank:Number(x.rank||i+1),decision:getDecision(x),score:getScore(x),tradePlan:getPlan(x),raw:x})).filter(x=>x.ticker);
}

function engineView(hit){
  return hit?{present:true,decision:hit.decision,score:hit.score??null,rank:hit.rank??null,tradePlan:hit.tradePlan||null}:{present:false,decision:'NO_SIGNAL',score:null,rank:null,tradePlan:null};
}

function chooseConsensusPlan(engines){
  const preferred=['GANN_FUSION_X','V16_9','SEPA_X'];
  const plans=preferred.map(name=>engines?.[name]?.tradePlan).filter(Boolean);
  if(!plans.length)return null;
  return plans.find(p=>p.completeness==='FULL')||plans.find(p=>p.completeness==='PARTIAL_ONE_TARGET')||plans[0];
}

function main(){
  const market=read(path.join(ROOT,'data','quant','market-search-index-v13-17.json'),{}),marketDate=dateOf(market),stocks=Array.isArray(market.stocks)?market.stocks:[];
  const historySummary=read(path.join(ROOT,'data','history-summary.json'),{}),summaryMap=new Map((historySummary?.symbols||[]).map(x=>[ticker(x.ticker),x]));
  const readiness={},reasonCounts={},reasonCombinationCounts={};
  for(const s of stocks){
    const t=ticker(s.ticker||s.symbol);
    if(!t)continue;
    const r=assessHistory(t,marketDate,summaryMap.get(t),s);
    readiness[t]=r;
    for(const reason of r.reasons)reasonCounts[reason]=(reasonCounts[reason]||0)+1;
    if(r.reasons.length){const key=r.reasons.slice().sort().join(' + ');reasonCombinationCounts[key]=(reasonCombinationCounts[key]||0)+1}
  }
  const readySet=new Set(Object.entries(readiness).filter(([,r])=>r.ready).map(([t])=>t));
  const v16=read(path.join(ROOT,'data','stable','v15-practical-decision.json'),{}),sepaRaw=read(path.join(ROOT,'gann-fusion-x','data','sepa-x-snapshot.json'),{}),gann=currentGannRows(stocks,readiness,marketDate,sepaRaw);
  const sourceSession={V16_9:dateOf(v16),SEPA_X:dateOf(sepaRaw),GANN_FUSION_X:marketDate};
  const sourceFresh={V16_9:Boolean(marketDate&&sourceSession.V16_9===marketDate),SEPA_X:Boolean(marketDate&&sourceSession.SEPA_X===marketDate),GANN_FUSION_X:Boolean(marketDate&&gann.analyzed>0)};
  const v16Rows=normalizeSource(sourceFresh.V16_9,v16.recommendations,x=>x.ticker,x=>x.status||x.category||'CANDIDATE',x=>x.score??x.combinedScore??x.estimatedTop10ProbabilityPct??null,v16TradePlan).filter(x=>readySet.has(x.ticker));
  const sepaRows=normalizeSource(sourceFresh.SEPA_X,sepaRaw.rows||sepaRaw?.views?.top,x=>x.symbol||x.ticker,x=>x.action||x.status||'WATCH',x=>x.final_score??x.entry_readiness_score??null,sepaTradePlan).filter(x=>readySet.has(x.ticker));
  const gannRows=gann.rows;
  const maps={V16_9:new Map(v16Rows.map(x=>[x.ticker,x])),SEPA_X:new Map(sepaRows.map(x=>[x.ticker,x])),GANN_FUSION_X:new Map(gannRows.map(x=>[x.ticker,x]))};
  const union=new Set([...maps.V16_9.keys(),...maps.SEPA_X.keys(),...maps.GANN_FUSION_X.keys()]);
  const rows=[...union].map(t=>{
    const engines={};let count=0;
    for(const name of Object.keys(maps)){
      const hit=maps[name].get(t);
      engines[name]=engineView(hit);
      if(hit)count++;
    }
    const consensusPlan=chooseConsensusPlan(engines);
    return {ticker:t,ready:true,engineCount:count,consensus:count===3?'3/3':count===2?'2/3':'1/3',status:count===3?'TRIPLE_CONFIRMED':count===2?'PARTIAL_OVERLAP':'SINGLE_ENGINE_ONLY',consensusPlan,engines};
  }).sort((a,b)=>b.engineCount-a.engineCount||a.ticker.localeCompare(b.ticker));
  const allFresh=Object.values(sourceFresh).every(Boolean),three=rows.filter(x=>x.engineCount===3),two=rows.filter(x=>x.engineCount===2),total=Object.keys(readiness).length,ready=readySet.size;
  const output={
    schemaVersion:'triple-engine-consensus-v1.2-trade-plan',
    generatedAt:new Date().toISOString(),
    mode:'RESEARCH_SHADOW_ONLY',
    marketSession:marketDate,
    dataReadiness:{policy:{minBars:MIN_BARS,currentVolumeObservationsRequired:VOLUME_WINDOW,volumeDefinition:'CURRENT_PLUS_PRIOR_20',missingData:'UNKNOWN_NEVER_ZERO',historySummaryIdentityRequired:true,staleOrUpdateFailed:'QUARANTINE'},total,ready,quarantined:Math.max(0,total-ready),reasonCounts,reasonCombinationCounts},
    sources:{
      V16_9:{session:sourceSession.V16_9,fresh:sourceFresh.V16_9,source:'data/stable/v15-practical-decision.json',signalsAfterReadiness:v16Rows.length},
      SEPA_X:{session:sourceSession.SEPA_X,fresh:sourceFresh.SEPA_X,source:'gann-fusion-x/data/sepa-x-snapshot.json',signalsAfterReadiness:sepaRows.length},
      GANN_FUSION_X:{session:sourceSession.GANN_FUSION_X,fresh:sourceFresh.GANN_FUSION_X,source:'CURRENT_GANN_CODE_RECOMPUTED_ON_SHARED_READY_SET',analyzedReady:gann.analyzed,actionableBeforeTop5:gann.actionable,signalsAfterReadiness:gannRows.length}
    },
    consensusStatus:allFresh?'ELIGIBLE_SAME_SESSION':'BLOCKED_SOURCE_STALE',
    allSourcesFresh:allFresh,
    threeOfThree:three,
    twoOfThree:two,
    rows,
    executionLocks:{researchOnly:true,executionAllowed:false,automaticOrders:false,automaticPromotion:false},
    notes:[
      'All three engines use one shared symbol/session/OHLCV readiness set before consensus.',
      'Consensus plans never invent missing levels: FULL GANN plan is preferred, then exact V16.9 plan, then SEPA-X trigger-only evidence.',
      'GANN is recomputed from the current repository engine code on only the shared READY universe.',
      'GANN current volume requires 21 real observations: current session plus the prior 20.',
      'Missing volume is never converted to zero in the triple-engine layer.',
      '3/3 requires all three sources on the market session and the ticker to be READY.'
    ]
  };
  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({marketSession:marketDate,allFresh,readiness:output.dataReadiness,sources:output.sources,threeOfThree:three.map(x=>x.ticker),twoOfThree:two.map(x=>x.ticker),primaryPlan:two[0]?.consensusPlan||three[0]?.consensusPlan||null},null,2));
  if(!marketDate)process.exitCode=2;
}
main();
