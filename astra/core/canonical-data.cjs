'use strict';

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

function migrationBad(v){return['INVALID','UNRESOLVED','QUARANTINED'].includes(String(v||'').toUpperCase())}
function after(a,b){return DATE_RE.test(String(a||''))&&DATE_RE.test(String(b||''))&&String(a)>String(b)}

function validateCanonicalSnapshot(snapshot,sessionDate){
  const errors=[];const temporal=[];const quarantined=[];
  const session=String(sessionDate||'');
  if(!snapshot||!snapshot.snapshotId||snapshot.sessionDate!==session||!Array.isArray(snapshot.rows)||!snapshot.rows.length){
    errors.push('CANONICAL_SNAPSHOT_INVALID');
  }
  const rows=Array.isArray(snapshot?.rows)?snapshot.rows:[];
  for(const row of rows){
    const ticker=String(row?.ticker||'');
    if(!ticker||row.sessionDate!==session)errors.push(`ROW_SESSION_OR_TICKER_INVALID:${ticker||'UNKNOWN'}`);
    if(row.validationStatus!=='VALID'||migrationBad(row.migrationValidationStatus)){quarantined.push(ticker||'UNKNOWN');continue}
    const srDate=String(row?.supportResistanceInputs?.asOfSessionDate||row?.supportResistanceInputs?.sessionDate||'');
    if(srDate&&after(srDate,session))temporal.push(`${ticker}:SUPPORT_RESISTANCE:${srDate}`);
    const regimeDate=String(row?.technicalInputs?.regimeSessionDate||'');
    if(regimeDate&&after(regimeDate,session))temporal.push(`${ticker}:REGIME:${regimeDate}`);
  }
  return{errors,temporal,quarantined,rows,universeCount:rows.length};
}

module.exports=Object.freeze({validateCanonicalSnapshot});
