'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Research only');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse,features}=require('./egx-strategy-challengers-v1.cjs');
const {selectPortfolio}=require('./egx-top-four-portfolio-v1.cjs');
const round=(x)=>+x.toFixed(3);
function rankUniverse(universe,minimumTurnover=100000){
 const daily=new Map();
 for(const [ticker,rows] of Object.entries(universe)){
  for(let i=54;i<rows.length-1;i++){
   const f=features(rows,i),c=rows[i];if(!f||!Number.isFinite(f.turnover20)||f.turnover20<minimumTurnover||!Number.isFinite(f.momentum20Pct))continue;
   const atrRange=(c.high-c.low)/c.close*100;
   const score=f.momentum20Pct+3*(f.uptrend?1:0)+2*(f.above50?1:0)+Math.min(6,Math.log10(1+f.turnover20/100000))-atrRange;
   if(!daily.has(c.date))daily.set(c.date,[]);
   daily.get(c.date).push({ticker,date:c.date,score:round(score)});
  }
 }
 const selected=new Map(),counts=[];
 for(const [day,all] of daily){all.sort((a,b)=>b.score-a.score||a.ticker.localeCompare(b.ticker));selected.set(day,new Set(all.slice(0,4).map(x=>x.ticker)));counts.push({date:day,eligible:all.length,selected:all.slice(0,4)});}
 return {selected,counts};
}
function evaluate(universe,trades){
 const ranking=rankUniverse(universe);
 const shortlisted=trades.filter(t=>ranking.selected.get(t.signalDate)?.has(t.ticker));
 const models=['breakout_filtered','relative_momentum','trend_pullback'].map(variant=>{
  const selected=selectPortfolio(shortlisted,variant);
  return {variant,unfilteredTradeCount:trades.filter(t=>t.variant===variant).length,shortlistedTradeCount:shortlisted.filter(t=>t.variant===variant).length,...selected};
 });
 return {schemaVersion:'egx-market-top-four-first-v1',generatedAt:new Date().toISOString(),researchOnly:true,ranking:'Each signal date, select at most four strongest stocks across the entire eligible market from signal-time OHLCV momentum, trend, liquidity and daily range, independent of strategy outputs. Then evaluate each strategy only on those stocks.',coverage:{dates:ranking.counts.length,daysWithAtLeastFourEligible:ranking.counts.filter(x=>x.eligible>=4).length},models,rankedDailyUniverse:ranking.counts,limitations:['Top-four universe reselected each decision date, not a permanent four-stock universe','The ranking score is a first exploratory hypothesis, not optimized or validated','Portfolio exit values recognized without interim mark-to-market; drawdown underestimates risk','Historical survivorship and corporate-action checks incomplete','Previously observed strategy performance influenced candidate design; no untouched OOS']};
}
if(require.main===module){
 const {universe}=loadUniverse(),source=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8'));
 const result=evaluate(universe,source.trades),dst=path.join(root,'data/research/egx-market-top-four-first-v1.json');
 fs.writeFileSync(dst,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({coverage:result.coverage,models:result.models.map(({selected,equityCurve,...data})=>data)},null,2));
}
module.exports={rankUniverse,evaluate};
