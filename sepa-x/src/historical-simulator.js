import { DEFAULT_CONFIG } from './config.js';
import { MarketDataProvider } from './providers.js';
import { scanMarket } from './engine.js';
import { selectConcentratedRecommendations } from './concentration.js';

const finite=(v)=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const avg=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const median=(xs)=>{const a=[...xs].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};

async function workerMap(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(error){out[i]={__error:error};}}}
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),Math.max(1,items.length))},worker));
  return out;
}

function stripPointInTimeUnsafe(entry){
  return {
    ticker:entry.ticker,
    companyNameAr:entry.companyNameAr??null,
    companyNameEn:entry.companyNameEn??null,
    sector:entry.sector??entry.industry??null,
    industry:entry.industry??null,
    active:entry.active!==false,
    yahooSymbol:entry.yahooSymbol??entry.yahooAlternative??null,
    fundamentals:null,
    news:null,
    summary:null,
  };
}

function upperBoundDate(rows,date){
  let lo=0,hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].date<=date)lo=mid+1;else hi=mid;}
  return lo;
}

class ReplaySliceProvider{
  constructor({entries,histories,benchmark,asOf,config}){this.entries=entries;this.histories=histories;this.benchmark=benchmark;this.asOf=asOf;this.config=config;}
  async loadContext(){return {};}
  buildUniverse(){return this.entries;}
  async loadStock(entry){
    const full=this.histories.get(entry.ticker)||[];
    const end=upperBoundDate(full,this.asOf),rows=full.slice(0,end);
    return {entry,rows,errors:[],meta:{expectedSessionDate:this.asOf,priceDataAsOf:rows.at(-1)?.date??null,fundamentalsAsOf:null,longHistorySource:'HISTORICAL_POINT_IN_TIME_REPLAY',longHistoryRange:'RECORDED',longHistoryCoverageStart:rows[0]?.date??null,longHistoryCoverageEnd:rows.at(-1)?.date??null,sessionCount:rows.length,overlapReconciliation:null}};
  }
  async loadBenchmark(){const end=upperBoundDate(this.benchmark,this.asOf);return this.benchmark.slice(0,end);}
}

export async function loadReplayDataset({provider=new MarketDataProvider(DEFAULT_CONFIG),config=DEFAULT_CONFIG,maxSymbols=null,onProgress=null}={}){
  const ctx=await provider.loadContext();
  const universe=provider.buildUniverse(ctx);
  const selected=maxSymbols?universe.slice(0,Math.max(1,Number(maxSymbols))):universe;
  const histories=new Map(),errors=[];
  const loaded=await workerMap(selected,Math.max(2,config.cache.concurrency),async(entry,index)=>{
    const stock=await provider.loadStock(entry);
    onProgress?.({stage:'LOAD_HISTORY',index:index+1,total:selected.length,symbol:entry.ticker,sessions:stock.rows?.length??0});
    return {entry:stripPointInTimeUnsafe(entry),rows:stock.rows||[],source:stock.meta?.longHistorySource??null,errors:stock.errors||[]};
  });
  const entries=[];
  for(let i=0;i<loaded.length;i++){
    const item=loaded[i];
    if(item?.__error){errors.push({symbol:selected[i]?.ticker,error:item.__error.message});continue;}
    if(item.errors?.length)errors.push(...item.errors.map(error=>({symbol:item.entry.ticker,error})));
    if((item.rows?.length??0)<config.market.requiredHistorySessions+25)continue;
    entries.push(item.entry);histories.set(item.entry.ticker,item.rows);
  }
  let benchmark=[];try{benchmark=await provider.loadBenchmark();}catch(error){errors.push({symbol:'BENCHMARK',error:error.message});}
  return {entries,histories,benchmark,errors,requested:selected.length,loaded:entries.length};
}

function sharedMarketDates(dataset,minUniverse){
  const counts=new Map();
  for(const rows of dataset.histories.values())for(const b of rows)counts.set(b.date,(counts.get(b.date)||0)+1);
  return [...counts.entries()].filter(([,n])=>n>=minUniverse).map(([date])=>date).sort();
}

