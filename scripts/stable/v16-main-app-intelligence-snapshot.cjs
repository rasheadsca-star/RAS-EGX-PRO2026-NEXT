#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const ENGINE = 'V16_9_EQUAL_WEIGHT_BASKET';
const OUT = P('data/stable/v16-main-app-intelligence-snapshot.json');
const LEDGER = P('data/stable/v16-main-app-intelligence-ledger.json');

function readJson(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function readJsonPath(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readText(rel) {
  try { return fs.readFileSync(P(rel), 'utf8'); } catch { return ''; }
}
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function mean(a) { return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; }
function ema(values, period) {
  if (values.length < period) return null;
  const k = 2/(period+1);
  let out = mean(values.slice(0,period));
  for (let i=period;i<values.length;i++) out = values[i]*k + out*(1-k);
  return out;
}
function sma(values, period) { return values.length >= period ? mean(values.slice(-period)) : null; }
function rsi(values, period=14) {
  if (values.length <= period) return null;
  let gains=0, losses=0;
  for (let i=values.length-period;i<values.length;i++) {
    const d=values[i]-values[i-1]; if (d>=0) gains+=d; else losses-=d;
  }
  if (losses===0) return 100;
  const rs=(gains/period)/(losses/period);
  return 100-(100/(1+rs));
}
function sentimentForTitle(title) {
  const t=String(title||'').toLowerCase();
  const pos=['profit','growth','award','contract','dividend','expansion','record','upgrade','acquisition','investment','rise','higher','surge','wins','revenue growth','أرباح','نمو','توزيعات','عقد','توسع','استحواذ','ارتفاع'];
  const neg=['loss','decline','lawsuit','penalty','suspend','default','downgrade','debt','fall','lower','drop','warning','خسائر','تراجع','غرامة','إيقاف','ديون','انخفاض'];
  let s=0; for (const k of pos) if (t.includes(k)) s++; for (const k of neg) if (t.includes(k)) s--;
  return s>0?'POSITIVE':s<0?'NEGATIVE':'NEUTRAL';
}
function fundamentalScore(f) {
  if (!f) return {label:'UNAVAILABLE',score:null,notes:[]};
  let score=0; const notes=[];
  if (Number.isFinite(f.pe)) { if (f.pe>0&&f.pe<15){score++;notes.push('PE_LOW_RELATIVE');} else if(f.pe>35){score--;notes.push('PE_HIGH');} }
  if (Number.isFinite(f.priceToBook)) { if(f.priceToBook<2.5){score++;notes.push('PB_ACCEPTABLE');} else if(f.priceToBook>6){score--;notes.push('PB_HIGH');} }
  if (Number.isFinite(f.eps)) { if(f.eps>0){score++;notes.push('EPS_POSITIVE');} else {score--;notes.push('EPS_NEGATIVE');} }
  return {label:score>=2?'POSITIVE_PRELIMINARY':score<=-2?'WEAK_PRELIMINARY':'NEUTRAL_OR_INSUFFICIENT',score,notes};
}
function newsSummary(news) {
  const pos=news.filter(x=>x.sentiment==='POSITIVE').length;
  const neg=news.filter(x=>x.sentiment==='NEGATIVE').length;
  const score=pos-neg;
  return {label:score>0?'POSITIVE_PRELIMINARY':score<0?'NEGATIVE_PRELIMINARY':'NEUTRAL_OR_MIXED',score,pos,neg,total:news.length};
}
function technicalSnapshot(ticker, sessionDate) {
  const history=readJson(`data/history/${ticker}.json`,{});
  const rows=(history.sessions||history.rows||[])
    .filter(r=>String(r.date||r.sessionDate||'')<=String(sessionDate||'9999-99-99'))
    .filter(r=>n(r.close)!==null)
    .sort((a,b)=>String(a.date||a.sessionDate).localeCompare(String(b.date||b.sessionDate)));
  const closes=rows.map(r=>n(r.close)).filter(Number.isFinite);
  if (closes.length<20) return {status:'UNAVAILABLE',reason:'INSUFFICIENT_HISTORY',historyRows:closes.length,yahooSymbol:history.yahooSymbol||`${ticker}.CA`};
  const price=closes.at(-1), ema20=ema(closes,20), ema50=ema(closes,50), sma20=sma(closes,20), sma50=sma(closes,50), rsi14=rsi(closes,14);
  const lookback=rows.slice(-80); let high=-Infinity, low=Infinity;
  for (const r of lookback){const h=n(r.high),l=n(r.low); if(h!==null)high=Math.max(high,h); if(l!==null)low=Math.min(low,l);}
  const fib=Number.isFinite(high)&&Number.isFinite(low)&&high>low ? {high,low,r382:high-.382*(high-low),r500:high-.5*(high-low),r618:high-.618*(high-low)} : null;
  let trendScore=0; if(ema20!==null) trendScore += price>ema20?1:-1; if(ema50!==null) trendScore += price>ema50?1:-1; if(ema20!==null&&ema50!==null) trendScore += ema20>ema50?1:-1; if(rsi14!==null){if(rsi14>=55&&rsi14<=72)trendScore++; else if(rsi14<40)trendScore--;}
  return {status:'SUCCESS',asOfSession:sessionDate,historyRows:closes.length,yahooSymbol:history.yahooSymbol||`${ticker}.CA`,price,sma20,sma50,ema20,ema50,rsi14,trendScore,fibonacci:fib};
}
async function fetchJson(url, timeoutMs=9000) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MAIN-APP-AUDIT/16.9.2','accept':'application/json'},signal:controller.signal});
    if(!r.ok) throw new Error(`HTTP_${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function fetchFinancial(yahoo) {
  const urls=[
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahoo)}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahoo)}`,
  ];
  const errors=[];
  for(const url of urls){try{const q=await fetchJson(url);const x=q?.quoteResponse?.result?.[0];if(x){return{status:'SUCCESS',source:'Yahoo Finance quote',sourceUrl:url,fetchedAt:new Date().toISOString(),values:{marketCap:n(x.marketCap),pe:n(x.trailingPE),forwardPE:n(x.forwardPE),eps:n(x.epsTrailingTwelveMonths),bookValue:n(x.bookValue),priceToBook:n(x.priceToBook),dividendYield:n(x.trailingAnnualDividendYield),week52High:n(x.fiftyTwoWeekHigh),week52Low:n(x.fiftyTwoWeekLow),currency:x.currency||null}};}}catch(e){errors.push(String(e.message||e));}}
  return{status:'UNAVAILABLE',source:'Yahoo Finance quote',fetchedAt:new Date().toISOString(),errors};
}
async function fetchNews(yahoo) {
  const urls=[
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahoo)}&quotesCount=1&newsCount=6`,
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahoo)}&quotesCount=1&newsCount=6`,
  ];
  const errors=[];
  for(const url of urls){try{const q=await fetchJson(url);const items=(q?.news||[]).slice(0,6).map(x=>({title:x.title||null,publisher:x.publisher||null,link:x.link||null,published:x.providerPublishTime?new Date(x.providerPublishTime*1000).toISOString():null,sentiment:sentimentForTitle(x.title)}));return{status:'SUCCESS',source:'Yahoo Finance search/news',sourceUrl:url,fetchedAt:new Date().toISOString(),items,summary:newsSummary(items)};}catch(e){errors.push(String(e.message||e));}}
  return{status:'UNAVAILABLE',source:'Yahoo Finance search/news',fetchedAt:new Date().toISOString(),errors,items:[],summary:newsSummary([])};
}

