import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import { scanMarket } from '../src/engine.js';
import { loadReplayDataset } from '../src/historical-simulator.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const outPath=path.join(root,'data/research/precision-geometry-historical.json');
const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

function upperBoundDate(rows,date){
  let lo=0,hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].date<=date)lo=mid+1;else hi=mid;}
  return lo;
}

class ReplayProvider{
  constructor({entries,histories,benchmark,asOf}){this.entries=entries;this.histories=histories;this.benchmark=benchmark;this.asOf=asOf;}
  async loadContext(){return {};}
  buildUniverse(){return this.entries;}
  async loadStock(entry){
    const full=this.histories.get(entry.ticker)||[],end=upperBoundDate(full,this.asOf),rows=full.slice(0,end);
    return {entry,rows,errors:[],meta:{expectedSessionDate:this.asOf,priceDataAsOf:rows.at(-1)?.date??null,fundamentalsAsOf:null,longHistorySource:'HISTORICAL_POINT_IN_TIME_REPLAY',longHistoryRange:'RECORDED',longHistoryCoverageStart:rows[0]?.date??null,longHistoryCoverageEnd:rows.at(-1)?.date??null,sessionCount:rows.length,overlapReconciliation:null}};
  }
  async loadBenchmark(){const end=upperBoundDate(this.benchmark,this.asOf);return this.benchmark.slice(0,end);}
}

function sharedDates(dataset,minUniverse){
  const counts=new Map();
  for(const rows of dataset.histories.values())for(const b of rows)counts.set(b.date,(counts.get(b.date)||0)+1);
  return [...counts.entries()].filter(([,n])=>n>=minUniverse).map(([d])=>d).sort();
}

function fillPrice(bar,low,high){
  if(bar.open>=low&&bar.open<=high)return bar.open;
  if(bar.open>high&&bar.low<=high)return high;
  if(bar.open<low)return null;
  if(bar.low<=high&&bar.high>=low)return high;
  return null;
}

function geometry(row){return row?.strategy_lab?.precision_geometry||null;}
function cleanPrecisionCandidate(row){
  const pg=geometry(row),audit=row?.audit_stages||{};
  return Boolean(
    pg?.pass===true &&
    pg?.raw?.promotionAllowed===false &&
    audit?.data_integrity?.pass===true &&
    audit?.liquidity?.pass===true &&
    audit?.trend?.pass===true &&
    Number(row?.rs_percentile)>=70 &&
    String(row?.market_regime||'').toUpperCase()!=='BEAR'
  );
}

function rankCandidate(row){
  const pg=geometry(row),risk=Number(pg?.raw?.riskPct),riskBonus=risk>=4&&risk<=6?6:0;
  return Number(pg?.score||0)*.72+Number(row?.rs_percentile||0)*.18+Number(row?.confidence_score||0)*.10+riskBonus;
}