function fillPrice(bar,plan){
  const low=Number(plan.entryLow),high=Number(plan.entryHigh);
  if(!(finite(low)&&finite(high)))return null;
  if(bar.open>=low&&bar.open<=high)return bar.open;
  if(bar.open>high&&bar.low<=high)return high;
  if(bar.open<low)return null;
  if(bar.low<=high&&bar.high>=low)return high;
  return null;
}

function strategyTag(rec){
  const lab=rec?.strategy_lab||{},structure=lab?.structure_retest?.raw||{},cycle=lab?.historical_cycle||{};
  return {
    bestStrategy:lab.best_strategy??null,
    bestStrategyScore:lab.best_strategy_score??null,
    strategyEdgeScore:lab.strategy_edge_score??null,
    strategyConfirmationCount:Number(lab.confirmation_count??0),
    strategyTrustedForPromotion:lab.trusted_for_promotion??lab.trustedForPromotion??null,
    breakoutRetestConfirmed:Boolean(structure?.resistance?.pass),
    supportReclaimConfirmed:Boolean(structure?.support?.pass),
    historicalCycleAligned:Boolean(cycle?.pass),
    cycleAlignmentScore:cycle?.raw?.cycle_alignment_score??cycle?.score??null,
    cycleSamples:cycle?.raw?.samples??null,
  };
}

function precisionChallengerEligible(t){
  return t?.bestStrategy!=='VCP_COMPRESSION'&&Number(t?.strategyConfirmationCount)>=2;
}

function evaluatePick(rec,fullBars,signalDate,policy){
  const tag=strategyTag(rec),plan=rec.target_plan;
  if(!plan?.valid)return {symbol:rec.symbol,signalDate,entered:false,outcome:'INVALID_PLAN',...tag};
  const signalIndex=upperBoundDate(fullBars,signalDate)-1;
  if(signalIndex<0)return {symbol:rec.symbol,signalDate,entered:false,outcome:'NO_SIGNAL_BAR',...tag};
  let entry=null;
  const entryEnd=Math.min(fullBars.length-1,signalIndex+policy.entryExpirySessions);
  for(let j=signalIndex+1;j<=entryEnd;j++){
    const p=fillPrice(fullBars[j],plan);
    if(p!=null){entry={index:j,price:p,date:fullBars[j].date};break;}
  }
  if(!entry)return {symbol:rec.symbol,signalDate,entered:false,outcome:'EXPIRED',conviction:rec.concentration_score,rank:rec.conviction_rank,...tag};
  const stop=Number(plan.stopLoss),risk=entry.price-stop;
  if(!(risk>0))return {symbol:rec.symbol,signalDate,entered:false,outcome:'INVALID_ENTRY_RISK',...tag};
  const precision=plan.precisionTarget&&finite(plan.precisionTarget.price)?{...plan.precisionTarget,price:Number(plan.precisionTarget.price)}:null;
  const targets=(plan.targets||[]).map(x=>({...x,price:Number(x.price)})).filter(x=>finite(x.price));
  const hit=new Array(targets.length).fill(false),hitDate=new Array(targets.length).fill(null);
  const maxExit=Math.min(fullBars.length-1,entry.index+policy.maxHoldSessions-1);
  let stopIndex=null,stopDate=null,primaryHitIndex=null,precisionHit=false,precisionHitDate=null;
  for(let j=entry.index;j<=maxExit;j++){
    const bar=fullBars[j],stopTouched=bar.low<=stop;
    const precisionTouched=Boolean(precision&&!precisionHit&&bar.high>=precision.price);
    const newly=targets.map((t,k)=>!hit[k]&&bar.high>=t.price?k:-1).filter(k=>k>=0);
    // Preserve the conservative same-bar rule: STOP wins over every target, including P1.
    if(stopTouched){stopIndex=j;stopDate=bar.date;break;}
    if(precisionTouched){precisionHit=true;precisionHitDate=bar.date;}
    for(const k of newly){hit[k]=true;hitDate[k]=bar.date;if(k===0&&primaryHitIndex==null)primaryHitIndex=j;}
  }
  let exitPrice,exitIndex,outcome;
  if(primaryHitIndex!=null){exitPrice=targets[0].price;exitIndex=primaryHitIndex;outcome='TARGET1';}
  else if(stopIndex!=null){exitPrice=stop;exitIndex=stopIndex;outcome='STOP';}
  else{exitIndex=maxExit;exitPrice=fullBars[maxExit]?.close??entry.price;outcome='TIME_EXIT';}
  const grossPct=(exitPrice-entry.price)/entry.price*100,netPct=grossPct-policy.roundTripCostPct;
  const costR=(entry.price*policy.roundTripCostPct/100)/risk,netR=(exitPrice-entry.price)/risk-costR;
  return {
    symbol:rec.symbol,signalDate,rank:rec.conviction_rank,conviction:rec.concentration_score,status:rec.status,...tag,
    entered:true,entryDate:entry.date,entryPrice:round(entry.price,4),stopLoss:round(stop,4),riskPct:round(risk/entry.price*100,2),
    precisionTarget:precision?.price??null,precisionTargetR:precision?.r??null,precisionTargetRequestedR:precision?.requestedR??null,precisionTargetCappedByResistance:Boolean(precision?.cappedByResistance),precisionTargetHit:precisionHit,precisionTargetHitDate:precisionHitDate,
    target1:targets[0]?.price??null,target2:targets[1]?.price??null,target3:targets[2]?.price??null,
    target1Hit:Boolean(hit[0]),target2Hit:Boolean(hit[1]),target3Hit:Boolean(hit[2]),target1HitDate:hitDate[0],target2HitDate:hitDate[1],target3HitDate:hitDate[2],
    stopHit:stopIndex!=null,stopDate,outcome,exitDate:fullBars[exitIndex]?.date??null,netPct:round(netPct,3),netR:round(netR,3),holdingSessions:exitIndex-entry.index+1,
  };
}

