#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'gann-fusion-x','data');
const HIST=path.join(ROOT,'data','history');
const Fusion=require(path.join(ROOT,'gann-fusion-x','engine','fusion.js'));
const Planner=require(path.join(ROOT,'gann-fusion-x','engine','planner.js'));
const I=require(path.join(ROOT,'gann-fusion-x','engine','indicators.js'));
const M=require(path.join(ROOT,'gann-fusion-x','engine','math.js'));

const COST=0.6;
const HOLD=3;
const TOPN=3;
const EXTENDED_DATES=60;

function read(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){return fallback}}
function round(n,d=4){if(!Number.isFinite(Number(n)))return null;return Number(Number(n).toFixed(d))}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function median(a){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function pct(a,b){return b?((a/b)-1)*100:0}
function rawBars(doc){return(doc?.sessions||[]).map(x=>({date:x.date,open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume||0)})).filter(x=>x.close>0&&x.high>0&&x.low>0).sort((a,b)=>a.date.localeCompare(b.date))}
function adjustedBars(doc){return(doc?.sessions||[]).map(x=>{const close=Number(x.close),adj=Number(x.adjustedClose??x.close),f=close?adj/close:1;return{date:x.date,open:Number(x.open)*f,high:Number(x.high)*f,low:Number(x.low)*f,close:adj,volume:Number(x.volume||0)}}).filter(x=>x.close>0&&x.high>0&&x.low>0).sort((a,b)=>a.date.localeCompare(b.date))}
function toDate(bs,date){return bs.filter(x=>x.date<=date)}
function future(bs,date,n=HOLD){return bs.filter(x=>x.date>date).slice(0,n)}

const files=fs.readdirSync(HIST).filter(x=>x.endsWith('.json'));
const universe=[];
for(const file of files){const doc=read(path.join(HIST,file));if(!doc)continue;const raw=rawBars(doc),adj=adjustedBars(doc);if(adj.length<55)continue;universe.push({ticker:String(doc.ticker||file.replace(/\.json$/i,'')).toUpperCase(),nameAr:doc.companyNameAr||doc.companyNameEn||'',raw,adj});}
const byTicker=new Map(universe.map(x=>[x.ticker,x]));

function buildBenchmark(date){const map=new Map();for(const u of universe){const bs=toDate(u.adj,date);if(bs.length<30||bs.at(-1)?.date!==date)continue;const base=bs[0].close;if(!base)continue;for(const b of bs){if(!map.has(b.date))map.set(b.date,[]);map.get(b.date).push(b.close/base*100)}}return[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,v])=>{const c=mean(v);return{date:d,open:c,high:c,low:c,close:c,volume:1}})}

function gannCandidates(date){const market=buildBenchmark(date),rows=[];for(const u of universe){const bs=toDate(u.adj,date);if(bs.length<50||bs.at(-1)?.date!==date)continue;const a=Fusion.analyze({ticker:u.ticker,nameAr:u.nameAr,bars:bs,marketBars:market,fundamentals:{score:50,verified:false},dataQuality:{fresh:true,conflict:false}});if(!a.valid)continue;const p=Planner.buildPlan(a,'speculative',{portfolioValue:100000,riskPct:.5,verifiedFundamentals:false});if(!p.eligible)continue;rows.push({engine:'GANN_FUSION_X',date,ticker:u.ticker,score:p.score,levels:p.levels,sourceScale:'adjusted',meta:{fusion:a.score,gannActive:a.parts.gannTime.active,breakout:a.parts.breakout.confirmed?'CONFIRMED':a.parts.breakout.near?'NEAR':'NO',rsi:a.parts.momentum.rsi14}})}return rows.sort((a,b)=>b.score-a.score).slice(0,TOPN)}

