#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import { loadReplayDataset } from '../src/historical-simulator.js';
import { scanMarket } from '../src/engine.js';
import { explainConcentrationPool } from '../src/concentration.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outDir=path.join(root,'data','research');fs.mkdirSync(outDir,{recursive:true});
const upper=(rows,date)=>{let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(rows[m].date<=date)lo=m+1;else hi=m;}return lo;};
class SliceProvider{
  constructor(data,date){this.data=data;this.date=date;}
  async loadContext(){return {};}
  buildUniverse(){return this.data.entries;}
  async loadStock(entry){const rows=(this.data.histories.get(entry.ticker)||[]).slice(0,upper(this.data.histories.get(entry.ticker)||[],this.date));return {entry,rows,errors:[],meta:{expectedSessionDate:this.date,priceDataAsOf:rows.at(-1)?.date??null,fundamentalsAsOf:null,longHistorySource:'DIAGNOSTIC_POINT_IN_TIME',longHistoryRange:'RECORDED',longHistoryCoverageStart:rows[0]?.date??null,longHistoryCoverageEnd:rows.at(-1)?.date??null,sessionCount:rows.length}};}
  async loadBenchmark(){return this.data.benchmark.slice(0,upper(this.data.benchmark,this.date));}
}
const dates=(process.argv.find(x=>x.startsWith('--dates='))?.slice(8).split(',').filter(Boolean))||['2025-10-20','2026-05-18','2026-07-14'];
const data=await loadReplayDataset({config:DEFAULT_CONFIG});
const reports=[];
for(const date of dates){
  const scan=await scanMarket({provider:new SliceProvider(data,date),config:DEFAULT_CONFIG});
  const reasons={},statuses={};
  for(const row of scan.all||[]){statuses[row.status]=(statuses[row.status]||0)+1;for(const r of row.failed_rules||[])reasons[r]=(reasons[r]||0)+1;}
  const topByScore=[...(scan.all||[])].sort((a,b)=>(b.final_score??-1)-(a.final_score??-1)).slice(0,20).map(x=>({symbol:x.symbol,score:x.final_score,confidence:x.confidence_score,status:x.status,action:x.action,rr:x.reward_risk,riskPct:x.risk_pct,rs:x.rs_percentile,vcp:x.vcp?.quality,failedRules:x.failed_rules}));
  reports.push({date,market:scan.market_status,coverage:scan.market_coverage,statuses,hardReasonCounts:Object.fromEntries(Object.entries(reasons).sort((a,b)=>b[1]-a[1])),concentration:explainConcentrationPool(scan.all||[],DEFAULT_CONFIG.concentration),topByScore});
}
const report={generatedAt:new Date().toISOString(),dataset:{requested:data.requested,loaded:data.loaded,errors:data.errors.length},reports};
fs.writeFileSync(path.join(outDir,'historical-diagnostics.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
