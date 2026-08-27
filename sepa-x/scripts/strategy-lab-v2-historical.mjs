import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import { loadReplayDataset } from '../src/historical-simulator.js';
import { confirmedRetestReclaimV2, cyclePatternSimilarityEngine } from '../src/strategy-lab-v2.js';
import { mean } from '../src/math.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const upperBoundDate=(rows,date)=>{let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(rows[m].date<=date)lo=m+1;else hi=m;}return lo;};
const wilson=(k,n,z=1.96)=>{if(!n)return null;const p=k/n,z2=z*z,den=1+z2/n;return Math.max(0,(p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/den)*100;};
function sharedDates(dataset,minUniverse){const counts=new Map();for(const rows of dataset.histories.values())for(const b of rows)counts.set(b.date,(counts.get(b.date)||0)+1);return [...counts.entries()].filter(([,n])=>n>=minUniverse).map(([d])=>d).sort();}
function turnoverOkay(rows){const x=rows.slice(-20).map(b=>Number(b.close)*Number(b.volume)).filter(Number.isFinite);return x.length>=12&&(mean(x)??0)>=750000;}
function trendOkay(rows){if(rows.length<55)return false;const c=rows.map(x=>Number(x.close)),m20=mean(c.slice(-20)),m50=mean(c.slice(-50));return finite(m20)&&finite(m50)&&c.at(-1)>=m20*.97&&m20>=m50*.98;}
function fillPrice(bar,low,high){if(bar.open>=low&&bar.open<=high)return bar.open;if(bar.open>high&&bar.low<=high)return high;if(bar.open<low)return null;if(bar.low<=high&&bar.high>=low)return high;return null;}
function evaluateRetest(row,fullBars,signalDate,{entryExpirySessions=3,maxHoldSessions=10,costPct=.6}={}){
  const raw=row.retest.raw,plan=raw?.plan||{},z=plan.entryZone||{},low=Number(z.from),high=Number(z.to),stop=Number(plan.stopLoss),target=Number(plan.precisionTarget?.price);
  const base={symbol:row.symbol,signalDate,retestScore:row.retest.score,cycleScore:row.cycle?.score??null,cyclePass:Boolean(row.cycle?.pass),entryLow:round(low,4),entryHigh:round(high,4),stopLoss:round(stop,4),target:round(target,4),riskPct:plan.riskPct??null};
  if(![low,high,stop,target].every(Number.isFinite)||!(high>=low&&low>stop&&target>high))return {...base,entered:false,outcome:'INVALID_PLAN'};
  const signalIndex=upperBoundDate(fullBars,signalDate)-1;if(signalIndex<0)return {...base,entered:false,outcome:'NO_SIGNAL_BAR'};
  let entry=null;for(let j=signalIndex+1;j<=Math.min(fullBars.length-1,signalIndex+entryExpirySessions);j++){const p=fillPrice(fullBars[j],low,high);if(p!=null){entry={index:j,price:p,date:fullBars[j].date};break;}}
  if(!entry)return {...base,entered:false,outcome:'EXPIRED'};
  const maxExit=Math.min(fullBars.length-1,entry.index+maxHoldSessions-1);let exitIndex=maxExit,exitPrice=fullBars[maxExit]?.close??entry.price,outcome='TIME',hit=false,stopHit=false;
  for(let j=entry.index;j<=maxExit;j++){const b=fullBars[j];if(b.low<=stop){outcome='STOP';exitIndex=j;exitPrice=stop;stopHit=true;break;}if(b.high>=target){outcome='TARGET';exitIndex=j;exitPrice=target;hit=true;break;}}
  const risk=entry.price-stop,cost=entry.price*costPct/100,netPct=(exitPrice-entry.price)/entry.price*100-costPct,netR=risk>0?(exitPrice-entry.price-cost)/risk:null;
  return {...base,entered:true,entryDate:entry.date,entryPrice:round(entry.price,4),targetHit:hit,stopHit,outcome,exitDate:fullBars[exitIndex]?.date??null,holdingSessions:exitIndex-entry.index+1,netPct:round(netPct,3),netR:round(netR,3)};
}
function evaluateCycle(row,fullBars,signalDate,{horizon=15,costPct=.6}={}){
  const def=row.cycle.raw?.launchDefinition||{},targetPct=Number(def.targetPct??6),stopPct=Number(def.stopPct??4),signalIndex=upperBoundDate(fullBars,signalDate)-1;
  const base={symbol:row.symbol,signalDate,cycleScore:row.cycle.score,samples:row.cycle.raw?.samples??null,weightedHitPct:row.cycle.raw?.similarityWeightedHitPct??null,wilson:row.cycle.raw?.wilson95LowerHitPct??null};
  if(signalIndex<0||signalIndex+1>=fullBars.length)return {...base,entered:false,outcome:'NO_FUTURE'};
  const e=fullBars[signalIndex+1],entry=Number(e.open||e.close);if(!(entry>0))return {...base,entered:false,outcome:'INVALID_ENTRY'};
  const target=entry*(1+targetPct/100),stop=entry*(1-stopPct/100),end=Math.min(fullBars.length-1,signalIndex+horizon);let outcome='TIME',exitIndex=end,exitPrice=fullBars[end]?.close??entry,hit=false,stopHit=false;
  for(let j=signalIndex+1;j<=end;j++){const b=fullBars[j];if(b.low<=stop){outcome='STOP';exitIndex=j;exitPrice=stop;stopHit=true;break;}if(b.high>=target){outcome='TARGET';exitIndex=j;exitPrice=target;hit=true;break;}}
  const risk=entry-stop,cost=entry*costPct/100,netPct=(exitPrice-entry)/entry*100-costPct,netR=risk>0?(exitPrice-entry-cost)/risk:null;
  return {...base,entered:true,entryDate:e.date,entryPrice:round(entry,4),stopLoss:round(stop,4),target:round(target,4),targetHit:hit,stopHit,outcome,exitDate:fullBars[exitIndex]?.date??null,holdingSessions:exitIndex-(signalIndex+1)+1,netPct:round(netPct,3),netR:round(netR,3)};
}
function deoverlap(rows){const ordered=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))||String(a.symbol).localeCompare(String(b.symbol))),active=new Map(),out=[];for(const t of ordered){const until=active.get(t.symbol);if(until&&String(t.signalDate)<=String(until))continue;out.push(t);active.set(t.symbol,t.exitDate||t.signalDate);}return out;}
function summary(rows){const entered=deoverlap(rows.filter(x=>x.entered)),hits=entered.filter(x=>x.targetHit),stops=entered.filter(x=>x.stopHit&&!x.targetHit),wins=entered.filter(x=>Number(x.netPct)>0),losses=entered.filter(x=>Number(x.netPct)<0),gp=wins.reduce((s,x)=>s+Number(x.netPct),0),gl=Math.abs(losses.reduce((s,x)=>s+Number(x.netPct),0));return {selected:rows.length,entered:entered.length,uniqueSymbols:new Set(entered.map(x=>x.symbol)).size,targetHitPct:entered.length?round(hits.length/entered.length*100,1):null,wilson95LowerHitPct:entered.length?round(wilson(hits.length,entered.length),1):null,stopBeforeTargetPct:entered.length?round(stops.length/entered.length*100,1):null,positivePct:entered.length?round(wins.length/entered.length*100,1):null,averageNetPct:round(avg(entered.map(x=>Number(x.netPct))),3),expectancyR:round(avg(entered.map(x=>Number(x.netR)).filter(Number.isFinite)),3),profitFactor:gl?round(gp/gl,3):(gp>0?'INF':null)};}
function temporal(rows){const x=deoverlap(rows.filter(r=>r.entered)).sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))),mid=Math.floor(x.length/2),years={};for(const r of x){const y=String(r.signalDate).slice(0,4);(years[y]??=[]).push(r);}for(const y of Object.keys(years))years[y]=summary(years[y]);return {firstHalf:summary(x.slice(0,mid)),lastHalf:summary(x.slice(mid)),byYear:years};}

