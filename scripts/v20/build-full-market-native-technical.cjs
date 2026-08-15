#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchHistory } = require('../history/adapters/yahoo-history-adapter.cjs');
const { fetchTargetedTicker } = require('../history/adapters/starta-targeted-adapter.cjs');
const { sanitizeSessions, calculatePointInTime } = require('./build-trusted-technical-history.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; } };
const write = (rel, value) => { const file=P(rel); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file, `${JSON.stringify(value,null,2)}\n`, 'utf8'); };
const finite = value => { if(value===null||value===undefined||value==='')return null; const n=Number(value); return Number.isFinite(n)?n:null; };
const round = (value,digits=4) => { const n=finite(value); if(n===null)return null; const p=10**digits; return Math.round(n*p)/p; };
const safe = value => String(value||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9_-]/g,'');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
const unique = values => [...new Set(values.filter(Boolean))];

const RANGE = process.env.V20_NATIVE_FULL_TECH_RANGE || '6mo';
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.V20_NATIVE_FULL_TECH_CONCURRENCY || 8)));
const PRICE_TOLERANCE_PCT = Number(process.env.V20_NATIVE_FULL_TECH_PRICE_TOLERANCE_PCT || 5);
const NETWORK_REFRESH = String(process.env.V20_NATIVE_FULL_TECH_NETWORK_REFRESH || 'true').toLowerCase() !== 'false';
const STARTA_FALLBACK = String(process.env.V20_NATIVE_FULL_TECH_STARTA_FALLBACK || 'true').toLowerCase() !== 'false';
const STARTA_TIMEOUT_MS = Math.max(1000, Number(process.env.V20_NATIVE_FULL_TECH_STARTA_TIMEOUT_MS || 6500));

