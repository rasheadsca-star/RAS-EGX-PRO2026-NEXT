'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Research only: no live trading');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const variants=['breakout_filtered','relative_momentum','trend_pullback'];
const round=(n,k=3)=>+n.toFixed(k);
function selectPortfolio(trades,variant,options={}){
 const initial=options.initialCapital??100000,maxPositions=options.maxPositions??4,positionFraction=1/maxPositions;
 if(!(initial>0)||!Number.isInteger(maxPositions)||maxPositions<1)throw Error('Invalid portfolio options');
 const rows=trades.filter(x=>x.variant===variant&&Number.isFinite(x.signalScore)&&Number.isFinite(x.netReturnPct)).sort((a,b)=>a.signalDate.localeCompare(b.signalDate)||b.signalScore-a.signalScore||a.ticker.localeCompare(b.ticker));
 const days=[...new Set(rows.map(x=>x.signalDate))],active=[],selected=[],equityCurve=[],rejected={capacity:0,alreadyHeld:0},cashStart=initial;
 let cash=cashStart,peak=initial,maxDrawdown=0;
 function value(){return cash+active.reduce((sum,p)=>sum+p.principal,0)}
 function closeBefore(day){
  const releasing=active.filter(p=>p.exitDate<=day).sort((a,b)=>a.exitDate.localeCompare(b.exitDate));
  for(const p of releasing){cash+=p.principal*(1+p.netReturnPct/100);const i=active.indexOf(p);active.splice(i,1)}
 }
 for(const day of days){
  closeBefore(day);
  const available=rows.filter(x=>x.signalDate===day);
  for(const trade of available){
   if(active.some(p=>p.ticker===trade.ticker)){rejected.alreadyHeld++;continue}
   if(active.length>=maxPositions){rejected.capacity++;continue}
   const principal=Math.min(cash,value()*positionFraction);
   if(!(principal>0)){rejected.capacity++;continue}
   cash-=principal;active.push({...trade,principal});selected.push({...trade,allocatedCapital:round(principal,2)});
  }
  const eq=value(),currentPeak=Math.max(peak,eq);peak=currentPeak;
  maxDrawdown=Math.max(maxDrawdown,(peak-eq)/peak*100);
  equityCurve.push({date:day,equity:round(eq,2),openPositions:active.length});
 }
 closeBefore('9999-12-31');
 const finalEquity=cash; // all counted trades are closed
 const r=selected.map(x=>x.netReturnPct),pos=r.filter(x=>x>0),loss=r.filter(x=>x<0);
 return {variant,initialCapital:initial,finalEquity:round(finalEquity,2),totalReturnPct:round((finalEquity/initial-1)*100),selectedTrades:selected.length,selectionHitRatePct:rows.length?round(selected.length/rows.length*100,2):null,winRatePct:r.length?round(pos.length/r.length*100,2):null,meanTradeReturnPct:r.length?round(r.reduce((a,b)=>a+b,0)/r.length):null,profitFactor:loss.length?round(pos.reduce((a,b)=>a+b,0)/(-loss.reduce((a,b)=>a+b,0))):null,maxDrawdownPctOnDecisionDates:round(maxDrawdown),rejected,selected,equityCurve};
}
function main(){
 const data=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8'));
 const models=variants.map(x=>selectPortfolio(data.trades,x));
 const result={schemaVersion:'egx-top-four-selection-1',generatedAt:new Date().toISOString(),researchOnly:true,selectionRule:'At each historical decision date rank same-strategy signals by frozen point-in-time signalScore; take at most four simultaneous open positions; no duplicate ticker; equal initial 25% target budget with available cash constraint.',assumptions:['Uses already simulated closed trades, not a full bar-by-bar portfolio mark-to-market','Equity curve is valued at cost for positions still open on decision dates, so reported drawdown understates true mark-to-market drawdown','Position cash committed at signal close although execution assumed following session open; capital feasibility is approximate','Unresolved trades excluded; survivorship and corporate actions not fully audited','Scores and strategy choice are exploratory and previously influenced by observed returns; not certified out-of-sample'],models};
 const out=path.join(root,'data/research/egx-top-four-portfolio-v1.json');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({models:models.map(({selected,equityCurve,...rest})=>rest)},null,2));
}
if(require.main===module)main();module.exports={selectPortfolio};
