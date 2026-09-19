import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MarketDataProvider } from '../src/providers.js';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const input=path.join(root,'data/research/historical-simulator.json');
const output=path.join(root,'data/research/precision-execution-benchmark.json');
const report=JSON.parse(fs.readFileSync(input,'utf8'));
const entered=(report.trades||[]).filter(t=>t.entered===true);
const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;

function wilsonLower(successes,n,z=1.96){
  if(!n)return null;
  const p=successes/n,z2=z*z,den=1+z2/n;
  const center=p+z2/(2*n),margin=z*Math.sqrt((p*(1-p)+z2/(4*n))/n);
  return Math.max(0,(center-margin)/den)*100;
}

async function workerMap(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(error){out[i]={error:String(error?.message||error)};}}}
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},worker));
  return out;
}

const provider=new MarketDataProvider(DEFAULT_CONFIG);
const ctx=await provider.loadContext();
const universe=provider.buildUniverse(ctx);
const entryMap=new Map(universe.map(x=>[String(x.ticker).toUpperCase(),x]));
const symbols=[...new Set(entered.map(t=>String(t.symbol).toUpperCase()))];
const loaded=await workerMap(symbols,Math.max(2,DEFAULT_CONFIG.cache.concurrency),async symbol=>{
  const entry=entryMap.get(symbol);
  if(!entry)throw new Error(`UNIVERSE_SYMBOL_MISSING:${symbol}`);
  const stock=await provider.loadStock(entry);
  return {symbol,rows:stock.rows||[],errors:stock.errors||[]};
});
const histories=new Map();
const loadErrors=[];
for(let i=0;i<symbols.length;i++){
  const item=loaded[i];
  if(item?.error){loadErrors.push({symbol:symbols[i],error:item.error});continue;}
  histories.set(item.symbol,item.rows);
  if(item.errors?.length)loadErrors.push(...item.errors.map(error=>({symbol:item.symbol,error})));
}

function targetFor(t,r,mode){
  const entry=Number(t.entryPrice),stop=Number(t.stopLoss),risk=entry-stop;
  if(!(entry>0&&risk>0))return null;
  if(mode==='PLANNED_SIGNAL')return finite(t.precisionTarget)?Number(t.precisionTarget):null;
  let target=entry+Number(r)*risk;
  if(t.precisionTargetCappedByResistance===true&&finite(t.precisionTarget))target=Math.min(target,Number(t.precisionTarget));
  return target;
}

function evaluate(t,{r=.8,hold=10,mode='EXECUTED_RISK'}={}){
  const rows=histories.get(String(t.symbol).toUpperCase())||[];
  const entryIndex=rows.findIndex(b=>String(b.date)===String(t.entryDate));
  const stop=Number(t.stopLoss),target=targetFor(t,r,mode);
  if(entryIndex<0||!finite(stop)||!finite(target))return {...t,precisionEval:'INVALID',precisionEvalTarget:target};
  const end=Math.min(rows.length-1,entryIndex+Math.max(1,Number(hold))-1);
  for(let j=entryIndex;j<=end;j++){
    const bar=rows[j];
    const stopTouched=Number(bar.low)<=stop,targetTouched=Number(bar.high)>=target;
    // Same-bar ambiguity remains deliberately conservative: STOP wins.
    if(stopTouched)return {...t,precisionEval:'STOP',precisionEvalDate:bar.date,precisionEvalTarget:round(target,4)};
    if(targetTouched)return {...t,precisionEval:'HIT',precisionEvalDate:bar.date,precisionEvalTarget:round(target,4)};
  }
  return {...t,precisionEval:'TIME',precisionEvalDate:rows[end]?.date??null,precisionEvalTarget:round(target,4)};
}

function summarize(rows){
  const valid=rows.filter(x=>x.precisionEval!=='INVALID'),hits=valid.filter(x=>x.precisionEval==='HIT').length,stops=valid.filter(x=>x.precisionEval==='STOP').length;
  return {
    entered:valid.length,
    hitPct:valid.length?round(hits/valid.length*100,1):null,
    stopBeforeTargetPct:valid.length?round(stops/valid.length*100,1):null,
    timeExitPct:valid.length?round(valid.filter(x=>x.precisionEval==='TIME').length/valid.length*100,1):null,
    wilson95LowerHitPct:valid.length?round(wilsonLower(hits,valid.length),1):null,
  };
}

function temporal(rows){
  const byYear={};
  for(const row of rows){const y=String(row.signalDate||'').slice(0,4)||'UNKNOWN';(byYear[y]??=[]).push(row);}
  for(const [year,xs] of Object.entries(byYear))byYear[year]=summarize(xs);
  const ordered=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))),mid=Math.floor(ordered.length/2);
  return {firstHalf:summarize(ordered.slice(0,mid)),lastHalf:summarize(ordered.slice(mid)),byYear};
}

const rGrid=[.5,.6,.7,.8,1];
const grid={};
for(const r of rGrid){
  grid[String(r)]={};
  for(const hold of [10,20]){
    const rows=entered.map(t=>evaluate(t,{r,hold,mode:'EXECUTED_RISK'}));
    grid[String(r)][`${hold}Sessions`]=summarize(rows);
  }
}

const planned10=entered.map(t=>evaluate(t,{r:.8,hold:10,mode:'PLANNED_SIGNAL'}));
const planned20=entered.map(t=>evaluate(t,{r:.8,hold:20,mode:'PLANNED_SIGNAL'}));
const executed10=entered.map(t=>evaluate(t,{r:.8,hold:10,mode:'EXECUTED_RISK'}));
const executed20=entered.map(t=>evaluate(t,{r:.8,hold:20,mode:'EXECUTED_RISK'}));

const strategyBreakdown={};
for(const row of executed10){const k=row.bestStrategy||'UNCLASSIFIED';(strategyBreakdown[k]??=[]).push(row);}
for(const [k,xs] of Object.entries(strategyBreakdown))strategyBreakdown[k]=summarize(xs);

const riskBand4to6=executed10.filter(x=>Number(x.riskPct)>=4&&Number(x.riskPct)<=6);
const result={
  schemaVersion:'sepa-x-precision-execution-benchmark.1',
  generatedAt:new Date().toISOString(),
  researchOnly:true,
  methodology:{pointInTimeSelection:true,noLookahead:true,entryAfterSignal:true,sameBarAmbiguity:'STOP_FIRST',executedTargetFormula:'actualFill + R * (actualFill - stop)',structuralCapPreservedWhenSignalPlanWasCapped:true,comparisonHorizonSessions:[10,20]},
  dataset:{enteredTrades:entered.length,symbols:[...histories.keys()].length,loadErrors:loadErrors.length},
  plannedSignalP1:{tenSessions:summarize(planned10),twentySessions:summarize(planned20)},
  executedRiskP1:{tenSessions:summarize(executed10),twentySessions:summarize(executed20),temporal10:temporal(executed10),strategyBreakdown10:strategyBreakdown,riskBand4to6TenSessions:summarize(riskBand4to6)},
  rSweepExecuted:grid,
  rc2Reference:{targetR:.8,maxHoldSessions:10,entered:67,targetHitPct:76.1,wilson95LowerTargetHitPct:64.7,source:'rc2-simulate.json frozen benchmark evidence'},
  loadErrors,
};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({plannedP1_10:result.plannedSignalP1.tenSessions,executedP1_10:result.executedRiskP1.tenSessions,executedP1_20:result.executedRiskP1.twentySessions,rSweep:result.rSweepExecuted,riskBand4to6:result.executedRiskP1.riskBand4to6TenSessions},null,2));