function evaluate(row,fullBars,signalDate,{entryExpirySessions=3,maxHoldSessions=10,roundTripCostPct=.6}={}){
  const pg=geometry(row),raw=pg?.raw||{},z=raw.entryZone||{},low=Number(z.from),high=Number(z.to),stop=Number(raw.stopLoss),target=Number(raw.precisionTarget?.price);
  const base={symbol:row.symbol,signalDate,geometryScore:pg?.score??null,rs:row.rs_percentile??null,confidence:row.confidence_score??null,riskPct:raw.riskPct??null,structuralNetRR:raw.structuralNetRR??null,alignmentState:raw.alignmentState??null,supportConfluence:raw.supportConfluence??null,resistanceConfluence:raw.resistanceConfluence??null,entryLow:round(low,4),entryHigh:round(high,4),stopLoss:round(stop,4),target:round(target,4)};
  if(![low,high,stop,target].every(Number.isFinite)||!(high>low&&low>stop&&target>high))return {...base,entered:false,outcome:'INVALID_PLAN'};
  const signalIndex=upperBoundDate(fullBars,signalDate)-1;
  if(signalIndex<0)return {...base,entered:false,outcome:'NO_SIGNAL_BAR'};
  let entry=null;
  const entryEnd=Math.min(fullBars.length-1,signalIndex+entryExpirySessions);
  for(let j=signalIndex+1;j<=entryEnd;j++){
    const p=fillPrice(fullBars[j],low,high);
    if(p!=null){entry={index:j,price:p,date:fullBars[j].date};break;}
  }
  if(!entry)return {...base,entered:false,outcome:'EXPIRED'};
  const maxExit=Math.min(fullBars.length-1,entry.index+maxHoldSessions-1);
  let outcome='TIME',exitIndex=maxExit,exitPrice=fullBars[maxExit]?.close??entry.price,targetHit=false,stopHit=false;
  for(let j=entry.index;j<=maxExit;j++){
    const b=fullBars[j],stopTouched=b.low<=stop,targetTouched=b.high>=target;
    if(stopTouched){outcome='STOP';exitIndex=j;exitPrice=stop;stopHit=true;break;}
    if(targetTouched){outcome='TARGET';exitIndex=j;exitPrice=target;targetHit=true;break;}
  }
  const risk=entry.price-stop,cost=entry.price*roundTripCostPct/100;
  const netPct=(exitPrice-entry.price)/entry.price*100-roundTripCostPct;
  const netR=risk>0?(exitPrice-entry.price-cost)/risk:null;
  return {...base,entered:true,entryDate:entry.date,entryPrice:round(entry.price,4),targetHit,stopHit,outcome,exitDate:fullBars[exitIndex]?.date??null,holdingSessions:exitIndex-entry.index+1,netPct:round(netPct,3),netR:round(netR,3)};
}

function wilsonLower(successes,n,z=1.96){
  if(!n)return null;
  const p=successes/n,z2=z*z,den=1+z2/n,center=p+z2/(2*n),margin=z*Math.sqrt((p*(1-p)+z2/(4*n))/n);
  return Math.max(0,(center-margin)/den)*100;
}

function summary(rows){
  const entered=rows.filter(x=>x.entered),hits=entered.filter(x=>x.targetHit),stops=entered.filter(x=>x.stopHit),wins=entered.filter(x=>Number(x.netPct)>0),losses=entered.filter(x=>Number(x.netPct)<0);
  const gp=wins.reduce((s,x)=>s+Number(x.netPct),0),gl=Math.abs(losses.reduce((s,x)=>s+Number(x.netPct),0));
  return {
    selected:rows.length,entered:entered.length,expired:rows.filter(x=>x.outcome==='EXPIRED').length,
    targetHitPct:entered.length?round(hits.length/entered.length*100,1):null,
    stopBeforeTargetPct:entered.length?round(stops.length/entered.length*100,1):null,
    positivePct:entered.length?round(wins.length/entered.length*100,1):null,
    averageNetPct:round(avg(entered.map(x=>Number(x.netPct))),3),
    expectancyR:round(avg(entered.map(x=>Number(x.netR)).filter(Number.isFinite)),3),
    profitFactor:gl>0?round(gp/gl,3):(gp>0?'INF':null),
    wilson95LowerTargetHitPct:entered.length?round(wilsonLower(hits.length,entered.length),1):null,
    averageRiskPct:round(avg(entered.map(x=>Number(x.riskPct)).filter(Number.isFinite)),2),
    averageGeometryScore:round(avg(entered.map(x=>Number(x.geometryScore)).filter(Number.isFinite)),1),
  };
}

function temporal(rows){
  const ordered=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))),mid=Math.floor(ordered.length/2),byYear={};
  for(const r of ordered){const y=String(r.signalDate||'').slice(0,4)||'UNKNOWN';(byYear[y]??=[]).push(r);}
  for(const [y,xs] of Object.entries(byYear))byYear[y]=summary(xs);
  return {firstHalf:summary(ordered.slice(0,mid)),lastHalf:summary(ordered.slice(mid)),byYear};
}

