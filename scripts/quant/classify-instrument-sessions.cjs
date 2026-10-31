'use strict';
const fs=require('node:fs'),path=require('node:path');
const input=process.argv[2]||'research-artifacts/unique-price-gaps.json';
const output=process.argv[3]||'research-artifacts/instrument-session-classification.json';
const req=JSON.parse(fs.readFileSync(input,'utf8'));
const calendar=JSON.parse(fs.readFileSync('data/quant/egx-verified-calendar-2026.json','utf8'));
const closed=new Set(calendar.verifiedClosures.map(x=>x.date));
const officialOpen=new Set(calendar.verifiedOpenSessions.map(x=>x.date));
const rows=[];
for(const g of req.pairs||[]){
 const file=path.join('data/history',g.ticker+'.json');
 const h=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 const exact=(h.sessions||[]).filter(x=>x.date===g.date);
 const verified=exact.find(x=>Number(x.close)>0&&x.officialVerified===true&&Array.isArray(x.verifiedBy)&&x.verifiedBy.length>0);
 const explicitlyNoTrade=exact.find(x=>Number(x.volume)===0&&x.sessionNoTradeVerified===true&&typeof x.sessionEvidenceUrl==='string'&&/^https:\/\//.test(x.sessionEvidenceUrl));
 let classification='UNRESOLVED_INSTRUMENT_SESSION';
 if(closed.has(g.date))classification='VERIFIED_EXCHANGE_CLOSED';
 else if(verified)classification='VERIFIED_INSTRUMENT_PRICE';
 else if(explicitlyNoTrade)classification='VERIFIED_NO_TRADE';
 rows.push({ticker:g.ticker,date:g.date,classification,marketSessionConfirmed:officialOpen.has(g.date),priorPriceCannotProveNoTrade:true,
  price:verified?Number(verified.close):null,verifiedNoTradeEvidence:explicitlyNoTrade?.sessionEvidenceUrl||null,
  evidenceNeeded:classification==='UNRESOLVED_INSTRUMENT_SESSION'?'Dated EGX instrument-level daily trading volume / explicit no-trade status and corroborated OHLCV':'none'});
}
const counts=rows.reduce((a,x)=>(a[x.classification]=(a[x.classification]||0)+1,a),{});
const result={schemaVersion:'1.0',status:'RESEARCH_ONLY',autoFillAllowed:false,counts,rows,
note:'No-trade status requires explicit instrument-and-date evidence; an absent candle is never proof of zero volume.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({total:rows.length,counts}));
