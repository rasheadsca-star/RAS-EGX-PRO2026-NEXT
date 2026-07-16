#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-17-intelligence-policy.json'),
  center: path.join(ROOT, 'data', 'quant', 'unified-autonomous-center-v13-14.json'),
  history: path.join(ROOT, 'data', 'history'),
  output: path.join(ROOT, 'data', 'lab', 'momentum-money-flow-v13-17.json')
};
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); const tmp=`${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(value,null,2)+'\n','utf8'); JSON.parse(fs.readFileSync(tmp,'utf8')); fs.renameSync(tmp,file); }
function A(v){return Array.isArray(v)?v:[]}
function n(v,f=null){const x=Number(v);return Number.isFinite(x)?x:f}
function round(v,d=3){return Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null}
function clamp(v,lo=0,hi=100){return Math.max(lo,Math.min(hi,v))}
function ticker(v){return String(v||'').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'')}
function dateOnly(v){const m=String(v||'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null}
function historyRows(doc){
  const rows=Array.isArray(doc)?doc:Array.isArray(doc?.sessions)?doc.sessions:Array.isArray(doc?.rows)?doc.rows:Array.isArray(doc?.history)?doc.history:[];
  return rows.map(row=>({
    date:dateOnly(row.date||row.sessionDate||row.session), open:n(row.open), high:n(row.high), low:n(row.low), close:n(row.close), volume:n(row.volume,0)
  })).filter(r=>r.date&&r.open>0&&r.high>0&&r.low>0&&r.close>0&&r.volume>=0).sort((a,b)=>a.date.localeCompare(b.date));
}
function sma(values,period){if(values.length<period)return null;return values.slice(-period).reduce((a,b)=>a+b,0)/period}
function rsiWilder(rows,period){
  if(rows.length<period+1)return null; let gain=0,loss=0;
  for(let i=rows.length-period;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;if(d>0)gain+=d;else loss-=d}
  gain/=period; loss/=period; if(loss===0)return gain===0?50:100; const rs=gain/loss; return 100-100/(1+rs);
}
function mfi(rows,period){
  if(rows.length<period+1)return null;let pos=0,neg=0;
  const start=rows.length-period;
  for(let i=start;i<rows.length;i++){
    const tp=(rows[i].high+rows[i].low+rows[i].close)/3;
    const prev=(rows[i-1].high+rows[i-1].low+rows[i-1].close)/3;
    const flow=tp*rows[i].volume;
    if(tp>prev)pos+=flow;else if(tp<prev)neg+=flow;
  }
  if(pos===0&&neg===0)return 50;if(neg===0)return 100;const ratio=pos/neg;return 100-100/(1+ratio);
}
function cmf(rows,period){
  if(rows.length<period)return null;let mfv=0,vol=0;
  for(const r of rows.slice(-period)){const range=r.high-r.low;const mult=range>0?((r.close-r.low)-(r.high-r.close))/range:0;mfv+=mult*r.volume;vol+=r.volume}
  return vol>0?mfv/vol:null;
}
function relativeVolume(rows,period){
  if(rows.length<2)return null;const last=rows.at(-1).volume;const previous=rows.slice(Math.max(0,rows.length-period-1),-1).map(r=>r.volume).filter(Number.isFinite);const avg=previous.length?previous.reduce((a,b)=>a+b,0)/previous.length:null;return avg>0?last/avg:null;
}
function adlSeries(rows){let total=0;return rows.map(r=>{const range=r.high-r.low;const mult=range>0?((r.close-r.low)-(r.high-r.close))/range:0;total+=mult*r.volume;return total})}
function pvtSeries(rows){let total=0;return rows.map((r,i)=>{if(i>0&&rows[i-1].close>0)total+=((r.close-rows[i-1].close)/rows[i-1].close)*r.volume;return total})}
function normalizedTrend(series,rows,lookback){if(series.length<lookback+1)return null;const delta=series.at(-1)-series.at(-(lookback+1));const avgVol=sma(rows.map(r=>r.volume),Math.min(20,rows.length));return avgVol>0?delta/(avgVol*lookback):null}
function priceChange(rows,lookback){if(rows.length<lookback+1)return null;const prev=rows.at(-(lookback+1)).close;return prev>0?(rows.at(-1).close/prev-1)*100:null}
function oscillatorQuality(value,target=62,scale=2.4){return value===null?null:clamp(100-Math.abs(value-target)*scale)}
function weightedScore(parts,weights){let total=0,w=0;for(const [key,value] of Object.entries(parts)){if(value!==null&&Number.isFinite(value)){const weight=n(weights[key],0);total+=value*weight;w+=weight}}return w>0?total/w:null}
function classify(m){
  if(m.priceChange5Pct>0&&m.cmf20!==null&&m.cmf20<-.05)return {code:'POSSIBLE_DISTRIBUTION',labelAr:'احتمال تصريف أو صعود غير مدعوم'};
  if(m.priceChange5Pct<=0&&m.cmf20!==null&&m.cmf20>.08&&m.adlTrend5!==null&&m.adlTrend5>0)return {code:'POSSIBLE_ACCUMULATION',labelAr:'احتمال تراكم مبكر'};
  if(m.moneyFlowQualityScore!==null&&m.moneyFlowQualityScore>=70&&m.cmf20>0&&m.mfi14>=50&&m.relativeVolume20>=1)return {code:'CONFIRMED_MOMENTUM',labelAr:'زخم مدعوم نسبيًا بالحجم والتدفق'};
  if(m.priceChange5Pct>0&&(m.moneyFlowQualityScore===null||m.moneyFlowQualityScore<50||m.cmf20<=0))return {code:'UNCONFIRMED_RISE',labelAr:'صعود غير مؤكد بتدفق المال'};
  return {code:'NEUTRAL',labelAr:'زخم وتدفق محايدان'};
}
function pressure(m){
  let points=0,known=0;for(const [ok,weight] of [[m.cmf20!==null?m.cmf20>.08:null,2],[m.mfi14!==null?m.mfi14>=55:null,1],[m.adlTrend5!==null?m.adlTrend5>0:null,1],[m.relativeVolume20!==null?m.relativeVolume20>=1.1:null,1]]){if(ok!==null){known+=weight;if(ok)points+=weight}}
  if(!known)return {code:'UNKNOWN',labelAr:'غير متاح'};const ratio=points/known;return ratio>=.75?{code:'HIGH_ESTIMATE',labelAr:'ضغط شرائي مرتفع — تقديري'}:ratio>=.45?{code:'MEDIUM_ESTIMATE',labelAr:'ضغط شرائي متوسط — تقديري'}:{code:'LOW_ESTIMATE',labelAr:'ضغط شرائي ضعيف — تقديري'};
}
const policy=readJson(FILES.policy);if(!policy)throw new Error('Missing V13.17 intelligence policy');
const center=readJson(FILES.center,{candidates:[]});const candidateMap=new Map(A(center.candidates).map(x=>[ticker(x.ticker),x]));
if(!fs.existsSync(FILES.history))throw new Error('Missing data/history');
const files=fs.readdirSync(FILES.history).filter(name=>name.endsWith('.json')).sort();const rows=[];
for(const filename of files){const t=ticker(filename.replace(/\.json$/i,''));if(!t)continue;const doc=readJson(path.join(FILES.history,filename));const hist=historyRows(doc);const min=n(policy.indicators.minimumHistorySessions,20);const rsi14=rsiWilder(hist,n(policy.indicators.rsiPeriod,14));const mfi14=mfi(hist,n(policy.indicators.mfiPeriod,14));const cmf20=cmf(hist,n(policy.indicators.cmfPeriod,20));const rel=relativeVolume(hist,n(policy.indicators.relativeVolumePeriod,20));const look=n(policy.indicators.trendLookbackSessions,5);const adlTrend=normalizedTrend(adlSeries(hist),hist,look);const pvtTrend=normalizedTrend(pvtSeries(hist),hist,look);const components={
  rsi:oscillatorQuality(rsi14),mfi:oscillatorQuality(mfi14),cmf:cmf20===null?null:clamp(50+cmf20*200),relativeVolume:rel===null?null:clamp(rel/1.5*100),adlTrend:adlTrend===null?null:clamp(50+adlTrend*120),pvtTrend:pvtTrend===null?null:clamp(50+pvtTrend*120)
};
  const item={ticker:t,historyPath:`data/history/${filename}`,historySessions:hist.length,minimumHistoryMet:hist.length>=min,latestDate:hist.at(-1)?.date||null,latestClose:hist.at(-1)?.close||null,rsi14:round(rsi14,2),mfi14:round(mfi14,2),cmf20:round(cmf20,4),relativeVolume20:round(rel,3),adlTrend5:round(adlTrend,4),pvtTrend5:round(pvtTrend,4),priceChange5Pct:round(priceChange(hist,5),2),priceChange20Pct:round(priceChange(hist,20),2),components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,round(v,2)])),moneyFlowQualityScore:round(weightedScore(components,policy.indicators.scoreWeights),1),availableComponents:Object.values(components).filter(v=>v!==null).length,totalComponents:Object.keys(components).length,inTodayRecommendations:candidateMap.has(t),productionTechnicalRank:candidateMap.get(t)?.technicalRank||null,affectsProductionRanking:false,affectsProductionDecision:false,identityInference:false};
  item.classification=classify(item);item.buyingPressureEstimate=pressure(item);rows.push(item);
}
rows.sort((a,b)=>(b.moneyFlowQualityScore??-1)-(a.moneyFlowQualityScore??-1)||a.ticker.localeCompare(b.ticker));
const counts=rows.reduce((acc,x)=>(acc[x.classification.code]=(acc[x.classification.code]||0)+1,acc),{});
writeJson(FILES.output,{schemaVersion:'13.17.0',generatedAt:new Date().toISOString(),analysisSession:center.analysisSession||null,mode:'SHADOW_ONLY',affectsProductionRanking:false,affectsProductionDecision:false,changesStrategyRules:false,changesEntryStopTargets:false,identityInference:false,disclaimerAr:'المؤشرات تقيس السعر والحجم وتدفق المال تقديريًا فقط، ولا تكشف هوية الأفراد أو المؤسسات. لا تؤثر نتائجها في ترتيب أو قرارات النسخة الحالية.',summary:{historyFiles:files.length,analyzedStocks:rows.length,minimumHistoryMet:rows.filter(x=>x.minimumHistoryMet).length,todayCandidates:rows.filter(x=>x.inTodayRecommendations).length,classifications:counts},stocks:rows});
console.log(`V13.17 momentum/money-flow: analyzed=${rows.length}, confirmed=${counts.CONFIRMED_MOMENTUM||0}, accumulation=${counts.POSSIBLE_ACCUMULATION||0}.`);
