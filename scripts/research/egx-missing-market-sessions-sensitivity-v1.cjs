'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Research only');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {confirmedClosures,isTradingSession,shiftDay}=require('../ops/egx-session-math.cjs');
const {breadthByDate}=require('./egx-topfour-breadth-regime-v1.cjs');
const {evaluate}=require('./egx-strategy-top-four-tournament-v1.cjs');
function missingDates(trade,universe,closures){
 const rows=universe[trade.ticker]||[];const inWindow=new Set(rows.filter(r=>r.date>=trade.entryDate&&r.date<=trade.exitDate).map(r=>r.date));
 const result=[];for(let d=trade.entryDate;d<=trade.exitDate;d=shiftDay(d,1))if(isTradingSession(d,closures)&&!inWindow.has(d))result.push(d);
 return result;
}
function sensitivity(universe,doc,closures=confirmedClosures(root)){
 const rows=(doc.trades||[]).map(t=>({...t,missingSessionDates:missingDates(t,universe,closures)}));
 const flagged=rows.filter(t=>t.missingSessionDates.length>0),clean=rows.filter(t=>t.missingSessionDates.length===0);
 const breadth=breadthByDate(universe);
 const regimePass=t=>breadth.get(t.signalDate)?.pass===true;
 const before=evaluate({trades:rows.filter(regimePass)});
 const after=evaluate({trades:clean.filter(regimePass)});
 const summarize=m=>m.models.map(x=>({variant:x.variant,selectedTrades:x.portfolio.selectedTrades,totalReturnPct:x.portfolio.totalReturnPct,winRatePct:x.portfolio.winRatePct}));
 return {schemaVersion:'egx-missing-market-sessions-sensitivity-1',generatedAt:new Date().toISOString(),researchOnly:true,method:'Exclude trades when the ticker lacks a daily candle during an expected EGX trading session, using confirmed exchange closures and Sunday-Thursday calendar; compare top-four portfolios with same frozen breadth regime.',coverage:{trades:rows.length,flaggedTrades:flagged.length,cleanTrades:clean.length,affectedTickerCount:new Set(flagged.map(t=>t.ticker)).size,flaggedExamples:flagged.slice(0,25).map(t=>({ticker:t.ticker,variant:t.variant,entryDate:t.entryDate,exitDate:t.exitDate,missingSessionDates:t.missingSessionDates.slice(0,8)}))},withAllHistoricalTrades:summarize(before),excludingIncompleteTradeWindows:summarize(after),limitations:['Missing ticker candle may arise from legitimate suspension or illiquidity, not necessarily a vendor error','Conservative exclusion is a sensitivity analysis, not repairs to missing price history','Existing source ledger and cash portfolio model remain approximate','This is exploratory in-sample analysis, not independent validation']};
}
if(require.main===module){const {universe}=loadUniverse(),doc=JSON.parse(fs.readFileSync(path.join(root,'data/research/egx-comparable-three-strategy-v1.json'),'utf8')),result=sensitivity(universe,doc);fs.writeFileSync(path.join(root,'data/research/egx-missing-market-sessions-sensitivity-v1.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))}
module.exports={missingDates,sensitivity};
