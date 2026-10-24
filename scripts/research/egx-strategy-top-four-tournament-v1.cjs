'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Research-only strategy tournament');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {selectPortfolio}=require('./egx-top-four-portfolio-v1.cjs');
const variants=['breakout_filtered','relative_momentum','trend_pullback'];
function evaluate(doc){
 const all=doc.trades||[];
 const summaries=variants.map(variant=>{
  const signals=all.filter(x=>x.variant===variant);
  const byDate=new Map();
  for(const s of signals){if(!byDate.has(s.signalDate))byDate.set(s.signalDate,[]);byDate.get(s.signalDate).push(s)}
  const daily=[...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,rows])=>{
   const sorted=rows.slice().sort((a,b)=>b.signalScore-a.signalScore||a.ticker.localeCompare(b.ticker));
   return {date,candidates:sorted.length,topFour:sorted.slice(0,4).map(x=>({ticker:x.ticker,signalScore:x.signalScore,netReturnPct:x.netReturnPct}))};
  });
  const portfolio=selectPortfolio(all,variant,{initialCapital:100000,maxPositions:4});
  const {selected,equityCurve,...portfolioStats}=portfolio;
  return {variant,totalCandidateSignals:signals.length,selectionDays:daily.length,topFourPerDecisionDay:daily,portfolio:portfolioStats,executedSelection: selected};
 });
 return {schemaVersion:'egx-strategy-top-four-tournament-1',generatedAt:new Date().toISOString(),researchOnly:true,method:'Each independent strategy evaluates all eligible shares, ranks its own historical signals by signal-time score, reports best four per decision date; capital-constrained maximum four simultaneously held with same execution assumptions.',models:summaries,limitations:['Existing historical trade ledger excludes some unresolved signals; this cannot reconstruct full live candidate lists','Backtest scores are exploratory and were not validated on untouched independent data','Portfolio uses closed-trade cash accounting, not daily mark-to-market; max drawdown is not reliable','Selection is made only among historical strategy signals, never by future net returns','No trade execution authorization']};
}
if(require.main===module){
 const data=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8'));
 const out=evaluate(data),file=path.join(root,'data/research/egx-strategy-top-four-tournament-v1.json');
 fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({models:out.models.map(({topFourPerDecisionDay,executedSelection,...m})=>({...m,exampleDays:topFourPerDecisionDay.slice(0,2)}))},null,2));
}
module.exports={evaluate};