function maxDrawdown(returns){let equity=1,peak=1,max=0;for(const r of returns){equity*=1+r/100;peak=Math.max(peak,equity);max=Math.min(max,(equity/peak-1)*100);}return max;}
function conditionSummary(xs){
  if(!xs.length)return {entered:0,precisionTargetHitPct:null,target1HitPct:null,target2HitPct:null,target3HitPct:null,stopBeforePrecisionTargetPct:null,stopBeforeTarget1Pct:null,positivePct:null,expectancyR:null};
  return {
    entered:xs.length,
    precisionTargetHitPct:round(xs.filter(x=>x.precisionTargetHit).length/xs.length*100,1),
    target1HitPct:round(xs.filter(x=>x.target1Hit).length/xs.length*100,1),target2HitPct:round(xs.filter(x=>x.target2Hit).length/xs.length*100,1),target3HitPct:round(xs.filter(x=>x.target3Hit).length/xs.length*100,1),
    stopBeforePrecisionTargetPct:round(xs.filter(x=>x.stopHit&&!x.precisionTargetHit).length/xs.length*100,1),stopBeforeTarget1Pct:round(xs.filter(x=>x.stopHit&&!x.target1Hit).length/xs.length*100,1),
    positivePct:round(xs.filter(x=>Number(x.netPct)>0).length/xs.length*100,1),expectancyR:round(avg(xs.map(x=>Number(x.netR))),3)
  };
}

function temporalValidation(xs){
  const ordered=[...xs].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))),mid=Math.floor(ordered.length/2),byYear={};
  for(const t of ordered){const y=String(t.signalDate||'').slice(0,4)||'UNKNOWN';(byYear[y]??=[]).push(t);}
  for(const [y,ys] of Object.entries(byYear))byYear[y]=conditionSummary(ys);
  return {firstHalf:conditionSummary(ordered.slice(0,mid)),lastHalf:conditionSummary(ordered.slice(mid)),byYear};
}

