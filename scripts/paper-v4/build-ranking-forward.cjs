#!/usr/bin/env node
/* EGX PRO independent transparent ranking and chronological research ledger.
 * Never upgrades research to a real-money trade recommendation.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),IN=path.join(ROOT,'data/history'),OUT=path.join(ROOT,'data/paper-v4/ranking-latest.json');
const num=x=>Number.isFinite(Number(x))?Number(x):null;
const round=(x,d=3)=>x==null?null:Number(x.toFixed(d));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const positions=(a)=>a.filter(x=>Number.isFinite(x));
function assess(h,cutoff){
 const ss=(h.sessions||[]).filter(x=>x.date<=cutoff&&num(x.close)>0).sort((a,b)=>a.date.localeCompare(b.date));
 const t=ss.at(-1),prev=ss.at(-2),cl=ss.map(x=>num(x.close)),vol=ss.map(x=>num(x.volume)||0);
 const ma20=mean(cl.slice(-20)),ma50=mean(cl.slice(-50)),volume20=mean(vol.slice(-21,-1));
 const ret20=cl.length>=21?100*(t.close/cl.at(-21)-1):null;
 const ret5=cl.length>=6?100*(t.close/cl.at(-6)-1):null;
 const volumeRatio=volume20>0?t.volume/volume20:null;
 const momentum=(ret20||0)*0.45+(ret5||0)*0.55;
 const trend=ma20&&ma50?(t.close>ma20?15:0)+(ma20>ma50?15:0):0;
 const liquidity=volume20&&t.close?Math.min(20,Math.log10(1+volume20*t.close)*2.5):0;
 const score=Math.max(0,Math.min(100,round(40+momentum+trend+liquidity,2)));
 const latest=ss.at(-1)?.date||null;
 const sourceWarnings=(h.warnings||[]).filter(x=>/conflict|identity|stale|unverified/i.test(x));
 const cutoffIsLatest=latest===h.lastSession;
 const issues=[];
 if(ss.length<60) issues.push('INSUFFICIENT_HISTORY');
 if(!h.symbolVerified)issues.push('SYMBOL_NOT_VERIFIED');
 if(!h.officiallyVerifiedLatestSession)issues.push('LATEST_SESSION_NOT_OFFICIALLY_VERIFIED');
 if(sourceWarnings.length)issues.push('SOURCE_PRICE_CONFLICT');
 if(!volume20||volume20*t.close<1000000)issues.push('LOW_LIQUIDITY');
 if(ma20&&t.close<ma20)issues.push('BELOW_MA20');
 if(!cutoffIsLatest)issues.push('HISTORICAL_CUTOFF');
 const filters=[
  {id:'HISTORY',passed:ss.length>=60,hard:true,detail:ss.length+' sessions'},
  {id:'IDENTITY',passed:!!h.symbolVerified,hard:true},
  {id:'PRICE_VERIFICATION',passed:!!h.officiallyVerifiedLatestSession,hard:true},
  {id:'SOURCE_AGREEMENT',passed:!sourceWarnings.length,hard:true,detail:sourceWarnings.join('|')},
  {id:'LIQUIDITY',passed:!!volume20&&volume20*t.close>=1000000,hard:true,detail:round(volume20*t.close)},
  {id:'TREND_MA20',passed:!!ma20&&t.close>=ma20,hard:false},
  {id:'TREND_MA50',passed:!!ma50&&t.close>=ma50,hard:false},
  {id:'MOMENTUM_20',passed:ret20!=null&&ret20>0,hard:false},
  {id:'VOLUME_CONFIRMATION',passed:volumeRatio!=null&&volumeRatio>=1,hard:false}
 ];
 const hard=filters.some(x=>x.hard&&!x.passed);
 const technicalPassed=filters.filter(x=>!x.hard&&x.passed).length;
 const decision=hard?'DATA_OR_RISK_HOLD':technicalPassed>=3?'PAPER_RESEARCH_CANDIDATE':'CONDITIONAL_WATCH';
 return {ticker:h.ticker,companyNameAr:h.companyNameAr||'',date:latest,close:round(num(t?.close)),beforeScore:score,afterScore:hard?null:score,rankEligible:!hard,stage:decision,filters,technicalPassed,reasons:issues.concat(filters.filter(x=>!x.passed).map(x=>'FILTER_'+x.id)),indicators:{ma20:round(ma20),ma50:round(ma50),return5Pct:round(ret5),return20Pct:round(ret20),volumeRatio:round(volumeRatio),averageTurnoverEgp:round(volume20*t.close)},source:h.primarySource||null};
}
function build(){
 const histories=fs.readdirSync(IN).filter(f=>f.endsWith('.json')).map(f=>{try{const h=JSON.parse(fs.readFileSync(path.join(IN,f),'utf8'));return h.sessions?.length?h:null}catch{return null}}).filter(Boolean);
 const latest=histories.map(h=>h.lastSession).filter(Boolean).sort().at(-1);
 const all=histories.map(h=>assess(h,latest)).sort((a,b)=>b.beforeScore-a.beforeScore);
 all.forEach((x,i)=>x.beforeRank=i+1);
 const after=all.filter(x=>x.rankEligible).sort((a,b)=>b.afterScore-a.afterScore);
 after.forEach((x,i)=>x.afterRank=i+1);
 // Forward-only research: take a signal from day t-1, score its next available session.
 // Do NOT use same-session close as an executable fill or optimize thresholds on holdout.
 const ledger=[];
 for(const h of histories){
  const ss=(h.sessions||[]).filter(x=>num(x.close)>0).sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=60;i<ss.length-1;i++){
   const cutoff=ss[i].date,signal=assess({...h,lastSession:cutoff,officiallyVerifiedLatestSession:h.officiallyVerifiedLatestSession},cutoff);
   if(signal.stage!=='PAPER_RESEARCH_CANDIDATE')continue;
   const next=ss[i+1],entry=num(next.open),exit=num(next.close);
   if(!(entry>0&&exit>0))continue;
   ledger.push({ticker:h.ticker,signalDate:cutoff,observedDate:next.date,score:signal.beforeScore,returnPct:round(100*(exit-entry)/entry,4),model:'next_open_to_close_observation_ONLY',costsIncluded:false});
  }
 }
 const n=ledger.length,ret=ledger.map(x=>x.returnPct),wins=ret.filter(x=>x>0).length;
 const output={schemaVersion:'v4-ranking-forward-0.1',generatedAt:new Date().toISOString(),latestSession:latest,status:'RESEARCH_ONLY_NOT_VERIFIED_FOR_LIVE_TRADING',noteAr:'الترتيب بحثي. أي تعارض في المصدر أو غياب التحقق الرسمي يمنع تحويل السهم إلى توصية تنفيذ. اختبار اليوم التالي تشخيصي وليس اختبار أداء قابل للتداول؛ لم تُطبق تكاليف أو انزلاق أو وقف وخروج.',counts:{analyzed:all.length,eligible:after.length,held:all.length-after.length,paperResearchCandidates:all.filter(x=>x.stage==='PAPER_RESEARCH_CANDIDATE').length,conditionalWatch:all.filter(x=>x.stage==='CONDITIONAL_WATCH').length,forwardObservations:n},beforeFilters:all,afterFilters:after,forwardResearch:{observations:n,winRatePct:n?round(100*wins/n,2):null,averageGrossReturnPct:n?round(mean(ret),3):null,netTradableMetricsAvailable:false,thresholdsFrozenBeforeHoldout:false},forwardLedger:ledger};
 fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
 console.log('V4 ranking',latest,output.counts,'forward observations:',n,'AMOC:',all.find(x=>x.ticker==='AMOC')?.stage,'ENGC:',all.find(x=>x.ticker==='ENGC')?.stage);
}
if(require.main===module)build();
module.exports={assess};