function priceDiffPct(a,b){ const x=finite(a),y=finite(b); return x>0&&y>0?Math.abs(x-y)/y*100:null; }
function detectSwingLevel(rows,currentPrice,atr,kind){
  if(!Array.isArray(rows)||rows.length<7||!(currentPrice>0))return null;
  const candidates=[];
  for(let i=2;i<rows.length-2;i+=1){
    const row=rows[i];
    if(kind==='support'){
      const value=finite(row.low);
      if(value>0&&value<=currentPrice&&value<=finite(rows[i-1].low)&&value<=finite(rows[i-2].low)&&value<=finite(rows[i+1].low)&&value<=finite(rows[i+2].low)) candidates.push({value,date:row.date,index:i});
    } else {
      const value=finite(row.high);
      if(value>0&&value>=currentPrice&&value>=finite(rows[i-1].high)&&value>=finite(rows[i-2].high)&&value>=finite(rows[i+1].high)&&value>=finite(rows[i+2].high)) candidates.push({value,date:row.date,index:i});
    }
  }
  if(!candidates.length)return null;
  const tolerance=Math.max(currentPrice*0.01,finite(atr)>0?atr*0.35:0);
  const enriched=candidates.map(candidate=>{
    const touches=rows.filter(row=>{ const value=kind==='support'?finite(row.low):finite(row.high); return value!==null&&Math.abs(value-candidate.value)<=tolerance; }).length;
    const distancePct=Math.abs(candidate.value-currentPrice)/currentPrice*100;
    const sessionsAgo=rows.length-1-candidate.index;
    const strength=touches*18+Math.max(0,18-sessionsAgo*0.5)-Math.min(20,distancePct);
    return {...candidate,touches,distancePct,sessionsAgo,strength};
  }).sort((a,b)=>b.strength-a.strength||b.touches-a.touches||a.distancePct-b.distancePct||String(b.date).localeCompare(String(a.date)));
  const best=enriched[0];
  return {value:round(best.value,4),date:best.date,touches:best.touches,distancePct:round(best.distancePct,2),sessionsAgo:best.sessionsAgo,tolerance:round(tolerance,4)};
}
function buildSwingStructure(rows,currentPrice,atr){
  const scoped=(rows||[]).slice(-60);
  const support=detectSwingLevel(scoped,currentPrice,atr,'support');
  const resistance=detectSwingLevel(scoped,currentPrice,atr,'resistance');
  return {support,resistance,completePair:Boolean(support&&resistance&&support.value<currentPrice&&resistance.value>currentPrice),rowsUsed:scoped.length};
}
function evaluateDocument(ticker,market,document,sourceKind,attempts,providerRole,sessionDate){
  const blockers=[];
  if(!document){
    return {ticker,currentReady:false,asOfSession:null,source:null,sourceKind:null,providerRole:null,identityVerified:false,rowsUsed:0,currentPrice:finite(market?.price),latestClose:null,currentPriceDifferencePct:null,latestOhlc:null,indicators:{},swingStructure:{support:null,resistance:null,completePair:false,rowsUsed:0},blockers:['NO_HISTORY_DOCUMENT'],attempts,providerCandidates:[],usedForShadowNativeResearchScore:false,executionGateInfluence:false,productionAllocationInfluence:false,championInfluence:false};
  }
  if(document.symbolVerified!==true)blockers.push('SYMBOL_IDENTITY_NOT_VERIFIED');
  const sanitized=sanitizeSessions(document.sessions||[],ticker,sessionDate);
  const rows=sanitized.rows||[];
  const last=rows.at(-1)||null;
  if(rows.length<50)blockers.push('INSUFFICIENT_TRUSTED_ROWS_LT_50');
  if(last?.date!==sessionDate)blockers.push('LAST_HISTORY_SESSION_NOT_CURRENT');
  const currentPrice=finite(market?.price);
  if(!(currentPrice>0))blockers.push('CURRENT_MARKET_PRICE_UNAVAILABLE');
  const diff=priceDiffPct(last?.close,currentPrice);
  if(diff===null||diff>PRICE_TOLERANCE_PCT)blockers.push('LATEST_CLOSE_NOT_RECONCILED_WITH_CURRENT_PRICE');
  const point=calculatePointInTime(rows,sessionDate);
  const indicators=point.indicators||{};
  if(point.readiness?.sma50!==true)blockers.push('INSUFFICIENT_ROWS_FOR_SMA50');
  if(point.readiness?.macdSignal!==true)blockers.push('INSUFFICIENT_ROWS_FOR_MACD_SIGNAL');
  for(const key of ['sma20','sma50','ema20','rsi14','macd','macdSignal','atr14','momentum5Pct','momentum20Pct']) if(finite(indicators[key])===null) blockers.push(`INDICATOR_UNAVAILABLE_${key.toUpperCase()}`);
  const currentReady=document.symbolVerified===true&&rows.length>=50&&last?.date===sessionDate&&diff!==null&&diff<=PRICE_TOLERANCE_PCT&&point.readiness?.sma50===true&&point.readiness?.macdSignal===true&&blockers.length===0;
  const swing=currentReady?buildSwingStructure(rows,currentPrice,finite(indicators.atr14)): {support:null,resistance:null,completePair:false,rowsUsed:0};
  return {
    ticker,currentReady,asOfSession:last?.date||null,source:document.primarySource||last?.primarySource||null,sourceKind,providerRole,
    identityVerified:document.symbolVerified===true,identity:document.symbolVerification||null,rowsUsed:rows.length,rejectedRows:(sanitized.rejected||[]).length,
    currentPrice,currentPriceDifferencePct:round(diff,4),latestClose:finite(last?.close),latestOhlc:last?{date:last.date,open:finite(last.open),high:finite(last.high),low:finite(last.low),close:finite(last.close),volume:finite(last.volume),primarySource:last.primarySource||document.primarySource||null}:null,
    indicators:Object.fromEntries(Object.entries(indicators).map(([key,value])=>[key,round(value,6)])),readiness:point.readiness||{},swingStructure:swing,
    blockers:unique(blockers),attempts,providerCandidates:[],usedForShadowNativeResearchScore:currentReady,executionGateInfluence:false,productionAllocationInfluence:false,championInfluence:false
  };
}
function candidateSummary(row){ if(!row)return null; return {sourceKind:row.sourceKind,currentReady:row.currentReady,asOfSession:row.asOfSession,identityVerified:row.identityVerified,rowsUsed:row.rowsUsed,currentPriceDifferencePct:row.currentPriceDifferencePct,blockers:row.blockers}; }
async function pool(items,worker,concurrency){ const out=Array(items.length); let cursor=0; async function run(){for(;;){const index=cursor++; if(index>=items.length)return; out[index]=await worker(items[index]);}} await Promise.all(Array.from({length:Math.min(concurrency,items.length||1)},run)); return out; }

