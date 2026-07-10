#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const OUT_DIR = path.join(ROOT, 'data', 'quant', 'stocks');
const INDEX_PATH = path.join(ROOT, 'data', 'quant', 'stock-intelligence-index.json');
const POLICY = readJson('data/v13-7-native-policy.json', true);

function readJson(relativePath, required = false) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    if (required) throw new Error(`Missing required file: ${relativePath}`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
  catch (error) {
    if (required) throw new Error(`Invalid JSON ${relativePath}: ${error.message}`);
    return null;
  }
}

function writeJson(fullPath, value) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const temp = `${fullPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, fullPath);
}

function num(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function safeTicker(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, ''); }
function mean(values) { const clean=values.filter(Number.isFinite); return clean.length ? clean.reduce((a,b)=>a+b,0)/clean.length : null; }
function median(values) { const clean=values.filter(Number.isFinite).sort((a,b)=>a-b); if(!clean.length)return null; const m=Math.floor(clean.length/2); return clean.length%2?clean[m]:(clean[m-1]+clean[m])/2; }
function min(values) { const clean=values.filter(Number.isFinite); return clean.length ? Math.min(...clean) : null; }
function max(values) { const clean=values.filter(Number.isFinite); return clean.length ? Math.max(...clean) : null; }
function pct(current, previous) { return Number.isFinite(current)&&Number.isFinite(previous)&&previous!==0 ? ((current/previous)-1)*100 : null; }
function clamp(value,minValue,maxValue){return Math.max(minValue,Math.min(maxValue,value));}
function sma(values, period) { if(values.length<period)return null; return mean(values.slice(-period)); }
function emaSeries(values, period) {
  if (!values.length) return [];
  const k = 2/(period+1); let current=values[0];
  return values.map((value,index)=>{ current=index===0?value:(value*k+current*(1-k)); return current; });
}
function rsi(values, period=14) {
  if(values.length<=period)return null;
  let gains=0, losses=0;
  for(let i=values.length-period;i<values.length;i++){
    const change=values[i]-values[i-1];
    if(change>0)gains+=change; else losses-=change;
  }
  const avgGain=gains/period, avgLoss=losses/period;
  if(avgLoss===0)return 100;
  return 100-(100/(1+(avgGain/avgLoss)));
}
function atr(rows, period=14) {
  if(rows.length<period+1)return null;
  const trs=[];
  for(let i=rows.length-period;i<rows.length;i++){
    const prev=rows[i-1].close;
    trs.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-prev),Math.abs(rows[i].low-prev)));
  }
  return mean(trs);
}
function standardDeviation(values){const m=mean(values);if(m===null)return null;return Math.sqrt(mean(values.map(v=>(v-m)**2)));}
function normalizeRows(doc) {
  const raw = Array.isArray(doc) ? doc : (doc?.sessions || doc?.rows || doc?.data || doc?.history || []);
  return raw.map(row=>({
    date:String(row.date||row.sessionDate||row.session||'').slice(0,10),
    open:num(row.open), high:num(row.high), low:num(row.low), close:num(row.close), volume:num(row.volume,0)
  })).filter(row=>row.date && [row.open,row.high,row.low,row.close].every(Number.isFinite))
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function normalizeSymbolMap(doc) {
  if(Array.isArray(doc)) return new Map(doc.map(item=>[safeTicker(item.ticker||item.symbol||item.code),item]));
  return new Map(Object.entries(doc||{}).map(([key,value])=>[safeTicker(value?.ticker||key),value||{}]));
}
function recommendationMap() {
  const daily=readJson('data/quant/daily-recommendations.json')||{};
  const adaptive=readJson('data/quant/adaptive-daily-recommendations.json')||{};
  const map=new Map();
  const add=(items,source,priority)=>{
    for(const raw of items||[]){
      const ticker=safeTicker(raw.ticker); if(!ticker)continue;
      const current=map.get(ticker);
      if(!current||priority>current.priority)map.set(ticker,{...raw,source,priority});
    }
  };
  add(daily.watchCandidates,'V13.4',1);
  add(daily.paperCandidates,'V13.4',2);
  add(adaptive.conditionalWatch,'V13.5',3);
  add(adaptive.paperCandidates,'V13.5',4);
  return {map,session:adaptive.sessionId||daily.sessionId||null,marketRegime:adaptive.marketRegime||daily.marketRegime||null};
}
function eligibilityMap() {
  const doc=readJson('data/history-eligibility.json')||{};
  return new Map((doc.items||[]).map(item=>[safeTicker(item.ticker),item]));
}
function scoreTechnical(ind) {
  let score=50;
  if(ind.close>ind.sma20)score+=10; else score-=10;
  if(ind.sma20>ind.sma50)score+=12; else score-=8;
  if(ind.ema9>ind.ema21)score+=8; else score-=6;
  if(ind.macd>ind.macdSignal)score+=7; else score-=5;
  if(ind.rsi14>=45&&ind.rsi14<=70)score+=6;
  if(ind.rsi14>78)score-=8;
  if(ind.volumeRatio20>=1.2)score+=6;
  if(ind.relativeToResistance20Pct>0)score+=6;
  if(ind.return20Pct>0)score+=5; else score-=5;
  return clamp(Math.round(score),0,100);
}
function technicalLabel(ind,score){
  if(ind.close>ind.sma20&&ind.sma20>ind.sma50&&score>=68)return {code:'BULLISH',labelAr:'اتجاه صاعد'};
  if(ind.close<ind.sma20&&ind.sma20<ind.sma50&&score<=40)return {code:'BEARISH',labelAr:'اتجاه هابط'};
  return {code:'NEUTRAL',labelAr:'محايد / متذبذب'};
}
function computeStock(ticker, meta, doc, rec, eligibility) {
  const rows=normalizeRows(doc); const closes=rows.map(r=>r.close); const volumes=rows.map(r=>r.volume||0);
  if(rows.length<Number(POLICY.history.minimumSessions||20)) return null;
  const latest=rows.at(-1); const ema9s=emaSeries(closes,9), ema21s=emaSeries(closes,21), ema12=emaSeries(closes,12), ema26=emaSeries(closes,26);
  const macdSeries=ema12.map((v,i)=>v-(ema26[i]??v)); const signalSeries=emaSeries(macdSeries,9);
  const atr14=atr(rows,14); const lookback20=rows.slice(-20), lookback50=rows.slice(-50);
  const avgVolume20=mean(volumes.slice(-20)); const avgTurnover20=mean(lookback20.map(r=>r.close*(r.volume||0)));
  const returns20=[]; for(let i=Math.max(1,closes.length-20);i<closes.length;i++)returns20.push(pct(closes[i],closes[i-1])/100);
  const support20=min(lookback20.map(r=>r.low)), resistance20=max(lookback20.slice(0,-1).map(r=>r.high));
  const high50=max(lookback50.map(r=>r.high)), low50=min(lookback50.map(r=>r.low));
  const indicators={
    close:latest.close,
    change1Pct:pct(latest.close,closes.at(-2)), return5Pct:pct(latest.close,closes.at(-6)), return20Pct:pct(latest.close,closes.at(-21)), return50Pct:pct(latest.close,closes.at(-51)),
    sma5:sma(closes,5),sma20:sma(closes,20),sma50:sma(closes,50),ema9:ema9s.at(-1),ema21:ema21s.at(-1),
    rsi14:rsi(closes,14),macd:macdSeries.at(-1),macdSignal:signalSeries.at(-1),atr14,atrPct:atr14/latest.close*100,
    averageVolume20:avgVolume20,volumeRatio20:avgVolume20?latest.volume/avgVolume20:null,averageTurnover20Egp:avgTurnover20,
    volatility20Pct:standardDeviation(returns20)*100,support20,resistance20,high50,low50,
    distanceFromSupport20Pct:pct(latest.close,support20),relativeToResistance20Pct:pct(latest.close,resistance20),distanceFromHigh50Pct:pct(latest.close,high50)
  };
  const cleanIndicators=Object.fromEntries(Object.entries(indicators).map(([k,v])=>[k,round(v,3)]));
  const score=scoreTechnical(indicators); const trend=technicalLabel(indicators,score);
  const plan=rec?.plan||{};
  const recommendation=rec?{
    source:rec.source,status:rec.status||null,statusLabelAr:rec.statusLabelAr||null,strategyId:rec.strategyId||null,strategyLabelAr:rec.strategyLabelAr||null,
    recommendationScore:round(rec.recommendationScore,1),reasonAr:rec.reasonAr||null,failedConditions:rec.failedConditions||[],adaptive:rec.adaptive||null,
    plan:{entryLow:round(plan.entryLow,3),entryHigh:round(plan.entryHigh,3),stopLoss:round(plan.stopLoss,3),target1:round(plan.target1,3),target2:round(plan.target2,3),riskReward1:round(plan.riskReward1,2),maximumHoldingSessions:plan.maximumHoldingSessions||null}
  }:{source:null,status:'NO_CURRENT_SIGNAL',statusLabelAr:'لا توجد إشارة حالية',strategyId:null,strategyLabelAr:null,recommendationScore:null,reasonAr:'لا توجد توصية كمية نشطة لهذا السهم في أحدث جلسة.',failedConditions:[],adaptive:null,plan:{}};
  const chartRows=rows.slice(-Number(POLICY.history.chartSessions||100));
  const chartCloses=chartRows.map(r=>r.close); const sma20series=chartRows.map((_,i)=>i<19?null:mean(chartCloses.slice(i-19,i+1))); const sma50series=chartRows.map((_,i)=>i<49?null:mean(chartCloses.slice(i-49,i+1)));
  const detail={
    schemaVersion:'13.7.0',generatedAt:new Date().toISOString(),ticker,companyNameAr:meta.companyNameAr||meta.nameAr||meta.name_ar||'',companyNameEn:meta.companyNameEn||meta.nameEn||meta.name||'',sector:meta.sector||meta.sectorName||meta.sector_ar||'غير مصنف',active:meta.active!==false,
    sessionId:latest.date,latest:{date:latest.date,open:round(latest.open),high:round(latest.high),low:round(latest.low),close:round(latest.close),volume:round(latest.volume,0)},
    indicators:cleanIndicators,technical:{score,trendCode:trend.code,trendLabelAr:trend.labelAr},recommendation,
    dataQuality:{historySessions:rows.length,firstSession:rows[0].date,lastSession:latest.date,averageConfidence:num(doc.averageConfidence),symbolVerified:doc.symbolVerified!==false,eligibilityStatus:eligibility?.status||null,eligibilityLabelAr:eligibility?.statusLabelAr||null},
    chart:{dates:chartRows.map(r=>r.date),open:chartRows.map(r=>round(r.open)),high:chartRows.map(r=>round(r.high)),low:chartRows.map(r=>round(r.low)),close:chartRows.map(r=>round(r.close)),volume:chartRows.map(r=>round(r.volume,0)),sma20:sma20series.map(v=>round(v)),sma50:sma50series.map(v=>round(v))}
  };
  return detail;
}
function summaryOf(detail) {
  return {ticker:detail.ticker,companyNameAr:detail.companyNameAr,companyNameEn:detail.companyNameEn,sector:detail.sector,active:detail.active,sessionId:detail.sessionId,price:detail.latest.close,change1Pct:detail.indicators.change1Pct,technicalScore:detail.technical.score,trendCode:detail.technical.trendCode,trendLabelAr:detail.technical.trendLabelAr,rsi14:detail.indicators.rsi14,averageTurnover20Egp:detail.indicators.averageTurnover20Egp,volumeRatio20:detail.indicators.volumeRatio20,support20:detail.indicators.support20,resistance20:detail.indicators.resistance20,historySessions:detail.dataQuality.historySessions,eligibilityStatus:detail.dataQuality.eligibilityStatus,recommendationStatus:detail.recommendation.status,recommendationLabelAr:detail.recommendation.statusLabelAr,recommendationScore:detail.recommendation.recommendationScore,strategyLabelAr:detail.recommendation.strategyLabelAr};
}
function main(){
  if(!fs.existsSync(HISTORY_DIR))throw new Error('Missing data/history directory');
  const symbols=normalizeSymbolMap(readJson('data/symbol-map.json',true));
  const eligibility=eligibilityMap(); const recData=recommendationMap();
  fs.mkdirSync(OUT_DIR,{recursive:true});
  const summaries=[]; const failures=[];
  const files=fs.readdirSync(HISTORY_DIR).filter(name=>name.endsWith('.json')).sort();
  for(const file of files){
    const ticker=safeTicker(file.replace(/\.json$/i,''));
    try{
      const doc=readJson(path.posix.join('data/history',file),true); const meta=symbols.get(ticker)||{};
      const detail=computeStock(ticker,meta,doc,recData.map.get(ticker),eligibility.get(ticker));
      if(!detail){failures.push({ticker,reason:'insufficient_history'});continue;}
      writeJson(path.join(OUT_DIR,`${ticker}.json`),detail); summaries.push(summaryOf(detail));
    }catch(error){failures.push({ticker,reason:error.message});}
  }
  summaries.sort((a,b)=>(b.recommendationScore||-1)-(a.recommendationScore||-1)||b.technicalScore-a.technicalScore||a.ticker.localeCompare(b.ticker));
  const sessions=summaries.map(x=>x.sessionId).filter(Boolean).sort();
  const index={schemaVersion:'13.7.0',generatedAt:new Date().toISOString(),sessionId:sessions.at(-1)||recData.session||null,liveExecutionEnabled:false,marketRegime:recData.marketRegime,counts:{historyFiles:files.length,stocksBuilt:summaries.length,failures:failures.length,currentSignals:summaries.filter(x=>x.recommendationStatus&&x.recommendationStatus!=='NO_CURRENT_SIGNAL').length},stocks:summaries,failures,safety:['Portfolio data stays in browser localStorage only.','No live execution.','Missing prices are shown as unavailable and never estimated.']};
  writeJson(INDEX_PATH,index);
  console.log(`V13.7 built ${summaries.length} stocks; failures ${failures.length}; session ${index.sessionId}`);
}
try{main();}catch(error){console.error(error.stack||error.message);process.exit(1);}
