#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const OUT_DECISION = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const OUT_RESEARCH = path.join(ROOT, 'data/research/v15-practical-validation.json');
const OUT_MISSED = path.join(ROOT, 'data/research/v15-missed-opportunities.json');
const COST_PCT = 0.6;

const n = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;
const round = (v, d = 2) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const mean = a => { const x = a.filter(Number.isFinite); return x.length ? x.reduce((s,v)=>s+v,0)/x.length : null; };
const median = a => { const x=a.filter(Number.isFinite).sort((a,b)=>a-b); if(!x.length)return null; const m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2; };
const clamp = (v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const dateOnly = v => (String(v||'').match(/^(\d{4}-\d{2}-\d{2})/)||[])[1]||null;
const pct = (a,b)=>b>0?((a/b)-1)*100:null;

function readJson(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;} }
function writeJson(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp-${process.pid}`; fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n'); JSON.parse(fs.readFileSync(tmp,'utf8')); fs.renameSync(tmp,file); }

function normalize(file){
  const doc=readJson(file,{}); const ticker=String(doc.ticker||path.basename(file,'.json')).toUpperCase();
  const rows=(Array.isArray(doc.sessions)?doc.sessions:Array.isArray(doc)?doc:[]).map(r=>({
    date:dateOnly(r.date||r.sessionDate),open:n(r.open),high:n(r.high),low:n(r.low),close:n(r.close),volume:n(r.volume,0)
  })).filter(r=>r.date&&r.open>0&&r.high>=r.open&&r.high>=r.close&&r.low<=r.open&&r.low<=r.close&&r.low>0).sort((a,b)=>a.date.localeCompare(b.date));
  return {ticker,companyNameAr:doc.companyNameAr||doc.companyNameEn||ticker,verified:doc.symbolVerified!==false,stale:doc.staleData===true,rows};
}
function sma(rows,i,len,key='close'){ if(i-len+1<0)return null; return mean(rows.slice(i-len+1,i+1).map(r=>n(r[key])).filter(Number.isFinite)); }
function atr(rows,i,len=14){ if(i-len+1<1)return null; const x=[]; for(let j=i-len+1;j<=i;j++){const pc=rows[j-1].close;x.push(Math.max(rows[j].high-rows[j].low,Math.abs(rows[j].high-pc),Math.abs(rows[j].low-pc)));} return mean(x); }
function rsi(rows,i,len=14){ if(i-len<0)return null;let g=0,l=0;for(let j=i-len+1;j<=i;j++){const c=rows[j].close-rows[j-1].close;c>=0?g+=c:l-=c;}const ag=g/len,al=l/len;return al===0?100:100-100/(1+ag/al); }

function feature(history,i){
  const rows=history.rows;if(i<55)return null; const row=rows[i], close=row.close;
  const s10=sma(rows,i,10),s20=sma(rows,i,20),s50=sma(rows,i,50),a14=atr(rows,i),r14=rsi(rows,i);
  const av=sma(rows,i-1,20,'volume'); const vr=av>0?row.volume/av:null;
  const turnover=mean(rows.slice(i-19,i+1).map(r=>r.close*r.volume));
  const prior=rows.slice(i-20,i); const high20=Math.max(...prior.map(r=>r.high)), low20=Math.min(...prior.map(r=>r.low));
  const ret1=pct(close,rows[i-1]?.close),ret3=pct(close,rows[i-3]?.close),ret5=pct(close,rows[i-5]?.close),ret10=pct(close,rows[i-10]?.close),ret20=pct(close,rows[i-20]?.close);
  const atrPct=a14>0?a14/close*100:null; const rangePos=high20>low20?(close-low20)/(high20-low20):0.5;
  if(![s10,s20,s50,a14,r14,vr,turnover,ret1,ret3,ret5,ret10,ret20,atrPct].every(Number.isFinite))return null;
  if(atrPct<0.4||atrPct>14||Math.abs(ret1)>30)return null;
  return {ticker:history.ticker,companyNameAr:history.companyNameAr,date:row.date,index:i,rows,open:row.open,high:row.high,low:row.low,close,volume:row.volume,s10,s20,s50,a14,r14,vr,turnover,high20,low20,rangePos,ret1,ret3,ret5,ret10,ret20,atrPct,breakoutPct:pct(close,high20),trend:close>s20&&s20>s50};
}

function buildStore(histories){
  const byDate=new Map(), byTicker=new Map();
  for(const h of histories){const list=[];for(let i=55;i<h.rows.length;i++){const f=feature(h,i);if(!f)continue;list.push(f);const d=byDate.get(f.date)||[];d.push(f);byDate.set(f.date,d);}byTicker.set(h.ticker,list);}
  const dates=[...byDate.keys()].sort();
  for(const date of dates){const list=byDate.get(date);const market20=median(list.map(x=>x.ret20));for(const f of list)f.rs20=f.ret20-market20;}
  return {byDate,byTicker,dates};
}

const MODELS=[
  {id:'BREAKOUT_CONTINUATION',labelAr:'اختراق مع استمرار وسيولة',profile:'FAST',eligible:f=>f.trend&&f.breakoutPct>=-0.5&&f.vr>=1.05&&f.ret5>=1&&f.ret20>=4&&f.rs20>=1&&f.r14>=52&&f.r14<=82,score:f=>f.breakoutPct*5+f.ret5*2.4+f.ret20*.45+f.rs20*1.6+Math.min(f.vr,4)*7+f.rangePos*12-Math.max(0,f.r14-78)*2-Math.max(0,f.atrPct-8)*2},
  {id:'MOMENTUM_ACCELERATION',labelAr:'تسارع زخم نسبي',profile:'BALANCED',eligible:f=>f.close>f.s10&&f.s10>f.s20&&f.s20>f.s50&&f.ret3>0.8&&f.ret10>3&&f.ret20>5&&f.rs20>2&&f.vr>=0.8&&f.r14>=50&&f.r14<=80,score:f=>f.ret3*3+f.ret5*2+f.ret10+f.ret20*.35+f.rs20*1.8+Math.min(f.vr,3)*5+f.rangePos*10-Math.max(0,f.atrPct-7)*1.5},
  {id:'TREND_RESUMPTION',labelAr:'استئناف الاتجاه بعد هدوء',profile:'BALANCED',eligible:f=>f.trend&&f.close>f.s10&&f.ret1>0&&f.ret5>-1&&f.ret20>5&&f.rs20>1&&f.vr>=0.7&&f.rangePos>=0.55&&f.r14>=48&&f.r14<=72,score:f=>f.ret1*3+f.ret5*1.2+f.ret20*.45+f.rs20*1.5+Math.min(f.vr,2.5)*5+f.rangePos*12-Math.abs(f.r14-60)*.5},
  {id:'LIQUID_LEADERS',labelAr:'قيادات سائلة قوية نسبيًا',profile:'FAST',eligible:f=>f.trend&&f.ret5>0&&f.ret20>3&&f.rs20>2&&f.vr>=0.75&&f.turnover>=5000000&&f.r14>=50&&f.r14<=78,score:f=>Math.log10(Math.max(f.turnover,1))*4+f.ret5*1.8+f.ret20*.35+f.rs20*1.7+Math.min(f.vr,3)*4+f.rangePos*8}
];
const PROFILES={
  FAST:{stopAtr:1.25,targetAtr:1.0,maxHold:3,labelAr:'هدف سريع مع وقف أوسع نسبيًا'},
  BALANCED:{stopAtr:1.35,targetAtr:1.35,maxHold:5,labelAr:'هدف ووقف متوازنان'},
  TREND:{stopAtr:1.5,targetAtr:2.0,maxHold:10,labelAr:'استمرار اتجاه متوسط'}
};

function simulate(f,profile){
  const p=PROFILES[profile], rows=f.rows, future=rows.slice(f.index+1,f.index+1+p.maxHold); if(!future.length)return null;
  const next=future[0], gap=pct(next.open,f.close); if(gap>5||next.open<=0)return {entered:false,status:'CANCELLED_GAP',returnPct:0,target:false,stop:false};
  const entry=next.open; const stop=entry-f.a14*p.stopAtr; const target=entry+f.a14*p.targetAtr; if(stop<=0)return null;
  let exit=future.at(-1).close,status='TIME_EXIT',targetHit=false,stopHit=false,hold=future.length;
  for(let j=0;j<future.length;j++){const r=future[j],s=r.low<=stop,t=r.high>=target;if(s){exit=stop;status=t?'STOP_FIRST_SAME_BAR':'STOP';stopHit=true;hold=j+1;break;}if(t){exit=target;status='TARGET';targetHit=true;hold=j+1;break;}}
  return {entered:true,status,entry:round(entry,4),stop:round(stop,4),target:round(target,4),returnPct:round(pct(exit,entry)-COST_PCT,3),targetHit,stopHit,hold};
}
function metrics(items){
  const trades=items.filter(x=>x.sim?.entered);const returns=trades.map(x=>x.sim.returnPct);const wins=returns.filter(x=>x>0),losses=returns.filter(x=>x<0);const gp=wins.reduce((s,v)=>s+v,0),gl=Math.abs(losses.reduce((s,v)=>s+v,0));
  return {signals:items.length,entered:trades.length,targetHits:trades.filter(x=>x.sim.targetHit).length,stopHits:trades.filter(x=>x.sim.stopHit).length,targetRatePct:trades.length?round(trades.filter(x=>x.sim.targetHit).length/trades.length*100,1):null,stopRatePct:trades.length?round(trades.filter(x=>x.sim.stopHit).length/trades.length*100,1):null,winRatePct:trades.length?round(wins.length/trades.length*100,1):null,averageReturnPct:round(mean(returns),2),medianReturnPct:round(median(returns),2),profitFactor:gl>0?round(gp/gl,2):gp>0?99:null};
}

function candidateRows(store,model,date){return (store.byDate.get(date)||[]).filter(model.eligible).sort((a,b)=>model.score(b)-model.score(a)).slice(0,5);}
function evaluateModel(store,model,dates){const out=[];for(const date of dates){for(const f of candidateRows(store,model,date)){const sim=simulate(f,model.profile);if(sim)out.push({date,ticker:f.ticker,score:round(model.score(f),2),sim});}}return {rows:out,metrics:metrics(out)};}
function passValidation(m){return m.entered>=20&&n(m.averageReturnPct,-99)>0.15&&n(m.profitFactor,0)>=1.15&&n(m.winRatePct,0)>=48&&n(m.targetRatePct,0)>n(m.stopRatePct,100);}
function rankValidation(m){return n(m.averageReturnPct,-99)*8+n(m.profitFactor,0)*3+n(m.winRatePct,0)*.08+(n(m.targetRatePct,0)-n(m.stopRatePct,100))*.1;}

function missedOpportunities(store,latestDates){
  const result=[];
  for(const date of latestDates){const list=store.byDate.get(date)||[];for(const f of list){const future=f.rows[f.index+3];if(!future)continue;const r3=pct(future.close,f.close);if(r3>=5)result.push({signalDate:date,ticker:f.ticker,companyNameAr:f.companyNameAr,forward3Pct:round(r3,2),ret5:round(f.ret5,2),ret20:round(f.ret20,2),relativeStrength20:round(f.rs20,2),volumeRatio20:round(f.vr,2),breakoutPct:round(f.breakoutPct,2),rsi14:round(f.r14,1),trend:f.trend,matchedModels:MODELS.filter(m=>m.eligible(f)).map(m=>m.id)});}}
  const missed=result.filter(x=>!x.matchedModels.length).sort((a,b)=>b.forward3Pct-a.forward3Pct);
  return {winners:result.length,modelCaptured:result.length-missed.length,captureRatePct:result.length?round((result.length-missed.length)/result.length*100,1):null,topMissed:missed.slice(0,40),topWinners:result.sort((a,b)=>b.forward3Pct-a.forward3Pct).slice(0,40)};
}

function main(){
  if(!fs.existsSync(HISTORY_DIR))throw new Error('Missing data/history');
  const histories=fs.readdirSync(HISTORY_DIR).filter(x=>x.endsWith('.json')).map(x=>normalize(path.join(HISTORY_DIR,x))).filter(h=>h.verified&&!h.stale&&h.rows.length>=80);
  const store=buildStore(histories);const usable=store.dates.filter((date,idx)=>idx>=5&&idx<store.dates.length-5&&(store.byDate.get(date)||[]).length>=80);
  if(usable.length<30)throw new Error(`Insufficient cross-sectional sessions: ${usable.length}`);
  const devEnd=Math.floor(usable.length*.55),valEnd=Math.floor(usable.length*.8);const development=usable.slice(0,devEnd),validation=usable.slice(devEnd,valEnd),test=usable.slice(valEnd);
  const modelResults=MODELS.map(model=>{const dev=evaluateModel(store,model,development),val=evaluateModel(store,model,validation),testResult=evaluateModel(store,model,test);return {id:model.id,labelAr:model.labelAr,profile:model.profile,development:dev.metrics,validation:val.metrics,test:testResult.metrics,validationPassed:passValidation(val.metrics),testPassed:passValidation(testResult.metrics),selectionScore:round(rankValidation(val.metrics),2)};}).sort((a,b)=>b.selectionScore-a.selectionScore);
  const selected=modelResults.find(x=>x.validationPassed&&x.testPassed)||null;
  const latestDate=store.dates.at(-1);const latestRows=selected?candidateRows(store,MODELS.find(m=>m.id===selected.id),latestDate):[];
  const recommendations=[];if(selected){const model=MODELS.find(m=>m.id===selected.id),p=PROFILES[model.profile];for(const [i,f] of latestRows.entries()){const stop=f.close-f.a14*p.stopAtr,target=f.close+f.a14*p.targetAtr;recommendations.push({rank:i+1,ticker:f.ticker,companyNameAr:f.companyNameAr,strategyId:model.id,strategyLabelAr:model.labelAr,score:round(model.score(f),2),close:round(f.close,4),entryLow:round(f.close-f.a14*.15,4),entryHigh:round(f.close+f.a14*.15,4),stopLoss:round(stop,4),target1:round(target,4),riskReward:round((target-f.close)/(f.close-stop),2),holdingSessions:p.maxHold,ret5Pct:round(f.ret5,2),ret20Pct:round(f.ret20,2),relativeStrength20Pct:round(f.rs20,2),volumeRatio20:round(f.vr,2),rsi14:round(f.r14,1),averageTurnover20Egp:round(f.turnover,0),status:'PRACTICAL_CANDIDATE_PENDING_PRICE_CONFIRMATION',statusAr:'فرصة عملية مشروطة بتأكيد سعر الافتتاح وعدم حدوث فجوة'});}}
  const latestRecent=usable.slice(-20);const missed=missedOpportunities(store,latestRecent);
  const practicalReady=Boolean(selected&&recommendations.length);
  const decision={schemaVersion:'15.0.0',generatedAt:new Date().toISOString(),sessionDate:latestDate,mode:'FULL_MARKET_CROSS_SECTIONAL_WALK_FORWARD',practicalReady,status:practicalReady?'PRACTICAL_CANDIDATES_AVAILABLE':'NO_VALIDATED_STRATEGY',statusAr:practicalReady?`توجد ${recommendations.length} فرص عملية مشروطة من مسح السوق بالكامل`:'لا توجد استراتيجية اجتازت التحقق والاختبار النهائي؛ لا يتم اختلاق توصيات',selectedModel:selected,recommendations,marketScan:{histories:histories.length,symbolsLatest:(store.byDate.get(latestDate)||[]).length,latestDate},guardrails:{fullMarketScan:true,developmentValidationTestSplit:true,futureLeakageForbidden:true,transactionCostsPct:COST_PCT,targetProbabilityMustExceedStopProbability:true,manualOpeningPriceConfirmation:true,automaticOrders:false},missedOpportunityCapture:missed.captureRatePct};
  writeJson(OUT_RESEARCH,{schemaVersion:'15.0.0',generatedAt:new Date().toISOString(),sessions:{development:development.length,validation:validation.length,test:test.length},models:modelResults,selection:selected?selected.id:null,selectionRule:'Model must pass both validation and untouched test; target rate must exceed stop rate.',costPct:COST_PCT});
  writeJson(OUT_MISSED,{schemaVersion:'15.0.0',generatedAt:new Date().toISOString(),sessionsAnalyzed:latestRecent.length,...missed});
  writeJson(OUT_DECISION,decision);
  console.log(JSON.stringify({latestDate,histories:histories.length,usableSessions:usable.length,selected:selected?.id||null,models:modelResults,recommendations:recommendations.map(x=>x.ticker),missedCapture:missed.captureRatePct},null,2));
}
main();