const minUniverse=60,stepSessions=3,maxSignalDates=200,entryExpirySessions=3,maxHoldSessions=10;
const dataset=await loadReplayDataset({config:DEFAULT_CONFIG});
const allDates=sharedDates(dataset,minUniverse);
const eligibleDates=allDates.filter(date=>{
  let mature=0,future=0;
  for(const rows of dataset.histories.values()){
    const idx=upperBoundDate(rows,date)-1;
    if(idx>=DEFAULT_CONFIG.market.requiredHistorySessions-1)mature++;
    if(idx>=0&&rows.length-idx-1>=entryExpirySessions+maxHoldSessions)future++;
  }
  return mature>=minUniverse&&future>=Math.min(minUniverse,mature);
});
const signalDates=eligibleDates.filter((_,i)=>i%stepSessions===0).slice(-maxSignalDates);
const trades=[],signals=[];
for(let i=0;i<signalDates.length;i++){
  const asOf=signalDates[i];
  if(i%20===0)console.log(`PRECISION_GEOMETRY_REPLAY ${i+1}/${signalDates.length} ${asOf}`);
  const provider=new ReplayProvider({entries:dataset.entries,histories:dataset.histories,benchmark:dataset.benchmark,asOf});
  let scan;
  try{scan=await scanMarket({provider,config:DEFAULT_CONFIG});}catch(error){signals.push({date:asOf,error:String(error?.message||error),candidates:0,selected:[]});continue;}
  const candidates=(scan.all||[]).filter(cleanPrecisionCandidate).sort((a,b)=>rankCandidate(b)-rankCandidate(a)||String(a.symbol).localeCompare(String(b.symbol)));
  const selected=candidates.slice(0,3);
  signals.push({date:asOf,marketRegime:scan.market_status?.Regime??null,candidates:candidates.length,selected:selected.map(x=>({symbol:x.symbol,rankScore:round(rankCandidate(x),2),geometryScore:geometry(x)?.score??null,riskPct:geometry(x)?.raw?.riskPct??null,structuralNetRR:geometry(x)?.raw?.structuralNetRR??null}))});
  for(const row of selected)trades.push(evaluate(row,dataset.histories.get(row.symbol)||[],asOf,{entryExpirySessions,maxHoldSessions,roundTripCostPct:.6}));
}

const entered=trades.filter(x=>x.entered),risk4to6=trades.filter(x=>Number(x.riskPct)>=4&&Number(x.riskPct)<=6),score80=trades.filter(x=>Number(x.geometryScore)>=80);
const result={
  schemaVersion:'sepa-x-precision-geometry-historical.1',engineId:DEFAULT_CONFIG.engineId,generatedAt:new Date().toISOString(),researchOnly:true,promotionAllowed:false,
  methodology:{pointInTime:true,noLookahead:true,currentFundamentalsExcluded:true,currentCatalystsExcluded:true,marketWideRSRecomputedEachSignalDate:true,signalFrequency:`every ${stepSessions} common sessions`,maxSignalDates,selection:'top 3 STRUCTURAL_PRECISION pass + clean data/liquidity/trend + RS>=70 + non-BEAR',entryAfterSignal:true,entryExpirySessions,maxHoldSessions,sameBarAmbiguity:'STOP_FIRST',roundTripCostPct:.6,target:'PG1 planned from structural geometry'},
  dataset:{symbolsRequested:dataset.requested,symbolsLoaded:dataset.loaded,historyErrors:dataset.errors.length,commonDates:allDates.length,eligibleSignalDates:eligibleDates.length,signalDates:signalDates.length},
  candidateCoverage:{signalDatesWithAny:signals.filter(x=>Number(x.candidates)>0).length,averageCandidatesPerSignal:round(avg(signals.map(x=>Number(x.candidates)||0)),2),maxCandidatesOnSignal:Math.max(0,...signals.map(x=>Number(x.candidates)||0))},
  summary:summary(trades),temporal:temporal(trades),riskBand4to6:summary(risk4to6),geometryScore80Plus:summary(score80),
  benchmarkReference:{rc2:{entered:67,targetHitPct:76.1,stopBeforeTargetPct:19.4,wilson95LowerTargetHitPct:64.7,targetApproxR:.8,maxHoldSessions:10},currentSepaxPlannedP1:{note:'read from canonical historical simulator evidence; separate methodology'}},
  promotionDecision:{eligible:false,reason:'CHALLENGER_ONLY_REQUIRES_INDEPENDENT_SAMPLE_SIZE_AND_TEMPORAL_STABILITY'},
  signals,trades,errors:dataset.errors,
};
fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({candidateCoverage:result.candidateCoverage,summary:result.summary,temporal:result.temporal,riskBand4to6:result.riskBand4to6,score80Plus:result.geometryScore80Plus},null,2));
