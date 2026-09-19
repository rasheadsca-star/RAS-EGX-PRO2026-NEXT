'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'../../..');
function readHistory(ticker,limit=260){
  const symbol=String(ticker||'').trim().toUpperCase();
  if(!/^[A-Z0-9._-]{2,12}$/.test(symbol))throw new Error('INVALID_TICKER');
  const n=Math.max(1,Math.min(260,Number(limit)||260));
  const file=path.join(ROOT,'data','history',symbol+'.json');
  if(!fs.existsSync(file))throw new Error('HISTORY_NOT_FOUND');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  const sessions=Array.isArray(doc.sessions)?doc.sessions:[];
  const bars=sessions
    .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'').slice(0,10))&&Number(x.close)>0)
    .slice(-n)
    .map(x=>({date:String(x.date).slice(0,10),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Math.max(0,Number(x.volume)||0)}));
  return{ok:true,ticker:symbol,bars,source:'LOCAL_VALIDATION_APPROVED_HISTORY'};
}
module.exports={readHistory};
