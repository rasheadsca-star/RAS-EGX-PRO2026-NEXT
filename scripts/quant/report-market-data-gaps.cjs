'use strict';
const fs=require('node:fs'),path=require('node:path');
const folder=process.argv[2]||'research-artifacts';
const files=fs.readdirSync(folder).filter(n=>/^diagnosis-(20000|100000)-(low|medium|high)\.json$/.test(n));
const dates=new Map(),tickers=new Map();
for(const file of files){
 const d=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));
 const seen=new Set();
 for(const mark of d.missingMarkDetails||[]){
  const key=mark.date+'|'+mark.ticker;if(seen.has(key))continue;seen.add(key);
  if(!dates.has(mark.date))dates.set(mark.date,{date:mark.date,scenarios:new Set(),tickers:new Set()});
  dates.get(mark.date).scenarios.add(file);dates.get(mark.date).tickers.add(mark.ticker);
  if(!tickers.has(mark.ticker))tickers.set(mark.ticker,{ticker:mark.ticker,scenarios:new Set(),dates:new Set()});
  tickers.get(mark.ticker).scenarios.add(file);tickers.get(mark.ticker).dates.add(mark.date);
 }
}
const summary={status:'UNVERIFIED_PRICE_GAPS',scenariosInspected:files.length,
 dates:[...dates.values()].map(x=>({date:x.date,scenarioCount:x.scenarios.size,tickers:[...x.tickers].sort()})).sort((a,b)=>b.scenarioCount-a.scenarioCount||a.date.localeCompare(b.date)),
 tickers:[...tickers.values()].map(x=>({ticker:x.ticker,scenarioCount:x.scenarios.size,dates:[...x.dates].sort()})).sort((a,b)=>b.dates.length-a.dates.length||a.ticker.localeCompare(b.ticker)),
 note:'Repeated dates do not by themselves confirm an official EGX market session. Repair requires provenance-verified OHLC; no imputation.'};
fs.writeFileSync(path.join(folder,'market-data-gap-inventory.json'),JSON.stringify(summary,null,2));
console.log('Incomplete dates: '+summary.dates.length+', tickers: '+summary.tickers.length);
