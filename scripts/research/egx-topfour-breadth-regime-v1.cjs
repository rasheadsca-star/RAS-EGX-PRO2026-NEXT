'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('No live execution in regime research');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse,features}=require('./egx-strategy-challengers-v1.cjs');
const {evaluate}=require('./egx-strategy-top-four-tournament-v1.cjs');
const PARAMS=Object.freeze({minBreadth:45,minEligibleStocks:30,minTurnover20:100000});
function breadthByDate(universe){
 const sums=new Map();
 for(const rows of Object.values(universe)){
  for(let i=54;i<rows.length;i++){
   const f=features(rows,i);if(!f||!Number.isFinite(f.turnover20)||f.turnover20<PARAMS.minTurnover20)continue;
   const day=rows[i].date,s=sums.get(day)||{date:day,eligible:0,aboveSma50:0};
   s.eligible++;if(f.above50)s.aboveSma50++;sums.set(day,s);
  }
 }
 return new Map([...sums].map(([date,v])=>[date,{...v,breadthPct:+(100*v.aboveSma50/v.eligible).toFixed(2),pass:v.eligible>=PARAMS.minEligibleStocks&&100*v.aboveSma50/v.eligible>=PARAMS.minBreadth}]));
}
function assess(doc,breadth){
 const baseline=evaluate(doc),allowed=doc.trades.filter(t=>breadth.get(t.signalDate)?.pass===true),filtered=evaluate({...doc,trades:allowed});
 return {schemaVersion:'egx-topfour-breadth-regime-research-1',generatedAt:new Date().toISOString(),researchOnly:true,policy:PARAMS,method:'Contemporaneous cross-sectional breadth from eligible stock close vs its own 50-session moving average, no EGX30 inference. Apply before per-strategy score >=60 and best four with max four open positions.',baseline:baseline.models.map(x=>({variant:x.variant,...x.portfolio})),filtered:filtered.models.map(x=>({variant:x.variant,...x.portfolio})),coverage:{tradesBefore:doc.trades.length,tradesAfter:allowed.length,coveredSignalDates:[...breadth.keys()].length,passDates:[...breadth.values()].filter(x=>x.pass).length},limitations:['Cross-sectional breadth is a proxy, not an official EGX30 regime','Historical available universe may suffer survivorship bias','Filter is exploratory on previously observed history; cannot certify out-of-sample improvement','Approximate portfolio cash simulation does not mark open positions to market']};
}
if(require.main===module){const source=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8')),b=breadthByDate(loadUniverse().universe),r=assess(source,b);fs.writeFileSync(path.join(root,'data/research/egx-topfour-breadth-regime-v1.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({coverage:r.coverage,comparisons:r.filtered.map((x,i)=>({variant:x.variant,before:r.baseline[i].totalReturnPct,after:x.totalReturnPct,beforeTrades:r.baseline[i].selectedTrades,afterTrades:x.selectedTrades}))},null,2))}
module.exports={breadthByDate,assess};
