#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const research=path.join(root,'data','research');
const read=(name,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(research,name),'utf8'));}catch{return fallback;}};
const historical=read('historical-simulator.json');
if(!historical||!Array.isArray(historical.trades))throw new Error('HISTORICAL_SIMULATOR_REQUIRED');
const previous=read('precision-challenger-validation.json',null);
const rc2=read('rc2-simulate.json',null);
const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const wilson=(k,n,z=1.96)=>{if(!n)return null;const p=k/n,den=1+z*z/n;return Math.max(0,(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/den)*100;};
const V3_DISCOVERY_WINDOW_START='2021-08-09';

function deoverlap(rows){
  const ordered=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))||String(a.symbol).localeCompare(String(b.symbol)));
  const activeUntil=new Map(),out=[];
  for(const t of ordered){
    const until=activeUntil.get(t.symbol);
    if(until&&String(t.signalDate)<=String(until))continue;
    out.push(t);
    activeUntil.set(t.symbol,t.exitDate||t.signalDate);
  }
  return out;
}

function summary(rows){
  const n=rows.length;
  if(!n)return {entered:0,uniqueSymbols:0,hitPct:null,wilson95LowerHitPct:null,stopBeforeTargetPct:null,positivePct:null,averageNetPct:null,expectancyR:null,profitFactor:null};
  const hits=rows.filter(x=>x.precisionTargetHit).length;
  const stops=rows.filter(x=>x.stopHit&&!x.precisionTargetHit).length;
  const positives=rows.filter(x=>Number(x.netPct)>0).length;
  const gp=rows.reduce((s,x)=>s+Math.max(0,Number(x.netPct)||0),0);
  const gl=Math.abs(rows.reduce((s,x)=>s+Math.min(0,Number(x.netPct)||0),0));
  return {
    entered:n,
    uniqueSymbols:new Set(rows.map(x=>x.symbol)).size,
    hitPct:round(hits/n*100,1),
    wilson95LowerHitPct:round(wilson(hits,n),1),
    stopBeforeTargetPct:round(stops/n*100,1),
    positivePct:round(positives/n*100,1),
    averageNetPct:round(avg(rows.map(x=>Number(x.netPct))),3),
    expectancyR:round(avg(rows.map(x=>Number(x.netR))),3),
    profitFactor:gl?round(gp/gl,3):(gp>0?'INF':null),
  };
}

function temporal(rows){
  const ordered=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))),mid=Math.floor(ordered.length/2),byYear={};
  for(const t of ordered){const y=String(t.signalDate||'').slice(0,4)||'UNKNOWN';(byYear[y]??=[]).push(t);}
  for(const [y,ys] of Object.entries(byYear))byYear[y]=summary(ys);
  return {firstHalf:summary(ordered.slice(0,mid)),lastHalf:summary(ordered.slice(mid)),byYear};
}

function leaveOneSymbolOut(rows){
  const symbols=[...new Set(rows.map(x=>x.symbol))];
  const cases=symbols.map(symbol=>({symbol,...summary(rows.filter(x=>x.symbol!==symbol))}));
  const byHit=[...cases].filter(x=>finite(x.hitPct)).sort((a,b)=>a.hitPct-b.hitPct||a.expectancyR-b.expectancyR);
  const byExp=[...cases].filter(x=>finite(x.expectancyR)).sort((a,b)=>a.expectancyR-b.expectancyR||a.hitPct-b.hitPct);
  const counts={};for(const t of rows)counts[t.symbol]=(counts[t.symbol]||0)+1;
  const maxCount=Math.max(0,...Object.values(counts));
  return {
    symbols:symbols.length,
    maximumSingleSymbolTradeSharePct:rows.length?round(maxCount/rows.length*100,1):null,
    worstHitCase:byHit[0]??null,
    worstExpectancyCase:byExp[0]??null,
  };
}

const regimeByDate=new Map((historical.signals||[]).map(s=>[String(s.date||s.signalDate||''),s.marketRegime??null]));
const entered=historical.trades.filter(x=>x.entered===true).map(t=>({...t,marketRegime:t.marketRegime??regimeByDate.get(String(t.signalDate))??null}));
const variants={
  baseline:entered,
  v1:entered.filter(t=>t.bestStrategy!=='VCP_COMPRESSION'&&Number(t.strategyConfirmationCount)>=2),
  v2:entered.filter(t=>t.bestStrategy==='PIVOT_BREAKOUT'&&Number(t.strategyConfirmationCount)>=2),
  v3:entered.filter(t=>t.bestStrategy==='PIVOT_BREAKOUT'&&Number(t.strategyConfirmationCount)>=2&&Boolean(t.marketRegime)&&t.marketRegime!=='NEUTRAL'),
};
for(const k of Object.keys(variants))variants[k]=deoverlap(variants[k]);

