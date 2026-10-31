'use strict';
const fs=require('node:fs'),path=require('node:path');
const input=process.argv[2]||'research-artifacts/unique-price-gaps.json';
const output=process.argv[3]||'research-artifacts/legacy-price-candidates-quarantine.json';
const request=JSON.parse(fs.readFileSync(input,'utf8'));
const legacy=JSON.parse(fs.readFileSync('data/history.json','utf8')).sessionsBySymbol||{};
const canonicalRoot='data/history',candidates=[];
for(const gap of request.pairs||[]){
 const canonicalFile=path.join(canonicalRoot,gap.ticker+'.json');
 const canonical=fs.existsSync(canonicalFile)?JSON.parse(fs.readFileSync(canonicalFile,'utf8')):{};
 if((canonical.sessions||[]).some(x=>x.date===gap.date))continue;
 for(const bar of legacy[gap.ticker]||[])if(bar.date===gap.date){
  const close=Number(bar.close),status=Number.isFinite(close)&&close>0?'QUARANTINE_SOURCE_NOT_VERIFIED':'INVALID_PRICE';
  candidates.push({ticker:gap.ticker,date:gap.date,close:Number.isFinite(close)?close:null,sourceQuality:bar.sourceQuality||null,status,sourceFile:'data/history.json',automaticMergeAllowed:false});
 }
}
fs.mkdirSync(path.dirname(output),{recursive:true});
const result={status:'QUARANTINE_ONLY',automaticMergeAllowed:false,source:'data/history.json',candidatesCount:candidates.length,candidates,warning:'Legacy snapshot/commit-date records are not session-verifiable OHLC. No price is copied to canonical data.'};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({candidatesCount:candidates.length,autoMerged:0}));
