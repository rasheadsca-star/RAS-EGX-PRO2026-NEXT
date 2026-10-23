'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw new Error('Research replay must not enable live trading');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const {confirmedClosures,isTradingSession}=require('../ops/egx-session-math.cjs');
const round=(v,n=3)=>Number(v.toFixed(n));
function sma(a){return a.reduce((x,y)=>x+y,0)/a.length}
function rsi(closes){const a=closes.slice(-15);if(a.length<15)return null;let gain=0,loss=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}return loss===0?100:100-100/(1+gain/loss)}
function indicators(window,config){
 if(window.length<55)return null;
 const c=window.at(-1),previous=window.slice(-21,-1),priorHigh=Math.max(...previous.map(x=>x.high));
 const avgVol=sma(previous.map(x=>x.volume));
 if(!(avgVol>0))return null;
 const rs=rsi(window.map(x=>x.close)),vr=c.volume/avgVol;
 const strict=config.strategies.breakout.variants.find(x=>x.id==='strict');
 const breakout=c.close>priorHigh*(1+strict.breakoutBufferPct/100)&&vr>=strict.minVolumeRatio&&rs>=strict.minRsi&&rs<=strict.maxRsi;
 // VCP proxy: contraction of preceding 10-bar price range relative to earlier 20 bars,
 // with declining volume, before today. Not parity-certified original V18 VCP.
 const recent=window.slice(-11,-1),older=window.slice(-31,-11);
 const recentRange=(Math.max(...recent.map(x=>x.high))-Math.min(...recent.map(x=>x.low)))/sma(recent.map(x=>x.close));
 const olderRange=(Math.max(...older.map(x=>x.high))-Math.min(...older.map(x=>x.low)))/sma(older.map(x=>x.close));
 const dryup=sma(window.slice(-6,-1).map(x=>x.volume))<sma(window.slice(-21,-1).map(x=>x.volume));
 const trend=c.close>sma(window.slice(-20).map(x=>x.close))&&sma(window.slice(-20).map(x=>x.close))>sma(window.slice(-50).map(x=>x.close));
 const vcp=trend&&recentRange<olderRange&&dryup;
 const momentum20Pct=(c.close/window.at(-21).close-1)*100;
 const avgTurnover20=sma(previous.map(x=>x.close*x.volume));
 const aboveSma50=c.close>sma(window.slice(-50).map(x=>x.close));
 const closePosition=(c.high-c.low)>0?(c.close-c.low)/(c.high-c.low):null;
 const extensionSma20Pct=(c.close/sma(window.slice(-20).map(x=>x.close))-1)*100;
 const periods=window.slice(-15);const trueRanges=periods.map((bar,i)=>Math.max(bar.high-bar.low,Math.abs(bar.high-(i?periods[i-1].close:window.at(-16).close)),Math.abs(bar.low-(i?periods[i-1].close:window.at(-16).close))));
 const atr14Pct=sma(trueRanges.slice(-14))/c.close*100;
 return {breakout,vcp,hybrid:breakout&&vcp,rs,volumeRatio:vr,momentum20Pct,avgTurnover20,aboveSma50,closePosition,extensionSma20Pct,atr14Pct};
}
function replay(rows,config){
 const signalRows=[],trades=[];
 const blockedUntil={breakout:-1,vcp:-1,hybrid:-1};
 for(let i=54;i<rows.length-1;i++){
  const features=indicators(rows.slice(0,i+1),config);
  if(!features)continue;
  const labels=['breakout','vcp','hybrid'].filter(x=>features[x]);if(!labels.length)continue;
  const next=rows[i+1],entry=next.open*(1+config.research.entrySlippagePct/100);
  const future=rows.slice(i+1,i+1+config.research.maximumHoldingSessions);
  if(!future.length||entry<=0)continue;
  const stop=entry*0.95,target=entry*1.09;let exit=future.at(-1).close,status='TIME_EXIT',exitOffset=future.length-1;
  for(let j=0;j<future.length;j++){const bar=future[j];if(bar.low<=stop){exit=stop;status='STOP';exitOffset=j;break}if(bar.high>=target){exit=target;status='TARGET';exitOffset=j;break}}
  const exitIndex=i+1+exitOffset,net=round((exit/entry-1)*100-config.research.roundTripCostPct);
  signalRows.push({date:rows[i].date,signals:labels});
  for(const label of labels){if(i<blockedUntil[label])continue;blockedUntil[label]=exitIndex;trades.push({variant:label,signalDate:rows[i].date,entryDate:next.date,exitDate:rows[exitIndex].date,netReturnPct:net,status,signalFeatures:{volumeRatio:round(features.volumeRatio),momentum20Pct:round(features.momentum20Pct),avgTurnover20:round(features.avgTurnover20,0),aboveSma50:features.aboveSma50,closePosition:features.closePosition===null?null:round(features.closePosition),extensionSma20Pct:round(features.extensionSma20Pct),atr14Pct:round(features.atr14Pct)}});}
 }
 return {signalRows,trades};
}
function summarize(trades){const v=trades.map(t=>t.netReturnPct),wins=v.filter(x=>x>0),loss=v.filter(x=>x<0);return {signals:trades.length,winRatePct:v.length?round(wins.length/v.length*100,2):null,meanNetReturnPct:v.length?round(sma(v)):null,profitFactor:loss.length?round(wins.reduce((a,b)=>a+b,0)/(-loss.reduce((a,b)=>a+b,0))):null}}
function main(){
 const config=read('data/v13-4-quant-policy.json'),closed=confirmedClosures(root),dir=path.join(root,'data/history');
 const aggregate=[],coverage={files:0,tradable:0};
 for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
  coverage.files++;
  let doc;try{doc=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))}catch{continue}
  if(!Array.isArray(doc.sessions))continue;
  const seen=new Set();
  const rows=doc.sessions.map(x=>({date:String(x.date||x.sessionDate||'').slice(0,10),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume),invalid:x.validationStatus==='source_conflict'||(x.warnings||[]).some(w=>/price_conflict/i.test(String(w)))})).filter(x=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!isTradingSession(x.date,closed)||seen.has(x.date)||x.invalid||![x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite)||x.volume<=0||x.low<=0||x.high<Math.max(x.open,x.close,x.low)||x.low>Math.min(x.open,x.close,x.high))return false;
   seen.add(x.date);return true;
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.length<56)continue;coverage.tradable++;
  const result=replay(rows,config);for(const trade of result.trades)aggregate.push({...trade,ticker:doc.ticker||name.slice(0,-5)});
 }
 const variants=['breakout','vcp','hybrid'].map(v=>({variant:v,...summarize(aggregate.filter(x=>x.variant===v))}));
 const result={schemaVersion:'hybrid-alpha-early-replay-1',generatedAt:new Date().toISOString(),researchOnly:true,method:'research proxy, NO strategy parity certification; simple 5% stop 9% target and next-session open; per-ticker per-variant overlapping positions blocked',coverage,variants,trades:aggregate,limitations:['VCP uses explicit proxy, not recovered exact V18 implementation','Relative strength vs index and independent historical universe screening are not implemented','Results are exploratory in-sample and must not be used for live recommendations' ,'No portfolio-level cash allocation or realistic portfolio equity curve']};
 const dst=path.join(root,'data/research/hybrid-alpha-v1-early-replay.json');fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({coverage,variants},null,2));
}
if(require.main===module)main();
module.exports={indicators,replay,summarize};