const signature={
  dataset:historical.dataset,
  methodology:historical.methodology,
  signalDates:(historical.signals||[]).map(x=>[x.date||x.signalDate||x.asOf||x,x.marketRegime??null]),
  trades:historical.trades.map(t=>[t.symbol,t.signalDate,t.entered,t.entryDate??null,t.entryPrice??null,t.stopLoss??null,t.precisionTarget??null,t.bestStrategy??null,t.strategyConfirmationCount??null]),
};
const datasetFingerprint=crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex');
const v2Summary=summary(variants.v2),v2Temporal=temporal(variants.v2),v2Sensitivity=leaveOneSymbolOut(variants.v2);
const v3Summary=summary(variants.v3),v3Temporal=temporal(variants.v3),v3Sensitivity=leaveOneSymbolOut(variants.v3);
const v3OlderHoldout=variants.v3.filter(t=>String(t.signalDate)<V3_DISCOVERY_WINDOW_START);
const v3DiscoveryWindow=variants.v3.filter(t=>String(t.signalDate)>=V3_DISCOVERY_WINDOW_START);
const yearChecks=Object.values(v2Temporal.byYear).filter(x=>x.entered>=8);
const rc2Reference={
  entered:rc2?.summary?.entered??67,
  hitPct:rc2?.summary?.target1Pct??76.1,
  wilson95LowerHitPct:rc2?.summary?.wilson95LowerTarget1Pct??64.7,
  profitFactor:rc2?.summary?.profitFactor??2.44,
};
const criteria={
  minimumDeoverlappedTrades:40,
  minimumHitPct:74,
  minimumWilson95LowerHitPct:60,
  minimumHalfHitPct:65,
  minimumYearHitPctWhenNAtLeast8:60,
  minimumExpectancyR:.5,
  minimumProfitFactor:2,
  maximumSingleSymbolTradeSharePct:15,
};
const checks={
  sampleSize:v2Summary.entered>=criteria.minimumDeoverlappedTrades,
  hitRate:finite(v2Summary.hitPct)&&v2Summary.hitPct>=criteria.minimumHitPct,
  wilsonLower:finite(v2Summary.wilson95LowerHitPct)&&v2Summary.wilson95LowerHitPct>=criteria.minimumWilson95LowerHitPct,
  temporalHalves:[v2Temporal.firstHalf,v2Temporal.lastHalf].every(x=>x.entered>0&&finite(x.hitPct)&&x.hitPct>=criteria.minimumHalfHitPct),
  yearlyStability:yearChecks.length>0&&yearChecks.every(x=>finite(x.hitPct)&&x.hitPct>=criteria.minimumYearHitPctWhenNAtLeast8),
  expectancy:finite(v2Summary.expectancyR)&&v2Summary.expectancyR>=criteria.minimumExpectancyR,
  profitFactor:(v2Summary.profitFactor==='INF')||(finite(v2Summary.profitFactor)&&v2Summary.profitFactor>=criteria.minimumProfitFactor),
  symbolConcentration:finite(v2Sensitivity.maximumSingleSymbolTradeSharePct)&&v2Sensitivity.maximumSingleSymbolTradeSharePct<=criteria.maximumSingleSymbolTradeSharePct,
};
const allPass=Object.values(checks).every(Boolean);
const promotionState=!checks.sampleSize?'INSUFFICIENT_EVIDENCE':allPass?'READY_FOR_MANUAL_PROMOTION_REVIEW':'CHALLENGER_REJECTED_BY_VALIDATION';

