'use strict';

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

function asDate(row){return String(row?.sessionDate||row?.date||'').slice(0,10)}
function after(a,b){return DATE_RE.test(String(a||''))&&DATE_RE.test(String(b||''))&&String(a)>String(b)}
function migrationBad(v){return['INVALID','UNRESOLVED','QUARANTINED'].includes(String(v||'').toUpperCase())}

function validateHistoricalStore(historyByTicker,sessionDate){
  const temporal=[];const quarantined=[];const session=String(sessionDate||'');
  for(const [ticker,history] of Object.entries(historyByTicker||{}))for(const row of history||[]){
    const d=asDate(row);
    if(d&&after(d,session))temporal.push(`${ticker}:HISTORY:${d}`);
    if(row.validationStatus!=='VALID'||migrationBad(row.migrationValidationStatus))quarantined.push(`${ticker}:HISTORY`);
  }
  return{temporal,quarantined};
}

function validatedHistoryRows(historyByTicker,sessionDate){
  const check=validateHistoricalStore(historyByTicker,sessionDate);
  if(check.temporal.length||check.quarantined.length)return{ok:false,...check};
  const rows=[];
  for(const [ticker,history] of Object.entries(historyByTicker||{}))for(const row of history||[])rows.push({ticker,...row});
  return{ok:true,rows,temporal:[],quarantined:[]};
}

module.exports=Object.freeze({validateHistoricalStore,validatedHistoryRows});
