#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const research=path.join(root,'data','research');
const read=(name,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(research,name),'utf8'));}catch{return fallback;}};
const historical=read('historical-simulator.json');
if(!historical||!Array.isArray(historical.researchTrades))throw new Error('RESEARCH_TRADES_REQUIRED');
const rc2=read('rc2-simulate.json',null);
const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const wilson=(k,n,z=1.96)=>{if(!n)return null;const p=k/n,den=1+z*z/n;return Math.max(0,(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100;};

function deoverlap(rows){
  const ordered=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))||String(a.symbol).localeCompare(String(b.symbol)));
  const activeUntil=new Map(),out=[];
  for(const t of ordered){
    const until=activeUntil.get(t.symbol);
    if(until&&String(t.signalDate)<=String(until))continue;
    out.push(t);activeUntil.set(t.symbol,t.exitDate||t.signalDate);
  }
  return out;
}

function summary(rows){
  const xs=rows.filter(x=>x.entered===true),n=xs.length;
  if(!n)return {entered:0,uniqueSymbols:0,hitPct:null,wilson95LowerHitPct:null,positivePct:null,expectancyR:null,profitFactor:null,averageNetPct:null};
  const hits=xs.filter(x=>x.precisionTargetHit).length,positive=xs.filter(x=>Number(x.netPct)>0).length;
  const gp=xs.reduce((s,x)=>s+Math.max(0,Number(x.netPct)||0),0),gl=Math.abs(xs.reduce((s,x)=>s+Math.min(0,Number(x.netPct)||0),0));
  return {entered:n,uniqueSymbols:new Set(xs.map(x=>x.symbol)).size,hitPct:round(hits/n*100,1),wilson95LowerHitPct:round(wilson(hits,n),1),positivePct:round(positive/n*100,1),expectancyR:round(avg(xs.map(x=>Number(x.netR))),3),profitFactor:gl?round(gp/gl,3):(gp>0?'INF':null),averageNetPct:round(avg(xs.map(x=>Number(x.netPct))),3)};
}

const noBlocks=t=>(Array.isArray(t.failedRules)?t.failedRules.length:0)===0;
const conf=(t,n=2)=>Number(t.strategyConfirmationCount??0)>=n;
const pivot=t=>t.bestStrategy==='PIVOT_BREAKOUT';
const triggered=t=>['READY NOW','BREAKOUT CONFIRMED'].includes(t.status);
const riskAtMost=(t,n)=>finite(t.plannedRiskPct)&&Number(t.plannedRiskPct)<=n;
const rsAtLeast=(t,n)=>finite(t.rsPercentile)&&Number(t.rsPercentile)>=n;
const scoreAtLeast=(t,n)=>finite(t.finalScore)&&Number(t.finalScore)>=n;
const confidenceAtLeast=(t,n)=>finite(t.confidenceScore)&&Number(t.confidenceScore)>=n;
const nearPivot=(t,n)=>finite(t.distanceToPivotPct)&&Math.abs(Number(t.distanceToPivotPct))<=n;

// Fixed, interpretable library. Do not mutate from the benchmark result.
const candidates=[
  {id:'C00_CLEAN',test:t=>noBlocks(t)},
  {id:'C01_CLEAN_HIGH_RS',test:t=>noBlocks(t)&&rsAtLeast(t,75)},
  {id:'C02_CLEAN_RISK6',test:t=>noBlocks(t)&&riskAtMost(t,6)},
  {id:'C03_PIVOT_CONF2',test:t=>pivot(t)&&conf(t,2)},
  {id:'C04_PIVOT_CONF2_HIGH_RS',test:t=>pivot(t)&&conf(t,2)&&rsAtLeast(t,75)},
  {id:'C05_PIVOT_CONF2_RISK6',test:t=>pivot(t)&&conf(t,2)&&riskAtMost(t,6)},
  {id:'C06_MULTI_CONF_RISK6',test:t=>conf(t,2)&&riskAtMost(t,6)},
  {id:'C07_TRIGGERED',test:t=>triggered(t)},
  {id:'C08_TRIGGERED_CONF2',test:t=>triggered(t)&&conf(t,2)},
  {id:'C09_TIGHT_PIVOT_CONF2',test:t=>conf(t,2)&&nearPivot(t,3)},
  {id:'C10_BREAKOUT_RETEST_CONF2',test:t=>conf(t,2)&&Boolean(t.breakoutRetestConfirmed)},
  {id:'C11_CYCLE_ALIGNED_CONF2',test:t=>conf(t,2)&&Boolean(t.historicalCycleAligned)},
  {id:'C12_STRONG_SCORE',test:t=>scoreAtLeast(t,75)&&confidenceAtLeast(t,72)&&rsAtLeast(t,70)},
  {id:'C13_STRONG_SCORE_RISK6',test:t=>scoreAtLeast(t,75)&&confidenceAtLeast(t,72)&&rsAtLeast(t,70)&&riskAtMost(t,6)},
];

const trades=historical.researchTrades.filter(x=>x.entered===true);
const signalDates=[...new Set((historical.signals||[]).map(x=>String(x.date||'')).filter(Boolean))].sort();
if(signalDates.length<100)throw new Error('INSUFFICIENT_SIGNAL_DATES_FOR_WALK_FORWARD');
const blocks=[];
for(let i=0;i<5;i++){
  const testStartIndex=Math.floor(signalDates.length*(.5+i*.1));
  const testEndIndex=i===4?signalDates.length:Math.floor(signalDates.length*(.6+i*.1));
  const testStart=signalDates[testStartIndex],testEnd=signalDates[Math.max(testStartIndex,testEndIndex-1)];
  blocks.push({index:i+1,testStart,testEnd});
}