function sepaProxyCandidates(date){const market=buildBenchmark(date),rows=[];for(const u of universe){const bs=toDate(u.adj,date);if(bs.length<50||bs.at(-1)?.date!==date)continue;const trend=I.trend(bs),rs=I.rs(bs,market),mom=I.momentum(bs),vol=I.volume(bs),bo=I.breakout(bs);const rp=Fusion.risk(bs,{nextAbove:0},bo);const entry=bo.confirmed?90:bo.near?78:Math.max(25,bo.score);const fund=50;const score=round(trend.score*.20+rs.score*.15+mom.score*.10+vol.score*.15+entry*.15+rp.score*.15+fund*.10,1);const avoid=trend.score<60||rs.score<20||mom.overheated;const actionable=!avoid&&entry>=75&&trend.score>=85&&rs.score>=70&&rp.rr>=2&&((rp.entryHigh-rp.stopLoss)/Math.max(.0001,rp.entryHigh)*100)<=8;const recommendation=!avoid&&(actionable||bo.near||bo.confirmed||score>=72);if(!recommendation)continue;const e=(rp.entryLow+rp.entryHigh)/2,r=Math.max(.0001,e-rp.stopLoss);rows.push({engine:'SEPA_X_PROXY',date,ticker:u.ticker,score,actionable,levels:{entryLow:rp.entryLow,entryHigh:rp.entryHigh,trigger:rp.trigger,stopLoss:rp.stopLoss,target1:rp.target1,target2:rp.target2,target3:round(e+r*3,4)},sourceScale:'adjusted',meta:{trend:trend.score,rs:rs.score,momentum:mom.score,volume:vol.score,entry,risk:rp.score,fundamentalsNeutral:true}})}return rows.sort((a,b)=>Number(b.actionable)-Number(a.actionable)||b.score-a.score).slice(0,TOPN)}

function v16Candidates(session){return(session.members||[]).map(m=>({engine:'V16_9_LIVE',date:session.signalDate,ticker:String(m.ticker).toUpperCase(),score:null,levels:{entryLow:Number(m.entryLow),entryHigh:Number(m.entryHigh),trigger:Number(m.entryHigh),stopLoss:Number(m.stopLoss),target1:Number(m.target1),target2:null,target3:null},sourceScale:'raw',meta:{logged:true,weightPct:m.weightPct||null}})).filter(x=>byTicker.has(x.ticker)&&x.levels.entryLow>0&&x.levels.entryHigh>0&&x.levels.stopLoss>0&&x.levels.target1>0)}

function evaluate(sig){const u=byTicker.get(sig.ticker);if(!u)return{...sig,status:'NO_HISTORY',netReturnPct:0};const bs=sig.sourceScale==='raw'?u.raw:u.adj,win=future(bs,sig.date,HOLD),l=sig.levels;if(win.length<HOLD)return{...sig,status:'INSUFFICIENT_FUTURE',netReturnPct:0};let entered=false,entry=null,entryDate=null,exit=null,exitDate=null,status='UNFILLED';for(const b of win){if(!entered){if(b.open>=l.entryLow&&b.open<=l.entryHigh){entry=b.open;entered=true;entryDate=b.date}else if(b.low<=l.entryHigh&&b.high>=l.entryLow){entry=b.open>l.entryHigh?l.entryHigh:b.open<l.entryLow?l.entryLow:l.entryHigh;entered=true;entryDate=b.date}else{continue}}
    const hitStop=b.low<=l.stopLoss,hitTarget=b.high>=l.target1;
    if(hitStop&&hitTarget){exit=l.stopLoss;exitDate=b.date;status='STOP_SAME_BAR';break}
    if(hitStop){exit=l.stopLoss;exitDate=b.date;status='STOP_HIT';break}
    if(hitTarget){exit=l.target1;exitDate=b.date;status='TARGET_HIT';break}
  }
  if(!entered)return{...sig,status:'UNFILLED',entryPrice:null,exitPrice:null,grossReturnPct:0,netReturnPct:0,window:win.map(x=>x.date)};
  if(exit==null){exit=win.at(-1).close;exitDate=win.at(-1).date;status='TIME_EXIT'}
  const gross=pct(exit,entry),net=gross-COST;return{...sig,status,entryPrice:round(entry),entryDate,exitPrice:round(exit),exitDate,grossReturnPct:round(gross,3),netReturnPct:round(net,3),window:win.map(x=>x.date)}
}

