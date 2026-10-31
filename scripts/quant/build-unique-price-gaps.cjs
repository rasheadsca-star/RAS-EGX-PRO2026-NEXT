'use strict';
const fs=require('node:fs'),path=require('node:path');
const input=process.argv[2]||'research-artifacts/market-data-gap-inventory.json';
const output=process.argv[3]||'research-artifacts/unique-price-gaps.json';
const raw=JSON.parse(fs.readFileSync(input,'utf8'));
const pairs=new Map();
for(const d of raw.dates||[])for(const ticker of d.tickers||[]){
 const key=ticker+'|'+d.date;
 if(!pairs.has(key))pairs.set(key,{ticker,date:d.date,status:'SOURCE_VERIFICATION_REQUIRED',officialPrice:null});
}
const grouped=[...pairs.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.ticker.localeCompare(b.ticker));
const result={schemaVersion:'1.0',status:'UNVERIFIED',uniqueGapCount:grouped.length,affectedTickers:new Set(grouped.map(x=>x.ticker)).size,affectedDates:new Set(grouped.map(x=>x.date)).size,pairs:grouped,policy:'Never fill prices without a dated source, ticker identity and numeric close price verification.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({uniqueGapCount:result.uniqueGapCount,affectedTickers:result.affectedTickers,affectedDates:result.affectedDates}));
