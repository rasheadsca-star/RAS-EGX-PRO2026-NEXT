#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'),GFX=path.join(ROOT,'gann-fusion-x'),DATA=path.join(GFX,'data');
const Planner=require(path.join(GFX,'engine','planner.js'));
const EntryTiming=require(path.join(GFX,'engine','entry-timing.js'));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const fail=m=>{console.error('FAIL:',m);process.exitCode=1};
const current=read(path.join(DATA,'current.json')),forward=read(path.join(DATA,'forward-shadow-report.json'));
if(!current.guardrails?.unifiedDecisionFunnel)fail('snapshot unifiedDecisionFunnel guardrail missing');
if(!current.guardrails?.executionQualityRanking)fail('snapshot executionQualityRanking guardrail missing');
if(Number(current.guardrails?.maxPreTriggerDistancePct)!==4)fail('maxPreTriggerDistancePct must remain 4');
const all=current.all||[],spec=current.funnelSummary?.speculative||{};
if((spec.actionable||0)+(spec.watch||0)+(spec.rejected||0)!==all.length)fail(`spec funnel counts do not sum to analyzed: ${JSON.stringify(spec)} vs ${all.length}`);
for(const a of all){
  for(const h of ['speculative','medium','long']){
    const f=a.decisionFunnel?.[h];
    if(!f?.decision?.code)fail(`${a.ticker} missing ${h} funnel decision`);
    if(!['ACTIONABLE','WATCH','REJECTED'].includes(f?.decision?.code))fail(`${a.ticker} invalid ${h} decision ${f?.decision?.code}`);
    if(!f?.reasonCode||!f?.reasonAr)fail(`${a.ticker} missing ${h} reason`);
  }
  const p=a.decisionFunnel?.speculative;
  if(!Number.isFinite(Number(p?.executionQuality)))fail(`${a.ticker} missing speculative executionQuality`);
  if(!Number.isFinite(Number(p?.rankScore)))fail(`${a.ticker} missing speculative rankScore`);
  if(!p?.executionTier)fail(`${a.ticker} missing speculative executionTier`);
}
for(const x of current.dailyTop||[])if(x.decisionFunnel?.speculative?.decision?.code!=='ACTIONABLE')fail(`dailyTop contains non-actionable ${x.ticker}`);
for(const x of current.weeklyTop||[])if(x.decisionFunnel?.medium?.decision?.code!=='ACTIONABLE')fail(`weeklyTop contains non-actionable medium ${x.ticker}`);
for(const x of current.watchRadar||[])if(x.decisionFunnel?.speculative?.decision?.code!=='WATCH')fail(`watchRadar contains non-watch ${x.ticker}`);
for(const x of current.rejectedRadar||[])if(x.decisionFunnel?.speculative?.decision?.code!=='REJECTED')fail(`rejectedRadar contains non-rejected ${x.ticker}`);
const dailyRows=current.dailyTop||[];
for(let i=1;i<dailyRows.length;i++){
  const prev=Number(dailyRows[i-1].decisionFunnel?.speculative?.rankScore??-1),cur=Number(dailyRows[i].decisionFunnel?.speculative?.rankScore??-1);
  if(prev<cur)fail(`dailyTop not sorted by rankScore at ${dailyRows[i-1].ticker}/${dailyRows[i].ticker}`);
}
const daily=dailyRows.map(x=>x.ticker),gann=(forward.currentCandidates?.GANN_FUSION_X_V1||[]).map(x=>x.ticker),expected=daily.slice(0,gann.length);
if(gann.join('|')!==expected.join('|'))fail(`Forward/Snapshot mismatch: forward=${gann.join(',')} snapshot=${expected.join(',')}`);
for(const x of forward.currentCandidates?.GANN_FUSION_X_V1||[])if(x.meta?.decision?.code!=='ACTIONABLE')fail(`Forward emitted non-actionable ${x.ticker}`);
const fake={score:70,classification:{code:'WATCH'},parts:{marketRegime:{regime:'RISK_ON'},breakout:{near:true,confirmed:false,score:78,distancePct:-1.2},gannTime:{active:false,score:20},volume:{score:88,confirmed:true},momentum:{score:75,rsi14:62,overheated:false},relativeStrength:{score:60},trend:{score:80},fundamentals:{score:70}},marketMeta:{liquidityPercentile:null,moneyFlowQualityScore:70},plan:{entryLow:100,entryHigh:101,stopLoss:96,target1:110,rr:2,atr14:2}};
const p=Planner.buildPlan(fake,'speculative',{portfolioValue:100000,riskPct:.5});
if(!p.decision?.code||!p.reasonCode)fail('Planner decision contract missing');
if(p.decision?.code!=='ACTIONABLE')fail(`near-trigger fake should remain ACTIONABLE, got ${p.decision?.code}`);
if(!Number.isFinite(Number(p.executionQuality))||!Number.isFinite(Number(p.rankScore)))fail('Planner execution ranking contract missing');
const farFake={score:72,classification:{code:'WATCH'},parts:{marketRegime:{regime:'RISK_ON'},breakout:{near:false,confirmed:false,score:25,distancePct:-6.2},gannTime:{active:true,score:100},volume:{score:55,confirmed:false},momentum:{score:80,rsi14:64,overheated:false},relativeStrength:{score:55},trend:{score:90},fundamentals:{score:60}},marketMeta:{liquidityPercentile:null,moneyFlowQualityScore:65},plan:{entryLow:100,entryHigh:107,trigger:106.5,stopLoss:96,target1:118,rr:2.4,atr14:2}};
const far=Planner.buildPlan(farFake,'speculative',{portfolioValue:100000,riskPct:.5});
if(far.decision?.code!=='WATCH'||far.reasonCode!=='TOO_EARLY_FROM_TRIGGER')fail(`far-from-trigger setup must be WATCH/TOO_EARLY_FROM_TRIGGER, got ${far.decision?.code}/${far.reasonCode}`);

