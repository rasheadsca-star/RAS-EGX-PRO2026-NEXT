'use strict';
const marketCalendar=require('../core/market-calendar.cjs');
const symbolMaster=require('../core/symbol-master.cjs');

const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const isoDate=v=>{const m=String(v||'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null};
const badStatus=v=>/invalid|conflict|failed|unresolved|quarantined/i.test(String(v||''));
function validHistoryRow(row){
  const date=isoDate(row?.date||row?.sessionDate),open=finite(row?.open),high=finite(row?.high),low=finite(row?.low),close=finite(row?.close);
  const volume=Object.prototype.hasOwnProperty.call(row||{},'volume')?finite(row.volume):null;
  const errors=[];
  if(!date)errors.push('SESSION_DATE_INVALID');
  if(!(open>0&&high>0&&low>0&&close>0))errors.push('OHLC_NON_POSITIVE_OR_MISSING');
  if(high!==null&&open!==null&&close!==null&&high<Math.max(open,close))errors.push('HIGH_BELOW_OPEN_CLOSE');
  if(low!==null&&open!==null&&close!==null&&low>Math.min(open,close))errors.push('LOW_ABOVE_OPEN_CLOSE');
  if(volume===null)errors.push('VOLUME_MISSING_OR_PARSE_FAILURE');else if(volume<0)errors.push('VOLUME_NEGATIVE');
  if(badStatus(row?.validationStatus))errors.push('SOURCE_VALIDATION_REJECTED');
  return{ok:errors.length===0,date,open,high,low,close,volume,errors};
}
function parseHistory(doc){
  const src=Array.isArray(doc?.sessions)?doc.sessions:Array.isArray(doc)?doc:[];
  const validated=[],byDate=new Map(),duplicates=[];
  for(const raw of src){
    const v=validHistoryRow(raw);
    if(v.ok)validated.push({...v,raw});
    const d=v.date;if(!d)continue;
    if(!byDate.has(d))byDate.set(d,[]);
    byDate.get(d).push({v,raw});
  }
  validated.sort((a,b)=>a.date.localeCompare(b.date));
  for(const [date,rows] of byDate){
    if(rows.length<2)continue;
    const sigs=rows.map(x=>JSON.stringify([x.v.open,x.v.high,x.v.low,x.v.close,x.v.volume]));
    duplicates.push({date,count:rows.length,type:new Set(sigs).size===1?'EXACT_DUPLICATE':'CONFLICTING_DUPLICATE'});
  }
  return{validated,duplicates};
}
module.exports=Object.freeze({
  finite,isoDate,badStatus,validHistoryRow,parseHistory,
  ...marketCalendar,
  ...symbolMaster
});