function metricScore(s){
  if(!s||s.entered<15||!finite(s.wilson95LowerHitPct)||!finite(s.expectancyR))return -Infinity;
  const pf=s.profitFactor==='INF'?6:Number(s.profitFactor);
  if(!finite(pf))return -Infinity;
  return Number(s.wilson95LowerHitPct)+10*Math.max(-1,Math.min(2,Number(s.expectancyR)))+5*Math.log(Math.max(.2,pf))+Math.min(5,s.entered/20);
}

const foldResults=[],oos=[];
for(const block of blocks){
  const trainRaw=trades.filter(t=>String(t.signalDate)<block.testStart);
  const scored=candidates.map(c=>{
    const rows=deoverlap(trainRaw.filter(c.test));
    const s=summary(rows);return {id:c.id,summary:s,selectionScore:round(metricScore(s),3)};
  }).filter(x=>finite(x.selectionScore)).sort((a,b)=>b.selectionScore-a.selectionScore||b.summary.entered-a.summary.entered||a.id.localeCompare(b.id));
  const chosen=scored[0]??null;
  if(!chosen){foldResults.push({...block,chosen:null,train:null,test:summary([])});continue;}
  const candidate=candidates.find(c=>c.id===chosen.id);
  const throughEnd=deoverlap(trades.filter(t=>String(t.signalDate)<=block.testEnd&&candidate.test(t)));
  const testRows=throughEnd.filter(t=>String(t.signalDate)>=block.testStart&&String(t.signalDate)<=block.testEnd);
  oos.push(...testRows.map(t=>({...t,walkForwardFold:block.index,walkForwardCandidate:candidate.id})));
  foldResults.push({...block,chosen:candidate.id,train:chosen.summary,selectionScore:chosen.selectionScore,test:summary(testRows)});
}
const oosRows=deoverlap(oos),oosSummary=summary(oosRows);
const usage={};for(const f of foldResults)if(f.chosen)usage[f.chosen]=(usage[f.chosen]||0)+1;
const nonEmpty=foldResults.filter(f=>f.test.entered>0),stableFolds=nonEmpty.filter(f=>f.test.entered<8||Number(f.test.hitPct)>=50).length;
const criteria={minimumOosTrades:50,minimumHitPct:72,minimumWilson95LowerHitPct:60,minimumExpectancyR:.5,minimumProfitFactor:2,minimumNonEmptyFolds:4,minimumStableFoldSharePct:80};
const pfPass=oosSummary.profitFactor==='INF'||(finite(oosSummary.profitFactor)&&Number(oosSummary.profitFactor)>=criteria.minimumProfitFactor);
const stableShare=nonEmpty.length?stableFolds/nonEmpty.length*100:0;
const checks={sampleSize:oosSummary.entered>=criteria.minimumOosTrades,hitRate:finite(oosSummary.hitPct)&&oosSummary.hitPct>=criteria.minimumHitPct,wilsonLower:finite(oosSummary.wilson95LowerHitPct)&&oosSummary.wilson95LowerHitPct>=criteria.minimumWilson95LowerHitPct,expectancy:finite(oosSummary.expectancyR)&&oosSummary.expectancyR>=criteria.minimumExpectancyR,profitFactor:pfPass,foldCoverage:nonEmpty.length>=criteria.minimumNonEmptyFolds,foldStability:stableShare>=criteria.minimumStableFoldSharePct};
const allPass=Object.values(checks).every(Boolean);
const report={schemaVersion:'sepa-x-research-walkforward.1',generatedAt:new Date().toISOString(),researchOnly:true,promotionAllowed:false,automaticEligibilityImpact:'NONE',preregistration:{candidateLibrary:candidates.map(x=>x.id),foldDesign:'expanding train; five sequential 10% OOS blocks covering final 50% of signal dates',selection:'highest robust training score among candidates with >=15 entered trades',deoverlap:true},dataset:{historicalSchemaVersion:historical.schemaVersion,signalDates:signalDates.length,researchTrades:historical.researchTrades.length,enteredResearchTrades:trades.length,signalSampleStart:historical.dataset?.signalSampleStart??signalDates[0],signalSampleEnd:historical.dataset?.signalSampleEnd??signalDates.at(-1)},rc2Reference:{entered:rc2?.summary?.entered??67,hitPct:rc2?.summary?.target1Pct??76.1,wilson95LowerHitPct:rc2?.summary?.wilson95LowerTarget1Pct??64.7,profitFactor:rc2?.summary?.profitFactor??2.44},folds:foldResults,candidateUsage:usage,oosSummary,gate:{criteria,checks,stableFoldSharePct:round(stableShare,1),state:allPass?'READY_FOR_MANUAL_RESEARCH_REVIEW':'NOT_VALIDATED',manualPromotionRequired:true,comparisonNote:'Research-only calibration. Passing this gate never changes production eligibility or execution.'}};
fs.writeFileSync(path.join(research,'research-walkforward.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({dataset:report.dataset,folds:report.folds.map(x=>({fold:x.index,chosen:x.chosen,test:x.test})),candidateUsage:usage,oosSummary,gate:report.gate},null,2));
