'use strict';
// Daily mark-to-market paper portfolio. Research only; no broker orders.
// Mark positions at each session close using historical OHLC. Capital constraint:
// positions reserve their initial allocation; proceeds are released only after exit.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function run(ledger,opts={}){
 const initial=Number(opts.initialEquityEgp??1000000),allocation=Number(opts.positionFraction??.10),maxPositions=Number(opts.maxPositions??8);
 if(!(initial>0&&allocation>0&&allocation<=1&&maxPositions>=1&&Number.isInteger(maxPositions)))throw Error('invalid portfolio controls');
 const trades=(ledger.trades||[]).filter(t=>t.status==='CLOSED'&&t.entryDate&&t.exitDate&&t.entryPrice>0&&t.exitPrice>0&&Number.isFinite(t.netReturnPct)&&t.netReturnPct>-100)
   .sort((a,b)=>a.entryDate.localeCompare(b.entryDate)||a.ticker.localeCompare(b.ticker)||a.strategyId.localeCompare(b.strategyId));
 const history=new Map();
 const dates=new Set();
 for(const t of trades){let file=path.join(root,'data/history',t.ticker+'.json');if(!history.has(t.ticker)){
  let raw=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  history.set(t.ticker,new Map((raw.sessions||[]).map(x=>[x.date,Number(x.close)])));
 }dates.add(t.entryDate);dates.add(t.exitDate);}
 for(const series of history.values())for(const d of series.keys())dates.add(d);
 const start=trades[0]?.entryDate,end=trades.reduce((a,t)=>!a||t.exitDate>a?t.exitDate:a,null);
 // Union calendars can contain dates traded by only one symbol. Require broad cross-symbol
 // evidence of a market session, but ALWAYS retain dates with actual entry/exit executions.
 const coverage=new Map();
 for(const series of history.values())for(const date of series.keys())coverage.set(date,(coverage.get(date)||0)+1);
 const mandatoryDates=new Set(trades.flatMap(t=>[t.entryDate,t.exitDate]));
 const minimumMarketCoverage=Math.max(2,Math.ceil(history.size*0.20));
 const sessions=[...dates].filter(d=>start&&d>=start&&d<=end&&(mandatoryDates.has(d)||(coverage.get(d)||0)>=minimumMarketCoverage)).sort();
 let cash=initial,peak=initial,maxDD=0,accepted=0,rejected=0,missingMarks=0,maxOpenPositions=0;
 const missingMarkDetails=[];
 const missingByTicker={};
 const open=[],ledgerOut=[],curve=[];let cursor=0;
 for(const date of sessions){
  // Conservative daily bars: place entries before same-day exits; do not reuse unknown intraday proceeds.
  // Open new positions at recorded entry price, before end-of-day mark.
  while(cursor<trades.length&&trades[cursor].entryDate===date){
   const t=trades[cursor++],budget=Math.min(initial*allocation,cash);
   if(open.length>=maxPositions||budget<initial*allocation*.999){rejected++;continue;}
   cash-=budget;open.push({trade:t,budget,units:budget/t.entryPrice,lastPrice:t.entryPrice});accepted++;
  }
  for(const p of open){
   const close=history.get(p.trade.ticker)?.get(date);
   if(Number.isFinite(close)&&close>0)p.lastPrice=close;
   else if(date>p.trade.entryDate&&date<p.trade.exitDate){missingMarks++;missingMarkDetails.push({date,ticker:p.trade.ticker,strategyId:p.trade.strategyId});missingByTicker[p.trade.ticker]=(missingByTicker[p.trade.ticker]||0)+1;}
   // On exit day, use simulated exitPrice, not the day's close.
   if(date===p.trade.exitDate)p.lastPrice=p.trade.exitPrice;
  }
  for(let i=open.length-1;i>=0;i--)if(open[i].trade.exitDate===date){
   const p=open[i];const proceeds=p.budget*(1+p.trade.netReturnPct/100);
   cash+=proceeds;ledgerOut.push({ticker:p.trade.ticker,strategyId:p.trade.strategyId,entryDate:p.trade.entryDate,exitDate:date,allocatedEgp:p.budget,pnlEgp:+(proceeds-p.budget).toFixed(2),netReturnPct:p.trade.netReturnPct});
   open.splice(i,1);
  }
  maxOpenPositions=Math.max(maxOpenPositions,open.length);
  const invested=open.reduce((a,p)=>a+p.units*p.lastPrice,0),equity=cash+invested;
  if(!Number.isFinite(equity)||equity<0||cash < -0.000001||open.length>maxPositions)throw Error('portfolio accounting violation');
  peak=Math.max(peak,equity);maxDD=Math.max(maxDD,100*(peak-equity)/peak);
  curve.push({date,cashEgp:+cash.toFixed(2),investedEgp:+invested.toFixed(2),equityEgp:+equity.toFixed(2),drawdownPct:+(100*(peak-equity)/peak).toFixed(4),openPositions:open.length});
 }
 return {schemaVersion:'1.0',status:missingMarks?'INCOMPLETE_PRICE_MARKS':'RESEARCH_ONLY_UNCERTIFIED',executionReady:false,performanceCertified:false,assumptions:{initialEquityEgp:initial,positionFraction:allocation,maxPositions,entryMark:'recorded entry price; intraday timing unknown; new entries before same-day exits for cash conservatism',exitMark:'trade exit price',brokerFees:'realized P&L uses trade.netReturnPct (must include simulator fees and slippage); daily interim mark remains gross because future closing cost is unknown',corporateActions:'unverified',sessionCalendar:'cross-symbol coverage >=20%, plus mandatory entry and exit dates; provisional calendar, not official EGX',minimumMarketCoverage},accepted,rejected,missingMarks,missingMarkDetails,missingByTicker,marketSessionCount:sessions.length,historySymbolCount:history.size,maxOpenPositions,valuationComplete:missingMarks===0,endingEquityEgp:curve.at(-1)?.equityEgp??initial,maxDrawdownPct:+maxDD.toFixed(4),curve,closedPositions:ledgerOut};
}
if(require.main===module){const input=JSON.parse(fs.readFileSync(process.argv[2]||'data/quant/walk-forward-trade-ledger.json','utf8'));const result=run(input);const output=process.argv[3]||'data/quant/research-daily-portfolio.json';fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({accepted:result.accepted,rejected:result.rejected,missingMarks:result.missingMarks,missingTickers:Object.keys(result.missingByTicker).length,maxDrawdownPct:result.maxDrawdownPct,endingEquityEgp:result.endingEquityEgp}));}
module.exports={run};