const timingBase={horizon:'speculative',eligible:true,decision:{code:'ACTIONABLE'},levels:{entryLow:100,entryHigh:103,referenceEntry:101.5,trigger:102,stopLoss:96,atr14:2},analysis:{close:102.3,parts:{breakout:{confirmed:true},volume:{confirmed:true},momentum:{rsi14:62}}}};
const timingA=EntryTiming.classify(timingBase);
if(timingA.grade!=='A'||timingA.mode!=='ENTER_ON_CONFIRMATION')fail(`timing A contract failed: ${timingA.grade}/${timingA.mode}`);
if(Number(timingA.invalidationPrice)!==96)fail(`timing A invalidation must equal stop 96, got ${timingA.invalidationPrice}`);
const timingB=EntryTiming.classify({...timingBase,analysis:{...timingBase.analysis,close:100.5,parts:{...timingBase.analysis.parts,breakout:{confirmed:false}}}});
if(timingB.grade!=='B'||timingB.mode!=='WAIT_TRIGGER'||Number(timingB.activationPrice)!==102)fail(`timing B contract failed: ${timingB.grade}/${timingB.mode}/${timingB.activationPrice}`);
const timingC=EntryTiming.classify({...timingBase,analysis:{...timingBase.analysis,close:106,parts:{...timingBase.analysis.parts,momentum:{rsi14:79}}}});
if(timingC.grade!=='C'||timingC.mode!=='WAIT_PULLBACK'||!(timingC.pullbackZone?.low>0&&timingC.pullbackZone?.high>timingC.pullbackZone?.low))fail(`timing C contract failed: ${JSON.stringify(timingC)}`);
EntryTiming.install(Planner);
const decorated=Planner.buildPlan(fake,'speculative',{portfolioValue:100000,riskPct:.5});
if(decorated.entryTiming?.grade!=='B'||!String(decorated.actionAr||'').startsWith('B —'))fail(`browser planner decoration contract failed: ${decorated.entryTiming?.grade}/${decorated.actionAr}`);
if(!decorated.entryPlan?.some(x=>String(x).includes('إلغاء الخطة')))fail('decorated entry plan must expose cancellation price');

console.log(JSON.stringify({ok:!process.exitCode,session:current.sessionDate,analyzed:all.length,funnel:spec,daily:dailyRows.map(x=>({ticker:x.ticker,rankScore:x.decisionFunnel.speculative.rankScore,executionQuality:x.decisionFunnel.speculative.executionQuality,tier:x.decisionFunnel.speculative.executionTier})),forwardGann:gann,entryTimingRegression:{A:timingA.headlineAr,B:timingB.headlineAr,C:timingC.headlineAr},weekly:(current.weeklyTop||[]).map(x=>x.ticker),watchTop:(current.watchRadar||[]).slice(0,8).map(x=>({ticker:x.ticker,reason:x.decisionFunnel.speculative.reasonCode,rankScore:x.decisionFunnel.speculative.rankScore})),rejectedTop:(current.rejectedRadar||[]).slice(0,5).map(x=>({ticker:x.ticker,reason:x.decisionFunnel.speculative.reasonCode}))},null,2));
if(process.exitCode)process.exit(process.exitCode);
