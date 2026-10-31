'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const calendar=JSON.parse(fs.readFileSync(path.join(root,'data/quant/egx-verified-calendar-2026.json'),'utf8'));
const closed=new Set(calendar.verifiedClosures.map(x=>x.date));
const knownOpen=new Set(calendar.verifiedOpenSessions.map(x=>x.date));
if([...closed].some(d=>knownOpen.has(d)))throw Error('Contradictory calendar');
const ledgerFile=process.argv[2]||'data/quant/walk-forward-trade-ledger.json';
const output=process.argv[3]||'data/quant/calendar-conflicts.json';
const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
const conflictingTrades=(ledger.trades||[]).filter(t=>closed.has(t.entryDate)||closed.has(t.exitDate)).map(t=>({ticker:t.ticker,strategyId:t.strategyId,signalDate:t.signalDate,entryDate:t.entryDate,exitDate:t.exitDate,closedEntry:closed.has(t.entryDate),closedExit:closed.has(t.exitDate)}));
const involved=[...new Set((ledger.trades||[]).map(t=>t.ticker))];const anomalousBars=[];
for(const ticker of involved){const file=path.join(root,'data/history',ticker+'.json');if(!fs.existsSync(file))continue;
 const h=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const row of h.sessions||[])if(closed.has(row.date))anomalousBars.push({ticker,date:row.date,close:row.close,source:row.primarySource||row.source||null});
}
const result={status:conflictingTrades.length?'TRADE_ON_VERIFIED_CLOSURE':'RESEARCH_CALENDAR_AUDIT',calendarVerified:false,conflictingTrades,anomalousBars,verifiedClosureDates:[...closed].sort(),note:'A holiday price record may be stale or misdated; investigate provenance, never silently rewrite a trade or fill.'};
fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,conflictingTrades:conflictingTrades.length,anomalousBars:anomalousBars.length}));
