'use strict';
// EGX PRO: date-first missing-mark inventory from real six-scenario paper replay.
// Inventory contains no market prices and grants no market-data reuse rights.
const fs=require('node:fs'),path=require('node:path');
function build(replays){
 const seen=new Map(),byDate=new Map();
 for(const [scenario,raw] of replays){
  if(!Array.isArray(raw.missingMarkDetails))throw Error('Missing diagnostic details in '+scenario);
  for(const row of raw.missingMarkDetails){
   if(!/^20\d{2}-\d{2}-\d{2}$/.test(row.date)||!/^[A-Z0-9]{2,8}$/.test(row.ticker))throw Error('Invalid missing mark');
   const key=row.ticker+'|'+row.date;
   let item=seen.get(key);
   if(!item){item={ticker:row.ticker,date:row.date,markOccurrences:0,scenarios:new Set()};seen.set(key,item);}
   item.markOccurrences++;item.scenarios.add(scenario);
  }
 }
 for(const item of seen.values()){
  if(!byDate.has(item.date))byDate.set(item.date,{date:item.date,missingMarks:0,distinctPairs:0,stocks:[]});
  const d=byDate.get(item.date);d.missingMarks+=item.markOccurrences;d.distinctPairs++;
  d.stocks.push({ticker:item.ticker,missingMarks:item.markOccurrences,scenarioCount:item.scenarios.size});
 }
 const dates=[...byDate.values()].map(d=>({...d,stocks:d.stocks.sort((a,b)=>b.missingMarks-a.missingMarks||a.ticker.localeCompare(b.ticker))})).sort((a,b)=>b.missingMarks-a.missingMarks||a.date.localeCompare(b.date));
 return {schemaVersion:1,researchOnly:true,productionImportCount:0,marketDataLicensed:false,
  scenarios:replays.length,distinctPairs:seen.size,missingMarks:dates.reduce((n,d)=>n+d.missingMarks,0),
  topTenDatesMarks:dates.slice(0,10).reduce((n,d)=>n+d.missingMarks,0),dates,
  instructions:'Verify one dated EGX or broker daily report against every listed stock for that session. Require independently checked ISIN, raw/adjusted price basis, source licence and explicit close/volume evidence. Never populate canonical OHLCV from this queue.'};
}
function run(dir='research-artifacts',out='research-artifacts/session-batch-worklist.json'){
 const names=fs.readdirSync(dir).filter(s=>/^evidence-portfolio-(20000|100000)-(low|medium|high)\.json$/.test(s)).sort();
 if(names.length!==6)throw Error('Require 6 paired evidence-portfolio outputs, found '+names.length);
 const result=build(names.map(n=>[n.replace('evidence-portfolio-','').replace('.json',''),JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))]));
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({scenarios:result.scenarios,missingMarks:result.missingMarks,distinctPairs:result.distinctPairs,topTenDatesMarks:result.topTenDatesMarks}));return result;
}
if(require.main===module)run(process.argv[2],process.argv[3]);module.exports={build,run};