function summarizeTrades(trades,signals){
  const entered=trades.filter(x=>x.entered),expired=trades.filter(x=>x.outcome==='EXPIRED');
  const wins=entered.filter(x=>Number(x.netPct)>0),losses=entered.filter(x=>Number(x.netPct)<0);
  const gp=wins.reduce((s,x)=>s+Number(x.netPct),0),gl=Math.abs(losses.reduce((s,x)=>s+Number(x.netPct),0));
  const bySignal=new Map();for(const t of entered){if(!bySignal.has(t.signalDate))bySignal.set(t.signalDate,[]);bySignal.get(t.signalDate).push(t);}
  const sessionReturns=[...bySignal.values()].map(xs=>avg(xs.map(x=>Number(x.netPct))));
  let equity=1;for(const r of sessionReturns)equity*=1+r/100;
  const bins={};
  for(const t of entered){const lo=Math.floor((Number(t.conviction)||0)/10)*10,key=`${lo}-${lo+9}`;bins[key]??={entered:0,target1Hits:0,precisionTargetHits:0};bins[key].entered++;if(t.target1Hit)bins[key].target1Hits++;if(t.precisionTargetHit)bins[key].precisionTargetHits++;}
  for(const v of Object.values(bins)){v.target1HitRatePct=round(v.target1Hits/Math.max(1,v.entered)*100,1);v.precisionTargetHitRatePct=round(v.precisionTargetHits/Math.max(1,v.entered)*100,1);}
  const strategyBreakdown={};
  for(const t of entered){const k=t.bestStrategy||'UNCLASSIFIED';(strategyBreakdown[k]??=[]).push(t);}
  for(const [k,xs] of Object.entries(strategyBreakdown))strategyBreakdown[k]=conditionSummary(xs);
  const precisionChallenger=entered.filter(precisionChallengerEligible);
  const strategyConditions={
    breakoutRetestConfirmed:conditionSummary(entered.filter(x=>x.breakoutRetestConfirmed)),
    supportReclaimConfirmed:conditionSummary(entered.filter(x=>x.supportReclaimConfirmed)),
    historicalCycleAligned:conditionSummary(entered.filter(x=>x.historicalCycleAligned)),
    multiStrategyConfirmation:conditionSummary(entered.filter(x=>Number(x.strategyConfirmationCount)>=2)),
    noRetestConfirmation:conditionSummary(entered.filter(x=>!x.breakoutRetestConfirmed&&!x.supportReclaimConfirmed)),
    precisionChallenger:conditionSummary(precisionChallenger),
  };
  return {
    signalDates:signals.length,entered:entered.length,expired:expired.length,
    precisionTargetHitPct:entered.length?round(entered.filter(x=>x.precisionTargetHit).length/entered.length*100,1):null,
    stopBeforePrecisionTargetPct:entered.length?round(entered.filter(x=>x.stopHit&&!x.precisionTargetHit).length/entered.length*100,1):null,
    precisionTargetCappedByResistancePct:entered.length?round(entered.filter(x=>x.precisionTargetCappedByResistance).length/entered.length*100,1):null,
    target1HitPct:entered.length?round(entered.filter(x=>x.target1Hit).length/entered.length*100,1):null,
    target2HitPct:entered.length?round(entered.filter(x=>x.target2Hit).length/entered.length*100,1):null,
    target3HitPct:entered.length?round(entered.filter(x=>x.target3Hit).length/entered.length*100,1):null,
    stopBeforeTarget1Pct:entered.length?round(entered.filter(x=>x.stopHit&&!x.target1Hit).length/entered.length*100,1):null,
    positivePct:entered.length?round(wins.length/entered.length*100,1):null,
    averageNetPct:round(avg(entered.map(x=>Number(x.netPct))),3),medianNetPct:round(median(entered.map(x=>Number(x.netPct))),3),
    expectancyR:round(avg(entered.map(x=>Number(x.netR))),3),profitFactor:gl>0?round(gp/gl,3):(gp>0?'INF':null),
    averageHoldingSessions:round(avg(entered.map(x=>Number(x.holdingSessions))),2),
    basketSessions:sessionReturns.length,basketWinRatePct:sessionReturns.length?round(sessionReturns.filter(x=>x>0).length/sessionReturns.length*100,1):null,
    compoundedBasketReturnPct:round((equity-1)*100,2),maximumBasketDrawdownPct:round(maxDrawdown(sessionReturns),2),
    convictionCalibration:bins,strategyBreakdown,strategyConditions,
    precisionChallengerDefinition:{bestStrategyMustNotEqual:'VCP_COMPRESSION',minimumStrategyConfirmations:2,activationStatus:'CHALLENGER_ONLY_NOT_ELIGIBILITY_GATE'},
    precisionChallengerTemporalValidation:temporalValidation(precisionChallenger),
  };
}

