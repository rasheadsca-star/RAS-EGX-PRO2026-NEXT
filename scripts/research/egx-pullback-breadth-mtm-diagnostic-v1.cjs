'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Live trading prohibited');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {breadthByDate}=require('./egx-topfour-breadth-regime-v1.cjs');
const policy=require('../../data/research/egx-pullback-breadth-frozen-policy-v1.json');
const rounded=n=>+n.toFixed(3);
function portfolio(universe,ledger,gate,options={}){
 const start=options.start||'0000-01-01',end=options.end||'9999-12-31',maxPositions=policy.maxOpenPositions,initial=policy.initialPaperCapitalEgp;
 const lookup=new Map(),allDates=new Set(),events=new Map();
 for(const [ticker,rows] of Object.entries(universe)){const map=new Map(rows.map(x=>[x.date,x]));lookup.set(ticker,map);for(const x of rows)if(x.date>=start&&x.date<=end)allDates.add(x.date)}
 const eligible=ledger.filter(t=>t.variant===policy.candidate&&t.signalScore>=policy.minimumSignalScore&&Number.isFinite(t.netReturnPct)&&t.signalDate>=start&&t.entryDate<=end&&t.exitDate<=end&&gate.get(t.signalDate)?.pass);
 for(const t of eligible){if(!events.has(t.entryDate))events.set(t.entryDate,[]);events.get(t.entryDate).push(t)}
 const sorted=[...allDates].sort();let cash=initial,peak=initial,maxDrawdown=0,staleMarks=0;const active=[],executed=[],curve=[];
 for(const date of sorted){
  // Settle at the modeled exit price approximated by the trade net return, not a future close.
  for(let j=active.length-1;j>=0;j--){const p=active[j];if(p.exitDate>date)continue;cash+=p.principal*(1+p.netReturnPct/100);active.splice(j,1)}
  const todays=(events.get(date)||[]).slice().sort((a,b)=>b.signalScore-a.signalScore||a.ticker.localeCompare(b.ticker));
  function equityAtClose(){let total=cash;for(const p of active){const bar=lookup.get(p.ticker)?.get(date);if(bar){p.lastClose=bar.close}else staleMarks++;total+=p.principal*(p.lastClose/p.entryOpen)}return total}
  for(const t of todays){
   if(active.length>=maxPositions||active.some(p=>p.ticker===t.ticker))continue;
   const entryBar=lookup.get(t.ticker)?.get(date);if(!entryBar||!(entryBar.open>0))continue;
   const availableEquity=cash+active.reduce((sum,p)=>sum+p.principal*(p.lastClose/p.entryOpen),0);
   const principal=Math.min(cash,availableEquity/maxPositions);if(!(principal>0))continue;
   cash-=principal;active.push({...t,principal,entryOpen:entryBar.open*(1+policy.execution.entrySlippagePct/100),lastClose:entryBar.open*(1+policy.execution.entrySlippagePct/100)});executed.push(t);
  }
  const equity=equityAtClose();peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,100*(peak-equity)/peak);curve.push({date,equityEgp:rounded(equity),cashEgp:rounded(cash),openPositions:active.length});
 }
 return {accountingAudit:{usesLedgerExitReturns:true,usesLastAvailableCloseForMissingDays:true,entryBookedOnEntryDate:true,exitsSettledAtSessionStart:true},totalReturnPct:rounded(((curve.at(-1)?.equityEgp??initial)/initial-1)*100),endEquityEgp:curve.at(-1)?.equityEgp??initial,markToMarketMaxDrawdownPct:rounded(maxDrawdown),executedTrades:executed.length,staleMarks,endingOpenPositions:active.length,curve};
}
function main(){
 const {universe}=loadUniverse(),breadth=breadthByDate(universe),ledger=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8')).trades;
 const dates=[...new Set(ledger.map(x=>x.signalDate))].sort(),boundary=dates[Math.floor(dates.length*policy.evaluation.chronologicalTrainFraction)];
 const embargoStart=new Date(Date.parse(boundary+'T00:00:00Z')+policy.evaluation.embargoCalendarDays*86400000).toISOString().slice(0,10);
 const both=portfolio(universe,ledger,breadth),early=portfolio(universe,ledger,breadth,{end:boundary}),later=portfolio(universe,ledger,breadth,{start:embargoStart});
 const strip=({curve,...s})=>s;
 const result={schemaVersion:'egx-pullback-breadth-mtm-diagnostic-1',generatedAt:new Date().toISOString(),researchOnly:true,productionReady:false,policyRef:'data/research/egx-pullback-breadth-frozen-policy-v1.json',boundaryDate:boundary,postEmbargoStart:embargoStart,periods:{all:strip(both),earlier:strip(early),laterDiagnosticNotIndependentOOS:strip(later)},equityCurves:{all:both.curve,earlier:early.curve,laterDiagnostic:later.curve},limitations:['Later sample has already influenced strategy selection and cannot be certified untouched out of sample','Earlier and later start with independent 100k capital and omit carry-over across boundary','Only previously closed, fully observed trades available in source ledger; excluded unresolved and historical in-sample blocking can bias selection','Original ledger exit accounting is reused; fills, corporate actions, missing candles and liquidity unverified','Missing intermediate bars carry last mark; inspect staleMarks','No trading authorization']};
 fs.writeFileSync(path.join(root,'data/research/egx-pullback-breadth-mtm-diagnostic-v1.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({boundary,embargoStart,periods:result.periods},null,2));
}
if(require.main===module)main();module.exports={portfolio};