const minUniverse=60,step=3,maxSignals=700,entryExpiry=3,maxHold=10,cycleHorizon=15;
const dataset=await loadReplayDataset({config:DEFAULT_CONFIG});
const allDates=sharedDates(dataset,minUniverse),eligible=allDates.filter(date=>{let mature=0,future=0;for(const rows of dataset.histories.values()){const idx=upperBoundDate(rows,date)-1;if(idx>=DEFAULT_CONFIG.market.requiredHistorySessions-1)mature++;if(idx>=0&&rows.length-idx-1>=entryExpiry+cycleHorizon)future++;}return mature>=minUniverse&&future>=Math.min(minUniverse,mature);}),dates=eligible.filter((_,i)=>i%step===0).slice(-maxSignals);
const retestTrades=[],cycleTrades=[],ensembleTrades=[],signals=[];
for(let di=0;di<dates.length;di++){
  const asOf=dates[di];if(di%50===0)console.log(`STRATEGY_LAB_V2_REPLAY ${di+1}/${dates.length} ${asOf}`);const candidates=[];
  for(const entry of dataset.entries){const full=dataset.histories.get(entry.ticker)||[],end=upperBoundDate(full,asOf),past=full.slice(0,end);if(past.length<DEFAULT_CONFIG.market.requiredHistorySessions||!turnoverOkay(past)||!trendOkay(past))continue;const retest=confirmedRetestReclaimV2(past,DEFAULT_CONFIG),cycle=(retest.pass||di%2===0)?cyclePatternSimilarityEngine(past,DEFAULT_CONFIG):{pass:false,score:0,raw:{samples:0}};if(retest.pass||cycle.pass)candidates.push({symbol:entry.ticker,retest,cycle,full});}
  const retestCandidates=candidates.filter(x=>x.retest.pass).sort((a,b)=>(b.retest.score+(b.cycle.pass?b.cycle.score*.15:0))-(a.retest.score+(a.cycle.pass?a.cycle.score*.15:0))).slice(0,3),cycleCandidates=candidates.filter(x=>x.cycle.pass).sort((a,b)=>b.cycle.score-a.cycle.score).slice(0,3),ensembleCandidates=candidates.filter(x=>x.retest.pass&&x.cycle.pass).sort((a,b)=>(b.retest.score+b.cycle.score)-(a.retest.score+a.cycle.score)).slice(0,3);
  signals.push({date:asOf,retestCandidates:retestCandidates.map(x=>({symbol:x.symbol,retestScore:x.retest.score,cycleScore:x.cycle.score,cyclePass:x.cycle.pass})),cycleCandidates:cycleCandidates.map(x=>({symbol:x.symbol,cycleScore:x.cycle.score,samples:x.cycle.raw?.samples,weightedHitPct:x.cycle.raw?.similarityWeightedHitPct})),ensembleCandidates:ensembleCandidates.map(x=>({symbol:x.symbol,retestScore:x.retest.score,cycleScore:x.cycle.score}))});
  for(const x of retestCandidates)retestTrades.push(evaluateRetest(x,x.full,asOf,{entryExpirySessions:entryExpiry,maxHoldSessions:maxHold}));for(const x of cycleCandidates)cycleTrades.push(evaluateCycle(x,x.full,asOf,{horizon:cycleHorizon}));for(const x of ensembleCandidates)ensembleTrades.push(evaluateRetest(x,x.full,asOf,{entryExpirySessions:entryExpiry,maxHoldSessions:maxHold}));
}
const report={schemaVersion:'sepa-x-strategy-lab-v2-historical.1',engineId:DEFAULT_CONFIG.engineId,generatedAt:new Date().toISOString(),researchOnly:true,promotionAllowed:false,automaticEligibilityImpact:'NONE',methodology:{pointInTime:true,noLookahead:true,currentFundamentalsExcluded:true,currentCatalystsExcluded:true,signalFrequency:`every ${step} common sessions`,maxSignalDates:maxSignals,selection:'top 3 per challenger; liquidity/trend guard; no core eligibility impact',sameBarAmbiguity:'STOP_FIRST',roundTripCostPct:.6,retestTarget:'planned P1 = 0.8R from RETEST_RECLAIM_V2 geometry',cycleTarget:'6% launch before 4% failure stop within 15 sessions'},dataset:{symbolsRequested:dataset.requested,symbolsLoaded:dataset.loaded,historyErrors:dataset.errors.length,commonDates:allDates.length,eligibleSignalDates:eligible.length,signalDates:dates.length},results:{retestReclaimV2:{summary:summary(retestTrades),temporal:temporal(retestTrades)},cyclePatternSimilarity:{summary:summary(cycleTrades),temporal:temporal(cycleTrades)},ensemble:{summary:summary(ensembleTrades),temporal:temporal(ensembleTrades)}},promotionDecision:{eligible:false,reason:'CHALLENGER_ONLY_REQUIRES_SAMPLE_SIZE_WILSON_AND_TEMPORAL_VALIDATION'},signals,trades:{retestReclaimV2:retestTrades,cyclePatternSimilarity:cycleTrades,ensemble:ensembleTrades},errors:dataset.errors};
fs.writeFileSync(path.join(root,'data/research/strategy-lab-v2-historical.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({dataset:report.dataset,retest:report.results.retestReclaimV2.summary,cycle:report.results.cyclePatternSimilarity.summary,ensemble:report.results.ensemble.summary},null,2));