export async function runHistoricalSimulator({
  config=DEFAULT_CONFIG,provider=new MarketDataProvider(config),dataset=null,maxSymbols=null,minUniverse=60,stepSessions=5,maxSignalDates=120,
  entryExpirySessions=config.concentration?.entryExpirySessions??3,maxHoldSessions=config.concentration?.maxHoldSessions??20,roundTripCostPct=0.60,onProgress=null,
}={}){
  const data=dataset||await loadReplayDataset({provider,config,maxSymbols,onProgress});
  const allDates=sharedMarketDates(data,minUniverse);
  if(!allDates.length)throw new Error('NO_SHARED_HISTORICAL_DATES');
  const latestCommon=allDates.at(-1);
  const eligibleDates=allDates.filter(date=>{
    let mature=0,future=0;
    for(const rows of data.histories.values()){
      const idx=upperBoundDate(rows,date)-1;
      if(idx>=config.market.requiredHistorySessions-1)mature++;
      if(idx>=0&&rows.length-idx-1>=entryExpirySessions+maxHoldSessions)future++;
    }
    return mature>=minUniverse&&future>=Math.min(minUniverse,mature);
  });
  const stepped=eligibleDates.filter((_,i)=>i%Math.max(1,stepSessions)===0).slice(-Math.max(1,maxSignalDates));
  const trades=[],signals=[];
  for(let di=0;di<stepped.length;di++){
    const asOf=stepped[di];
    onProgress?.({stage:'REPLAY',index:di+1,total:stepped.length,date:asOf});
    const replayProvider=new ReplaySliceProvider({entries:data.entries,histories:data.histories,benchmark:data.benchmark,asOf,config});
    let scan;
    try{scan=await scanMarket({provider:replayProvider,config});}catch(error){signals.push({date:asOf,error:error.message,selected:[]});continue;}
    const selected=selectConcentratedRecommendations(scan.all||[],config.concentration);
    signals.push({date:asOf,marketRegime:scan.market_status?.Regime??null,selected:selected.map(x=>({symbol:x.symbol,rank:x.conviction_rank,conviction:x.concentration_score,status:x.status,precisionTarget:x.target_plan?.precisionTarget??null,target1:x.target_plan?.primaryTarget?.price??null,rr:x.reward_risk,...strategyTag(x)}))});
    for(const rec of selected){const full=data.histories.get(rec.symbol)||[];trades.push(evaluatePick(rec,full,asOf,{entryExpirySessions,maxHoldSessions,roundTripCostPct}));}
  }
  const summary=summarizeTrades(trades,signals);
  return {
    schemaVersion:'sepa-x-historical-simulator.3',engineId:config.engineId,generatedAt:new Date().toISOString(),researchOnly:true,
    methodology:{pointInTime:true,noLookahead:true,currentFundamentalsExcluded:true,currentCatalystsExcluded:true,marketWideRSRecomputedEachSignalDate:true,entryAfterSignal:true,entryExpirySessions,maxHoldSessions,sameBarAmbiguity:'STOP_FIRST',roundTripCostPct,precisionTargetR:config.concentration?.precisionTargetR??.8,precisionTargetSeparateFromPrimary:true,targetRMultiples:config.concentration?.targetRMultiples??[2,3,4],signalFrequency:`every ${stepSessions} common sessions`,maxSignalDates,strategyLabMode:'CHALLENGER',strategyPromotionRequiresValidation:true},
    dataset:{symbolsRequested:data.requested,symbolsLoaded:data.loaded,historyErrors:data.errors.length,latestCommonDate:latestCommon,commonDates:allDates.length,eligibleSignalDates:eligibleDates.length},
    summary,signals,trades,errors:data.errors,
  };
}