const v3Criteria={
  minimumDeoverlappedTrades:40,
  minimumOlderHoldoutTrades:12,
  minimumHitPct:74,
  minimumWilson95LowerHitPct:60,
  minimumHalfHitPct:65,
  minimumOlderHoldoutHitPct:65,
  minimumDiscoveryWindowHitPct:70,
  minimumExpectancyR:.5,
  minimumProfitFactor:2,
  maximumSingleSymbolTradeSharePct:15,
};
const olderSummary=summary(v3OlderHoldout),discoverySummary=summary(v3DiscoveryWindow);
const v3Checks={
  sampleSize:v3Summary.entered>=v3Criteria.minimumDeoverlappedTrades,
  olderHoldoutSize:olderSummary.entered>=v3Criteria.minimumOlderHoldoutTrades,
  hitRate:finite(v3Summary.hitPct)&&v3Summary.hitPct>=v3Criteria.minimumHitPct,
  wilsonLower:finite(v3Summary.wilson95LowerHitPct)&&v3Summary.wilson95LowerHitPct>=v3Criteria.minimumWilson95LowerHitPct,
  temporalHalves:[v3Temporal.firstHalf,v3Temporal.lastHalf].every(x=>x.entered>0&&finite(x.hitPct)&&x.hitPct>=v3Criteria.minimumHalfHitPct),
  olderHoldout:finite(olderSummary.hitPct)&&olderSummary.hitPct>=v3Criteria.minimumOlderHoldoutHitPct,
  discoveryWindow:finite(discoverySummary.hitPct)&&discoverySummary.hitPct>=v3Criteria.minimumDiscoveryWindowHitPct,
  expectancy:finite(v3Summary.expectancyR)&&v3Summary.expectancyR>=v3Criteria.minimumExpectancyR,
  profitFactor:(v3Summary.profitFactor==='INF')||(finite(v3Summary.profitFactor)&&v3Summary.profitFactor>=v3Criteria.minimumProfitFactor),
  symbolConcentration:finite(v3Sensitivity.maximumSingleSymbolTradeSharePct)&&v3Sensitivity.maximumSingleSymbolTradeSharePct<=v3Criteria.maximumSingleSymbolTradeSharePct,
};
const v3AllPass=Object.values(v3Checks).every(Boolean);
const v3PromotionState=!v3Checks.sampleSize||!v3Checks.olderHoldoutSize?'INSUFFICIENT_EVIDENCE':v3AllPass?'READY_FOR_MANUAL_PROMOTION_REVIEW':'CHALLENGER_REJECTED_BY_VALIDATION';

const report={
  schemaVersion:'sepa-x-precision-challenger-validation.2',
  generatedAt:new Date().toISOString(),
  researchOnly:true,
  promotionAllowed:false,
  automaticEligibilityImpact:'NONE',
  definition:{
    v1:'bestStrategy != VCP_COMPRESSION AND strategyConfirmationCount >= 2',
    v2:'bestStrategy == PIVOT_BREAKOUT AND strategyConfirmationCount >= 2',
    v3:'V2 AND marketRegime is known AND marketRegime != NEUTRAL',
    v3DiscoveryWindowStart:V3_DISCOVERY_WINDOW_START,
    v3Preregistration:'V3 rule and holdout cutoff were fixed after the 400-signal discovery benchmark and before expanding to older signal dates.',
    deoverlap:'ignore a repeated signal for the same symbol while its previously counted trade is still open',
  },
  dataset:{...historical.dataset,signalDates:historical.summary?.signalDates??null,datasetFingerprint,previousFingerprint:previous?.dataset?.datasetFingerprint??null,datasetChangedSincePrevious:Boolean(previous?.dataset?.datasetFingerprint&&previous.dataset.datasetFingerprint!==datasetFingerprint)},
  rc2Reference,
  variants:{
    baseline:{summary:summary(variants.baseline),temporal:temporal(variants.baseline)},
    v1:{summary:summary(variants.v1),temporal:temporal(variants.v1),sensitivity:leaveOneSymbolOut(variants.v1)},
    v2:{summary:v2Summary,temporal:v2Temporal,sensitivity:v2Sensitivity},
    v3:{summary:v3Summary,temporal:v3Temporal,sensitivity:v3Sensitivity,holdout:{cutoff:V3_DISCOVERY_WINDOW_START,olderUnseen:olderSummary,discoveryWindow:discoverySummary}},
  },
  promotionGate:{criteria,checks,state:promotionState,manualPromotionRequired:true,comparisonNote:'RC2 remains the conservative benchmark; this gate only decides whether V2 has enough internal evidence to be reviewed, never auto-promotes it.'},
  v3PromotionGate:{criteria:v3Criteria,checks:v3Checks,state:v3PromotionState,manualPromotionRequired:true,comparisonNote:'V3 was preregistered after the 400-signal discovery run. Older dates added by the expanded benchmark are reported separately as an unseen historical holdout. No automatic promotion is permitted.'},
};
fs.writeFileSync(path.join(research,'precision-challenger-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({dataset:report.dataset,v2:report.variants.v2.summary,v2PromotionGate:report.promotionGate,v3:report.variants.v3.summary,v3Holdout:report.variants.v3.holdout,v3PromotionGate:report.v3PromotionGate},null,2));