async function main(){
  const current=readJson('data/stable/v16-main-app-current.json');
  const primary=readJson('data/stable/v16-v169-primary-decision.json');
  const consensus=readJson('data/stable/v16-main-app-consensus.json');
  const priceTruth=readJson('data/stable/v15-price-truth.json');
  const analyzer=readText('preview-v16/app/stock-analyzer.js');
  const chart=readText('preview-v16/app/stock-analyzer-chart.js');
  const decisionUi=readText('preview-v16/app/stock-analyzer-decision.js');
  if(current?.governance?.activeEngine!==ENGINE) throw new Error(`MAIN APP engine lock mismatch: ${current?.governance?.activeEngine||'missing'}`);
  if(primary?.selectedModel?.id&&primary.selectedModel.id!==ENGINE) throw new Error(`Primary decision engine mismatch: ${primary.selectedModel.id}`);
  const sessionDate=primary.sessionDate||current.sessionDate||null;
  const recs=Array.isArray(primary.recommendations)?primary.recommendations:(current.recommendations||[]);
  const consensusRows=Array.isArray(consensus?.current?.mainAppAnnotations)?consensus.current.mainAppAnnotations:[];
  const consensusByTicker=new Map(consensusRows.map(r=>[String(r?.ticker||'').toUpperCase(),r]));
  const capability={technical:analyzer.includes('technicalAnalysis')&&analyzer.includes('fibonacci'),financial:analyzer.includes('fundamentalScore')&&analyzer.includes('trailingPE')&&analyzer.includes('priceToBook'),news:analyzer.includes('newsSummary')&&analyzer.includes('sentimentForTitle'),chart:chart.includes('EMA20')&&chart.includes('RSI(14)')&&chart.includes('Fibonacci'),portfolioDecision:decisionUi.includes('إلغاء القرار')&&decisionUi.includes('الهدف الأقرب')};
  const recommendations=await Promise.all(recs.map(async row=>{
    const ticker=String(row?.ticker||'').toUpperCase();
    const technical=technicalSnapshot(ticker,sessionDate);
    const yahoo=technical.yahooSymbol||`${ticker}.CA`;
    const [financial,news]=await Promise.all([fetchFinancial(yahoo),fetchNews(yahoo)]);
    return{ticker,rank:row?.rank??null,signalDate:sessionDate,publishedAt:primary.generatedAt||current.generatedAt||null,referenceClose:row?.close??row?.recommendationClose??null,entryLow:row?.entryLow??null,entryHigh:row?.entryHigh??null,stopLoss:row?.stopLoss??null,target1:row?.target1??null,weightPct:row?.portfolioWeightPct??row?.weightPct??null,consensus:consensusByTicker.get(ticker)||null,intelligence:{technical,financial:{...financial,score:financial.status==='SUCCESS'?fundamentalScore(financial.values):fundamentalScore(null)},news}};
  }));
  const techSuccess=recommendations.filter(r=>r.intelligence.technical.status==='SUCCESS').length;
  const finSuccess=recommendations.filter(r=>r.intelligence.financial.status==='SUCCESS').length;
  const newsSuccess=recommendations.filter(r=>r.intelligence.news.status==='SUCCESS').length;
  const allAuditable=recommendations.length>0&&techSuccess===recommendations.length&&finSuccess===recommendations.length&&newsSuccess===recommendations.length;
  const out={schemaVersion:'16.9.2-auditable-intelligence-snapshot-v2',generatedAt:new Date().toISOString(),engine:ENGINE,sessionDate,sourceDecisionGeneratedAt:primary.generatedAt||null,snapshotTiming:(primary.generatedAt&&String(primary.generatedAt).slice(0,10)===sessionDate)?'SAME_SESSION_POST_PUBLICATION':'CURRENT_SESSION_AUDIT',immutableMethodology:{changesAlphaOrRanking:false,changesEntryStopTargetAllocation:false,changesExecutionGrant:false,purpose:'Audit/explainability and shadow research only. Cannot rank, filter, replace, or mutate MAIN APP recommendations.'},automaticDataContext:{priceTruthGeneratedAt:priceTruth.generatedAt||null,executionGrade:priceTruth.executionGrade===true,sourceSessionEvidenceCoveragePct:priceTruth?.source?.sourceSessionEvidenceCoveragePct??null,acceptedRows:priceTruth.acceptedRows??null,inputRows:priceTruth?.source?.inputRows??null},capabilitiesAtSnapshot:capability,recommendations,auditCompleteness:{recommendationCount:recommendations.length,consensusRowsMatched:recommendations.filter(r=>r.consensus).length,technicalSuccess:techSuccess,financialSuccess:finSuccess,newsSuccess,technicalCoveragePct:recommendations.length?techSuccess/recommendations.length*100:0,financialCoveragePct:recommendations.length?finSuccess/recommendations.length*100:0,newsCoveragePct:recommendations.length?newsSuccess/recommendations.length*100:0,auditableIntelligenceComplete:allAuditable,noSyntheticValues:true,noFutureMarketDataUsedForTechnical:true}};
  out.snapshotHash=sha({engine:out.engine,sessionDate:out.sessionDate,automaticDataContext:out.automaticDataContext,recommendations:out.recommendations,immutableMethodology:out.immutableMethodology});
  writeAtomic(OUT,out);
  const ledger=readJsonPath(LEDGER,{schemaVersion:'16.9.2-auditable-intelligence-ledger-v1',engine:ENGINE,sessions:[]});
  if(!Array.isArray(ledger.sessions)) ledger.sessions=[];
  if(!ledger.sessions.some(s=>s.sessionDate===sessionDate)) ledger.sessions.push({sessionDate,firstCapturedAt:out.generatedAt,snapshotHash:out.snapshotHash,auditCompleteness:out.auditCompleteness,recommendations:out.recommendations});
  ledger.updatedAt=new Date().toISOString();
  writeAtomic(LEDGER,ledger);
  console.log(JSON.stringify({output:path.relative(ROOT,OUT),ledger:path.relative(ROOT,LEDGER),engine:out.engine,sessionDate,recommendationCount:recommendations.length,executionGrade:out.automaticDataContext.executionGrade,technicalSuccess:techSuccess,financialSuccess:finSuccess,newsSuccess,auditableIntelligenceComplete:allAuditable,changesAlphaOrRanking:false,snapshotHash:out.snapshotHash},null,2));
}
main().catch(err=>{console.error(err);process.exit(1);});