function maxDrawdown(daily){let eq=1,peak=1,mdd=0;for(const r of daily){eq*=1+r/100;peak=Math.max(peak,eq);mdd=Math.min(mdd,(eq/peak-1)*100)}return mdd}
function summarize(rows){const valid=rows.filter(x=>!['NO_HISTORY','INSUFFICIENT_FUTURE'].includes(x.status));const filled=valid.filter(x=>x.status!=='UNFILLED'),nets=filled.map(x=>x.netReturnPct),pos=nets.filter(x=>x>0),neg=nets.filter(x=>x<0);const byDate=new Map();for(const r of valid){if(!byDate.has(r.date))byDate.set(r.date,[]);byDate.get(r.date).push(r.netReturnPct||0)}const daily=[...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,v])=>({date,netPct:mean(v),signals:v.length}));let eq=1;for(const d of daily)eq*=1+d.netPct/100;return{signals:valid.length,filled:filled.length,unfilled:valid.length-filled.length,fillRatePct:round(valid.length?filled.length/valid.length*100:0,1),positiveTradeRatePct:round(filled.length?pos.length/filled.length*100:0,1),targetHitPct:round(filled.length?filled.filter(x=>x.status==='TARGET_HIT').length/filled.length*100:0,1),stopHitPct:round(filled.length?filled.filter(x=>x.status.startsWith('STOP')).length/filled.length*100:0,1),timeExitPct:round(filled.length?filled.filter(x=>x.status==='TIME_EXIT').length/filled.length*100:0,1),averageNetPct:round(mean(nets),3),medianNetPct:round(median(nets),3),profitFactor:round(neg.length?pos.reduce((a,b)=>a+b,0)/Math.abs(neg.reduce((a,b)=>a+b,0)):pos.length?999:0,2),sessions:daily.length,winningSessionRatePct:round(daily.length?daily.filter(x=>x.netPct>0).length/daily.length*100:0,1),avgBasketNetPct:round(mean(daily.map(x=>x.netPct)),3),compoundedBasketPct:round((eq-1)*100,3),maxDrawdownPct:round(maxDrawdown(daily.map(x=>x.netPct)),3),daily}}

const live=read(path.join(ROOT,'data','stable','v16-v169-live-evaluation.json'),{sessions:[]});
const liveSessions=(live.sessions||[]).filter(s=>s.signalDate&&Array.isArray(s.members)&&s.members.length);
const commonDates=[];for(const s of liveSessions){const ok=(s.members||[]).some(m=>{const u=byTicker.get(String(m.ticker).toUpperCase());return u&&future(u.raw,s.signalDate,HOLD).length===HOLD});if(ok)commonDates.push(s.signalDate)}
const uniqCommon=[...new Set(commonDates)].sort();
const commonRows=[];const commonDetails=[];
for(const date of uniqCommon){const s=liveSessions.find(x=>x.signalDate===date);const vg=v16Candidates(s),gg=gannCandidates(date),sp=sepaProxyCandidates(date);const all=[...vg,...gg,...sp].map(evaluate);commonRows.push(...all);commonDetails.push({date,V16_9_LIVE:all.filter(x=>x.engine==='V16_9_LIVE').map(x=>({ticker:x.ticker,status:x.status,netReturnPct:x.netReturnPct})),GANN_FUSION_X:all.filter(x=>x.engine==='GANN_FUSION_X').map(x=>({ticker:x.ticker,status:x.status,netReturnPct:x.netReturnPct,score:x.score})),SEPA_X_PROXY:all.filter(x=>x.engine==='SEPA_X_PROXY').map(x=>({ticker:x.ticker,status:x.status,netReturnPct:x.netReturnPct,score:x.score,actionable:x.actionable}))})}

const allDates=[...new Set(universe.flatMap(u=>u.adj.map(b=>b.date)))].sort();const lastUsable=allDates.filter(d=>universe.some(u=>future(u.adj,d,HOLD).length===HOLD));const extDates=lastUsable.slice(-EXTENDED_DATES);const extRows=[];for(const date of extDates){extRows.push(...gannCandidates(date).map(evaluate));extRows.push(...sepaProxyCandidates(date).map(evaluate))}

const commonSummary={V16_9_LIVE:summarize(commonRows.filter(x=>x.engine==='V16_9_LIVE')),GANN_FUSION_X:summarize(commonRows.filter(x=>x.engine==='GANN_FUSION_X')),SEPA_X_PROXY:summarize(commonRows.filter(x=>x.engine==='SEPA_X_PROXY'))};
const extendedSummary={GANN_FUSION_X:summarize(extRows.filter(x=>x.engine==='GANN_FUSION_X')),SEPA_X_PROXY:summarize(extRows.filter(x=>x.engine==='SEPA_X_PROXY'))};