async function main(){
  const current=read('data/v20/current.json',{}),universe=read('data/v20/master-universe.json',{rows:[]}),explorer=read('data/v20/market-explorer.json',{rows:[]}),symbolMapRaw=read('data/symbol-map.json',[]),startaBase=read('data/history-targeted-seven-config.json',read('data/history-starta-gap-config.json',{}))||{};
  const sessionDate=String(current.sessionDate||''); if(!validDate(sessionDate))throw new Error('V20 current sessionDate missing for full-market native technical');
  if((explorer.rows||[]).length!==universe.count)throw new Error('Market Explorer must represent the full V20 master universe before native technical scan');
  const mapEntries=Array.isArray(symbolMapRaw)?symbolMapRaw:Object.values(symbolMapRaw||{}),symbolMap=new Map(mapEntries.map(row=>[safe(row.ticker),row]));
  const marketMap=new Map((explorer.rows||[]).map(row=>[safe(row.ticker),row]));
  const tickers=(universe.rows||[]).map(row=>safe(row.ticker)).filter(Boolean);
  const startaConfig={...startaBase,requestTimeoutMs:STARTA_TIMEOUT_MS,retryCount:1,retryBaseDelayMs:200,periodCandidates:['1y'],maximumRowsPerRequest:500,sourceConfidence:Number(startaBase.sourceConfidence||70)};

  const symbols=await pool(tickers,async ticker=>{
    const market=marketMap.get(ticker)||{},mapEntry=symbolMap.get(ticker)||null,attempts=[];
    if(market.currentSessionAvailable!==true||!(finite(market.price)>0)) return evaluateDocument(ticker,market,null,null,attempts,null,sessionDate);
    let primary=null;
    if(NETWORK_REFRESH&&mapEntry){
      try{
        const fetched=await fetchHistory(mapEntry,{range:RANGE,timeoutMs:7000,maxAttempts:1,backoffMs:200,localReference:{close:finite(market.price)}});
        const document={symbolVerified:fetched.identity?.verified===true,symbolVerification:fetched.identity||null,primarySource:'yahoo',sessions:fetched.sessions||[]};
        attempts.push({source:'yahoo_live',ok:true,sessions:fetched.sessions?.length||0});
        primary=evaluateDocument(ticker,market,document,'LIVE_YAHOO_REFRESH',attempts,'PRIMARY_PUBLIC_RESEARCH_PROVIDER',sessionDate);
      }catch(error){ attempts.push({source:'yahoo_live',ok:false,error:error.message}); }
    }
    if(!primary){
      const cached=read(`data/history/${ticker}.json`,null);
      if(cached){ attempts.push({source:'cached_history',ok:true,sessions:cached.sessions?.length||0}); primary=evaluateDocument(ticker,market,cached,'CACHED_VERIFIED_HISTORY_DOCUMENT',attempts,'CACHED_RESEARCH_DOCUMENT',sessionDate); }
    }
    if(primary?.currentReady===true)return primary;

    let secondary=null;
    if(STARTA_FALLBACK&&mapEntry&&finite(market.price)>0){
      try{
        const target={ticker,isin:mapEntry.isin||null,companyNameEn:mapEntry.companyNameEn||null,companyNameAr:mapEntry.companyNameAr||null,periodCandidates:['1y']};
        const fetched=await fetchTargetedTicker(ticker,mapEntry,target,startaConfig);
        attempts.push({source:'starta_live',ok:true,sessions:fetched.rows?.length||0,period:fetched.period||null});
        const document={symbolVerified:fetched.identity?.verified===true,symbolVerification:fetched.identity||null,primarySource:'starta_ohlc_api',sessions:fetched.rows||[]};
        secondary=evaluateDocument(ticker,market,document,'LIVE_STARTA_SECONDARY_REFRESH',attempts,'SECONDARY_NON_OFFICIAL_RESEARCH_ONLY',sessionDate);
        secondary.startaDiagnostics={period:fetched.period||null,sourceUrl:fetched.sourceUrl||null,fetchErrors:fetched.fetchErrors||[],identityWarnings:fetched.identity?.warnings||[]};
        if(secondary.currentReady===true){ secondary.providerCandidates=[candidateSummary(primary)].filter(Boolean); return secondary; }
      }catch(error){ attempts.push({source:'starta_live',ok:false,error:error.message}); }
    }
    const result=primary||secondary||evaluateDocument(ticker,market,null,null,attempts,null,sessionDate); result.attempts=attempts; result.providerCandidates=[candidateSummary(primary),candidateSummary(secondary)].filter(Boolean); return result;
  },CONCURRENCY);

  const ready=symbols.filter(row=>row.currentReady===true),blockerCounts={};
  for(const row of symbols.filter(row=>row.currentReady!==true))for(const blocker of row.blockers||[])blockerCounts[blocker]=(blockerCounts[blocker]||0)+1;
  const out={
    schemaVersion:'20.0.0-full-market-native-technical-1',generatedAt:new Date().toISOString(),asOfSessionDate:sessionDate,decisionSupportOnly:true,
    policy:{pointInTime:true,fullMarketUniverse:true,identityVerificationRequired:true,currentSessionRequired:true,currentPriceReconciliationTolerancePct:PRICE_TOLERANCE_PCT,minimumRows:50,missingOhlcSynthesisAllowed:false,futureRowsAllowed:false,primaryProvider:'YAHOO',secondaryProvider:'STARTA',secondaryProviderResearchOnly:true,providerBlendingAllowed:false,shadowNativeResearchScoreAllowed:true,executionGateInfluence:false,productionAllocationInfluence:false,championInfluence:false},
    summary:{universeCount:symbols.length,currentReadyCount:ready.length,currentReadyCoveragePct:symbols.length?round(ready.length/symbols.length*100,2):0,unavailableCount:symbols.length-ready.length,swingPairReadyCount:ready.filter(row=>row.swingStructure?.completePair===true).length,yahooReadyCount:ready.filter(row=>row.sourceKind==='LIVE_YAHOO_REFRESH').length,startaReadyCount:ready.filter(row=>row.sourceKind==='LIVE_STARTA_SECONDARY_REFRESH').length,cachedReadyCount:ready.filter(row=>row.sourceKind==='CACHED_VERIFIED_HISTORY_DOCUMENT').length,unresolvedBlockerCounts:blockerCounts},
    symbols
  };
  write('data/v20/full-market-native-technical.json',out); console.log(JSON.stringify(out.summary,null,2));
}

if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exit(1);});
module.exports={main,detectSwingLevel,evaluateDocument};
