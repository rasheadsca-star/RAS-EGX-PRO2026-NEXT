'use strict';
const fs=require('fs'),path=require('path');
const file=process.argv[2]||'research-artifacts/unique-price-gaps.json';
const target=process.argv[3]||'research-artifacts/gap-resolution-matrix.json';
const data=JSON.parse(fs.readFileSync(file,'utf8'));const rows=[];
for(const g of data.pairs||[]){
 const p=path.join('data/history',g.ticker+'.json');const src=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};
 const bars=(src.sessions||[]).sort((a,b)=>a.date.localeCompare(b.date));
 const prior=bars.filter(x=>x.date<g.date).at(-1),following=bars.find(x=>x.date>g.date);
 rows.push({ticker:g.ticker,date:g.date,previousSession:prior?.date||null,previousClose:prior?.close??null,nextSession:following?.date||null,nextClose:following?.close??null,
  status:'UNVERIFIED_INSTRUMENT_SESSION',verifiedPrice:null,autoFillAllowed:false,requiredEvidence:'Dated EGX security trade / independently corroborated daily OHLCV; check suspension and zero-trade session'});
}
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify({status:'NO_VERIFIED_PRICE_IMPORTS',pairs:rows,missing:rows.length,approved:0,note:'Surrounding closes are CONTEXT ONLY, not valid substitutes for a missing session.'},null,2)+'\n');
console.log('Gap resolution matrix: '+rows.length+' unresolved, zero prices invented');