function rankEngines(summary){return Object.entries(summary).sort((a,b)=>{const A=a[1],B=b[1];const qa=(A.averageNetPct||0)*.35+(A.positiveTradeRatePct||0)*.04+(A.profitFactor||0)*2+(A.maxDrawdownPct||0)*.15;const qb=(B.averageNetPct||0)*.35+(B.positiveTradeRatePct||0)*.04+(B.profitFactor||0)*2+(B.maxDrawdownPct||0)*.15;return qb-qa}).map(([engine,m],i)=>({rank:i+1,engine,averageNetPct:m.averageNetPct,positiveTradeRatePct:m.positiveTradeRatePct,profitFactor:m.profitFactor,maxDrawdownPct:m.maxDrawdownPct,signals:m.signals}))}
const result={schemaVersion:'gann-fusion-x-comparison-v1',generatedAt:new Date().toISOString(),method:{holdingSessions:HOLD,roundTripCostPct:COST,sameBarTargetStop:'STOP_CONSERVATIVE',entry:'NEXT_SESSION_ZONE_TOUCH',topSignalsPerSession:TOPN,lookaheadForbidden:true},comparability:{V16_9_LIVE:'Exact logged V16.9 live recommendations from data/stable/v16-v169-live-evaluation.json, re-evaluated with the same 3-session execution rule.',GANN_FUSION_X:'Current Gann Fusion X code, walk-forward from OHLCV available up to each signal date. Speculative profile only. Fundamentals fixed neutral at 50 to avoid future-data leakage.',SEPA_X_PROXY:'Backfilled proxy using the published Stable V8.2 QVUA weights and current technical decision thresholds. Historical fundamentals are fixed neutral at 50 because Stable V8 has no published per-session immutable history in the repository. This is not an exact historical SEPA-X ledger.'},limitations:['Current history-file universe can introduce survivorship/coverage bias.','SEPA-X comparison is a reconstructed proxy, not a live historical ledger.','The common-date window is limited by V16.9 live-evaluation history and by availability of three future sessions.','Results are research diagnostics and do not establish future profitability.'],universe:{historyFiles:files.length,eligibleHistories:universe.length},commonDateTest:{dates:uniqCommon,summary:commonSummary,ranking:rankEngines(commonSummary),details:commonDetails},extendedWalkForward:{dates:extDates,summary:extendedSummary,ranking:rankEngines(extendedSummary)}};
fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'backtest-comparison.json'),JSON.stringify(result,null,2)+'\n');
const md=[];md.push('# EGX GANN FUSION X — Walk-Forward Comparison','',`Generated: ${result.generatedAt}`,'',`Holding: ${HOLD} sessions · Round-trip cost: ${COST}% · Same-bar target/stop: STOP (conservative)`,'','## Common-date comparison');
md.push('| Rank | Engine | Signals | Fill % | Positive % | Target % | Stop % | Avg net % | PF | Avg basket % | Compound % | Max DD % |','|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');for(const r of result.commonDateTest.ranking){const m=commonSummary[r.engine];md.push(`| ${r.rank} | ${r.engine} | ${m.signals} | ${m.fillRatePct} | ${m.positiveTradeRatePct} | ${m.targetHitPct} | ${m.stopHitPct} | ${m.averageNetPct} | ${m.profitFactor} | ${m.avgBasketNetPct} | ${m.compoundedBasketPct} | ${m.maxDrawdownPct} |`)}
md.push('','## Extended walk-forward (Gann vs SEPA proxy)','| Rank | Engine | Signals | Fill % | Positive % | Avg net % | PF | Compound % | Max DD % |','|---:|---|---:|---:|---:|---:|---:|---:|---:|');for(const r of result.extendedWalkForward.ranking){const m=extendedSummary[r.engine];md.push(`| ${r.rank} | ${r.engine} | ${m.signals} | ${m.fillRatePct} | ${m.positiveTradeRatePct} | ${m.averageNetPct} | ${m.profitFactor} | ${m.compoundedBasketPct} | ${m.maxDrawdownPct} |`)}md.push('','## Important','- V16.9 is based on logged live recommendations.','- SEPA-X is a backfilled proxy because the Stable V8 app does not expose an immutable historical recommendation ledger per session.','- Neutral fundamentals are used in backfilled engines to prevent look-ahead leakage.','- Historical results do not guarantee future results.');fs.writeFileSync(path.join(OUT,'backtest-comparison.md'),md.join('\n')+'\n');
console.log(JSON.stringify({commonDates:uniqCommon.length,commonRanking:result.commonDateTest.ranking,extendedDates:extDates.length,extendedRanking:result.extendedWalkForward.ranking},null,2));
