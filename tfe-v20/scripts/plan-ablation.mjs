import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backtestPlanVariant, PLAN_LAB_GOVERNANCE } from '../src/trade-plan-lab.js';
import { POLICY } from '../src/policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HISTORY = path.join(ROOT, 'data/history');
const OUT = path.join(ROOT, 'tfe-v20/evidence/meta/plan-ablation.json');
const VARIANTS = ['BASELINE_CURRENT', 'RESISTANCE_LADDER_V1'];

const round = (x, d=2) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;
const median = (xs) => {
  if (!xs.length) return null;
  const a=[...xs].sort((x,y)=>x-y), m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};

function summarizeTrades(trades) {
  const ordered = [...trades].sort((a,b) => String(a.exitDate).localeCompare(String(b.exitDate)) || String(a.ticker).localeCompare(String(b.ticker)));
  const n = ordered.length;
  if (!n) return { entered:0,target1Pct:null,stopPct:null,positivePct:null,avgNetPct:null,medianNetPct:null,profitFactor:null,wilson95LowerTarget1Pct:null,tradeSequenceMaxDrawdownPct:null,totalNetPct:null };
  const t1=ordered.filter(x=>x.outcome==='TARGET1').length;
  const stop=ordered.filter(x=>String(x.outcome).startsWith('STOP')).length;
  const wins=ordered.filter(x=>x.netPct>0), losses=ordered.filter(x=>x.netPct<0);
  const gp=wins.reduce((s,x)=>s+x.netPct,0), gl=Math.abs(losses.reduce((s,x)=>s+x.netPct,0));
  const p=t1/n,z=1.96,den=1+z*z/n;
  const lower=Math.max(0,(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/den);
  let equity=0,peak=0,maxDd=0;
  for(const t of ordered){equity+=t.netPct;peak=Math.max(peak,equity);maxDd=Math.min(maxDd,equity-peak);}
  return {
    entered:n,
    target1Pct:round(t1/n*100,1),
    stopPct:round(stop/n*100,1),
    positivePct:round(wins.length/n*100,1),
    avgNetPct:round(ordered.reduce((s,x)=>s+x.netPct,0)/n,2),
    medianNetPct:round(median(ordered.map(x=>x.netPct)),2),
    profitFactor:gl?round(gp/gl,2):gp>0?'INF':null,
    wilson95LowerTarget1Pct:round(lower*100,1),
    tradeSequenceMaxDrawdownPct:round(maxDd,2),
    totalNetPct:round(equity,2),
  };
}

function readUniverse() {
  if (!fs.existsSync(HISTORY)) throw new Error('HISTORY_DIRECTORY_MISSING');
  const docs=[];
  for(const file of fs.readdirSync(HISTORY).filter(x=>x.endsWith('.json')).sort()){
    try{
      const doc=JSON.parse(fs.readFileSync(path.join(HISTORY,file),'utf8'));
      if(!Array.isArray(doc.sessions) || doc.sessions.length<POLICY.minBars) continue;
      docs.push({ticker:String(doc.ticker??path.basename(file,'.json')).toUpperCase(),file,sessions:doc.sessions,lastSession:doc.lastSession??doc.sessions.at(-1)?.date??null,availableSessions:doc.availableSessions??doc.sessions.length});
    }catch{}
  }
  return docs;
}

function tradeKey(t){return `${t.ticker}|${t.signalDate}`;}
function compareTrades(baseTrades,altTrades){
  const b=new Map(baseTrades.map(t=>[tradeKey(t),t])),a=new Map(altTrades.map(t=>[tradeKey(t),t]));
  const matched=[];
  for(const [k,x] of b){if(a.has(k)){const y=a.get(k);matched.push({key:k,baselineNetPct:x.netPct,alternativeNetPct:y.netPct,deltaNetPct:round(y.netPct-x.netPct,2),baselineOutcome:x.outcome,alternativeOutcome:y.outcome});}}
  const added=[...a].filter(([k])=>!b.has(k)).map(([,x])=>x);
  const removed=[...b].filter(([k])=>!a.has(k)).map(([,x])=>x);
  return {
    matchedCount:matched.length,
    meanMatchedDeltaNetPct:matched.length?round(matched.reduce((s,x)=>s+x.deltaNetPct,0)/matched.length,3):null,
    matchedImproved:matched.filter(x=>x.deltaNetPct>0).length,
    matchedWorsened:matched.filter(x=>x.deltaNetPct<0).length,
    matchedEqual:matched.filter(x=>x.deltaNetPct===0).length,
    addedCount:added.length,
    addedSummary:summarizeTrades(added),
    removedCount:removed.length,
    removedSummary:summarizeTrades(removed),
    matchedSample:matched.slice(0,50),
  };
}

const universe=readUniverse();
const resultByVariant={};
for(const variant of VARIANTS){
  const tickerResults=[];
  const allTrades=[];
  let expired=0;
  for(const doc of universe){
    const r=backtestPlanVariant({ticker:doc.ticker,rows:doc.sessions,variant});
    tickerResults.push({ticker:doc.ticker,availableSessions:doc.availableSessions,lastSession:doc.lastSession,summary:r.summary,expired:r.expired.length});
    allTrades.push(...r.trades);
    expired+=r.expired.length;
  }
  resultByVariant[variant]={summary:summarizeTrades(allTrades),expiredSignals:expired,tickersWithTrades:tickerResults.filter(x=>x.summary.entered>0).length,trades:allTrades,tickerResults};
}

const baseline=resultByVariant.BASELINE_CURRENT;
const ladder=resultByVariant.RESISTANCE_LADDER_V1;
const comparison=compareTrades(baseline.trades,ladder.trades);
const pfNum=(x)=>x==='INF'?Infinity:Number(x);
const exploratoryBetter =
  ladder.summary.entered>=30 &&
  Number(ladder.summary.avgNetPct)>Number(baseline.summary.avgNetPct) &&
  pfNum(ladder.summary.profitFactor)>=pfNum(baseline.summary.profitFactor) &&
  Number(ladder.summary.stopPct)<=Number(baseline.summary.stopPct)+3;

const report={
  schemaVersion:'tfe-plan-construction-ablation-v1',
  generatedAt:new Date().toISOString(),
  mode:'RESEARCH_POINT_IN_TIME_EXPLORATORY',
  universe:{historyDirectory:'data/history',usableTickers:universe.length,minBars:POLICY.minBars,minLastSession:universe.map(x=>x.lastSession).filter(Boolean).sort()[0]??null,maxLastSession:universe.map(x=>x.lastSession).filter(Boolean).sort().at(-1)??null,medianAvailableSessions:median(universe.map(x=>Number(x.availableSessions)||0))},
  governance:{...PLAN_LAB_GOVERNANCE,thresholdRelaxationAllowed:false,productionPromotionAllowed:false,currentSampleWasUsedToFormHypothesis:true,independentForwardStillRequired:true},
  variants:Object.fromEntries(VARIANTS.map(v=>[v,{summary:resultByVariant[v].summary,expiredSignals:resultByVariant[v].expiredSignals,tickersWithTrades:resultByVariant[v].tickersWithTrades}])),
  comparison,
  exploratoryDecision:{ladderBeatsBaselineOnScreen:exploratoryBetter,meaning:exploratoryBetter?'CANDIDATE_FOR_FURTHER_OOS_NOT_PROMOTION':'REJECT_OR_REDESIGN_BEFORE_FURTHER_OOS',automaticProductionChange:false},
  perTicker:Object.fromEntries(VARIANTS.map(v=>[v,resultByVariant[v].tickerResults])),
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({universe:report.universe,variants:report.variants,comparison:{matchedCount:comparison.matchedCount,meanMatchedDeltaNetPct:comparison.meanMatchedDeltaNetPct,addedCount:comparison.addedCount,addedSummary:comparison.addedSummary,removedCount:comparison.removedCount,removedSummary:comparison.removedSummary},exploratoryDecision:report.exploratoryDecision},null,2));
