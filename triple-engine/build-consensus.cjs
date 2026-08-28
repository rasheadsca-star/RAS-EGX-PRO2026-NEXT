#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const OUT_DIR=path.join(__dirname,'data');
const OUT=path.join(OUT_DIR,'current.json');
const MIN_BARS=60;
const LIQ_WINDOW=20;
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const ticker=x=>String(x||'').trim().toUpperCase();
const dateOf=x=>x?.marketDate||x?.analysisSession||x?.sessionDate||x?.marketSession||x?.meta?.marketSession||null;
function rawSessions(doc){return Array.isArray(doc?.sessions)?doc.sessions:[]}
function assessHistory(t,marketDate){
  const doc=read(path.join(ROOT,'data','history',`${t}.json`));
  const reasons=[];
  if(!doc)return {ready:false,reasons:['HISTORY_FILE_MISSING'],sessions:0,lastSession:null};
  const rows=rawSessions(doc).filter(r=>r&&r.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(rows.length<MIN_BARS)reasons.push('INSUFFICIENT_HISTORY');
  const last=rows.at(-1)?.date||doc.lastSession||null;
  if(!marketDate||String(last)!==String(marketDate))reasons.push('SESSION_BEHIND_REFERENCE');
  const window=rows.slice(-LIQ_WINDOW);
  if(window.length<LIQ_WINDOW)reasons.push('INSUFFICIENT_LIQUIDITY_WINDOW');
  if(window.some(r=>![r.open,r.high,r.low,r.close].every(finite)))reasons.push('OHLC_INCOMPLETE');
  if(window.some(r=>!finite(r.volume)))reasons.push('VOLUME_MISSING');
  return {ready:reasons.length===0,reasons,sessions:rows.length,lastSession:last,missingDataPolicy:'UNKNOWN_NEVER_ZERO'};
}
function main(){
  const market=read(path.join(ROOT,'data','quant','market-search-index-v13-17.json'),{});
  const marketDate=dateOf(market);
  const stocks=Array.isArray(market.stocks)?market.stocks:[];
  const readiness={};
  const reasonCounts={};
  for(const s of stocks){
    const t=ticker(s.ticker||s.symbol); if(!t)continue;
    const explicitBadIdentity=s.symbolIdentityVerified===false||s.identityVerified===false;
    const r=assessHistory(t,marketDate);
    if(explicitBadIdentity){r.ready=false;r.reasons=[...new Set([...r.reasons,'SYMBOL_IDENTITY_NOT_VERIFIED'])]}
    readiness[t]=r;
    for(const reason of r.reasons)reasonCounts[reason]=(reasonCounts[reason]||0)+1;
  }
  const readySet=new Set(Object.entries(readiness).filter(([,r])=>r.ready).map(([t])=>t));
  const v16=read(path.join(ROOT,'data','stable','v15-practical-decision.json'),{});
  const sepa=read(path.join(ROOT,'gann-fusion-x','data','sepa-x-snapshot.json'),{});
  const gannReport=read(path.join(ROOT,'gann-fusion-x','data','forward-shadow-report.json'),{});
  const sourceSession={
    V16_9:dateOf(v16),
    SEPA_X:dateOf(sepa),
    GANN_FUSION_X:gannReport.marketSession||dateOf(gannReport)
  };
  const sourceFresh=Object.fromEntries(Object.entries(sourceSession).map(([k,d])=>[k,Boolean(marketDate&&d&&String(d)===String(marketDate))]));
  const normalize=(engine,rows,getTicker,getDecision,getScore)=>{
    if(!sourceFresh[engine])return [];
    return (Array.isArray(rows)?rows:[]).map((x,i)=>{const t=ticker(getTicker(x));return {ticker:t,rank:Number(x.rank||i+1),decision:getDecision(x),score:getScore(x),raw:x}}).filter(x=>x.ticker&&readySet.has(x.ticker));
  };
  const v16Rows=normalize('V16_9',v16.recommendations,x=>x.ticker,x=>x.status||x.category||'CANDIDATE',x=>x.score??x.combinedScore??x.estimatedTop10ProbabilityPct??null);
  const sepaRows=normalize('SEPA_X',sepa.rows||sepa?.views?.top,x=>x.symbol||x.ticker,x=>x.action||x.status||'WATCH',x=>x.final_score??x.entry_readiness_score??null);
  const gannRows=normalize('GANN_FUSION_X',gannReport?.currentCandidates?.GANN_FUSION_X_V1,x=>x.ticker,x=>x.action||x?.meta?.decision?.code||'UNKNOWN',x=>x.score??null);
  const maps={V16_9:new Map(v16Rows.map(x=>[x.ticker,x])),SEPA_X:new Map(sepaRows.map(x=>[x.ticker,x])),GANN_FUSION_X:new Map(gannRows.map(x=>[x.ticker,x]))};
  const union=new Set([...maps.V16_9.keys(),...maps.SEPA_X.keys(),...maps.GANN_FUSION_X.keys()]);
  const rows=[...union].map(t=>{
    const engines={};let count=0;
    for(const name of Object.keys(maps)){const hit=maps[name].get(t);engines[name]=hit?{present:true,decision:hit.decision,score:hit.score,rank:hit.rank}:{present:false,decision:'NO_SIGNAL',score:null,rank:null};if(hit)count++}
    return {ticker:t,ready:true,engineCount:count,consensus:count===3?'3/3':count===2?'2/3':'1/3',engines};
  }).sort((a,b)=>b.engineCount-a.engineCount||a.ticker.localeCompare(b.ticker));
  const allFresh=Object.values(sourceFresh).every(Boolean);
  const three=rows.filter(x=>x.engineCount===3),two=rows.filter(x=>x.engineCount===2);
  const total=Object.keys(readiness).length;
  const ready=readySet.size;
  const output={
    schemaVersion:'triple-engine-consensus-v1',generatedAt:new Date().toISOString(),mode:'RESEARCH_SHADOW_ONLY',marketSession:marketDate,
    dataReadiness:{policy:{minBars:MIN_BARS,latestVolumeSessionsRequired:LIQ_WINDOW,missingData:'UNKNOWN_NEVER_ZERO'},total,ready,quarantined:Math.max(0,total-ready),reasonCounts},
    sources:{
      V16_9:{session:sourceSession.V16_9,fresh:sourceFresh.V16_9,source:'data/stable/v15-practical-decision.json',signalsAfterReadiness:v16Rows.length},
      SEPA_X:{session:sourceSession.SEPA_X,fresh:sourceFresh.SEPA_X,source:'gann-fusion-x/data/sepa-x-snapshot.json',signalsAfterReadiness:sepaRows.length},
      GANN_FUSION_X:{session:sourceSession.GANN_FUSION_X,fresh:sourceFresh.GANN_FUSION_X,source:'gann-fusion-x/data/forward-shadow-report.json',signalsAfterReadiness:gannRows.length}
    },
    consensusStatus:allFresh?'ELIGIBLE_SAME_SESSION':'BLOCKED_SOURCE_STALE',allSourcesFresh:allFresh,threeOfThree:three,twoOfThree:two,rows,
    executionLocks:{researchOnly:true,executionAllowed:false,automaticOrders:false,automaticPromotion:false},
    notes:['All engines are filtered by the same history/session/volume readiness set before consensus.','Missing volume is never converted to zero.','3/3 consensus is impossible unless all three source sessions equal the market session.']
  };
  fs.mkdirSync(OUT_DIR,{recursive:true});fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({marketSession:marketDate,allFresh,readiness:output.dataReadiness,signals:Object.fromEntries(Object.entries(output.sources).map(([k,v])=>[k,v.signalsAfterReadiness])),threeOfThree:three.map(x=>x.ticker),twoOfThree:two.map(x=>x.ticker)},null,2));
  if(!marketDate)process.exitCode=2;
}
main();
