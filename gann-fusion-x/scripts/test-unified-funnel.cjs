#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),GFX=path.join(ROOT,'gann-fusion-x'),DATA=path.join(GFX,'data');
const Planner=require(path.join(GFX,'engine','planner.js'));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const fail=m=>{console.error('FAIL:',m);process.exitCode=1};
const current=read(path.join(DATA,'current.json')),forward=read(path.join(DATA,'forward-shadow-report.json'));
if(!current.guardrails?.unifiedDecisionFunnel)fail('snapshot unifiedDecisionFunnel guardrail missing');
const all=current.all||[],spec=current.funnelSummary?.speculative||{};
if((spec.actionable||0)+(spec.watch||0)+(spec.rejected||0)!==all.length)fail(`spec funnel counts do not sum to analyzed: ${JSON.stringify(spec)} vs ${all.length}`);
for(const a of all){for(const h of ['speculative','medium','long']){const f=a.decisionFunnel?.[h];if(!f?.decision?.code)fail(`${a.ticker} missing ${h} funnel decision`);if(!['ACTIONABLE','WATCH','REJECTED'].includes(f?.decision?.code))fail(`${a.ticker} invalid ${h} decision ${f?.decision?.code}`);if(!f?.reasonCode||!f?.reasonAr)fail(`${a.ticker} missing ${h} reason`)}}
for(const x of current.dailyTop||[])if(x.decisionFunnel?.speculative?.decision?.code!=='ACTIONABLE')fail(`dailyTop contains non-actionable ${x.ticker}`);
for(const x of current.weeklyTop||[])if(x.decisionFunnel?.medium?.decision?.code!=='ACTIONABLE')fail(`weeklyTop contains non-actionable medium ${x.ticker}`);
for(const x of current.watchRadar||[])if(x.decisionFunnel?.speculative?.decision?.code!=='WATCH')fail(`watchRadar contains non-watch ${x.ticker}`);
for(const x of current.rejectedRadar||[])if(x.decisionFunnel?.speculative?.decision?.code!=='REJECTED')fail(`rejectedRadar contains non-rejected ${x.ticker}`);
const daily=(current.dailyTop||[]).map(x=>x.ticker),gann=(forward.currentCandidates?.GANN_FUSION_X_V1||[]).map(x=>x.ticker),expected=daily.slice(0,gann.length);
if(gann.join('|')!==expected.join('|'))fail(`Forward/Snapshot mismatch: forward=${gann.join(',')} snapshot=${expected.join(',')}`);
for(const x of forward.currentCandidates?.GANN_FUSION_X_V1||[])if(x.meta?.decision?.code!=='ACTIONABLE')fail(`Forward emitted non-actionable ${x.ticker}`);
const fake={score:70,classification:{code:'WATCH'},parts:{marketRegime:{regime:'RISK_ON'},breakout:{near:true},gannTime:{active:false},momentum:{overheated:false},trend:{score:80},fundamentals:{score:70}},marketMeta:{liquidityPercentile:null},plan:{entryLow:100,entryHigh:101,stopLoss:96,target1:110,rr:2,atr14:2}};
const p=Planner.buildPlan(fake,'speculative',{portfolioValue:100000,riskPct:.5});
if(!p.decision?.code||!p.reasonCode)fail('Planner decision contract missing');
console.log(JSON.stringify({ok:!process.exitCode,session:current.sessionDate,analyzed:all.length,funnel:spec,daily,forwardGann:gann,weekly:(current.weeklyTop||[]).map(x=>x.ticker),watchTop:(current.watchRadar||[]).slice(0,5).map(x=>({ticker:x.ticker,reason:x.decisionFunnel.speculative.reasonCode})),rejectedTop:(current.rejectedRadar||[]).slice(0,5).map(x=>({ticker:x.ticker,reason:x.decisionFunnel.speculative.reasonCode}))},null,2));
if(process.exitCode)process.exit(process.exitCode);