'use strict';
const fs=require('node:fs'),path=require('node:path');
const ticker=x=>String(x||'').trim().toUpperCase().replace(/\.CA$/,'');
const day=x=>String(x||'').slice(0,10);
const validNumber=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const observed=x=>['open','high','low','close','volume'].every(k=>validNumber(x?.[k]))
 && Number(x.open)>0&&Number(x.low)>0&&Number(x.high)>=Math.max(Number(x.open),Number(x.close))
 && Number(x.low)<=Math.min(Number(x.open),Number(x.close))&&Number(x.volume)>=0;
const equal=(a,b)=>Math.abs(Number(a)-Number(b))<=0.000001*Math.max(1,Math.abs(Number(a)));
function readHistory(dir,t){
 try{return JSON.parse(fs.readFileSync(path.join(dir,t+'.json'),'utf8'));}catch{return null;}
}
function partitionPersistable(rows,historyDir){
 const accepted=[],rejected=[];
 for(const row of rows){
  const t=ticker(row.ticker),h=readHistory(historyDir,t);
  const identityOk=h?.symbolVerified===true&&ticker(h.ticker)===t
    &&(!h.isin||/^EG[A-Z0-9]{9,}$/i.test(String(h.isin)));
  const sourceOk=day(row.sourceSessionDate)===day(row.date)&&observed(row)
    &&!row.warnings?.includes('partial_ohlc_reconstructed_from_close_or_previous_close');
  if(!identityOk||!sourceOk){
   rejected.push({...row,reason:!h?'HISTORY_FILE_MISSING':!identityOk?'SYMBOL_IDENTITY_NOT_VERIFIED':'OBSERVED_SESSION_OHLCV_INVALID'});
   continue;
  }
  accepted.push(row);
 }
 return {accepted,rejected};
}
function verifyPersisted(rows,historyDir){
 const missing=[];
 for(const row of rows){
  const h=readHistory(historyDir,ticker(row.ticker));
  const bar=h?.sessions?.find(s=>day(s.date||s.sessionDate)===day(row.date));
  if(!h?.symbolVerified||!bar||!observed(bar)
    ||day(bar.sourceSessionDate)!==day(row.date)
    ||!['open','high','low','close','volume'].every(k=>equal(row[k],bar[k])))
   missing.push(ticker(row.ticker));
 }
 if(missing.length)throw Error('ACCEPTED_OHLCV_NOT_PERSISTED_'+missing.join(','));
 return rows.length;
}
module.exports={partitionPersistable,verifyPersisted};
