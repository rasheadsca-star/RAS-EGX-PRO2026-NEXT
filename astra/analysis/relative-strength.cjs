'use strict';

const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');
const {pointInTimeIndicators}=require('./indicators.cjs');

function finite(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function validateRow(row,sessionDate){
  const ticker=String(row?.ticker||'UNKNOWN');
  const snapshot={snapshotId:row?.snapshotId||`RS-${ticker}-${sessionDate}`,sessionDate,rows:[row]};
  const check=validateCanonicalSnapshot(snapshot,sessionDate);
  if(check.errors.length||check.temporal.length||check.quarantined.length){
    throw Object.assign(new Error(`Relative-strength input is not valid point-in-time canonical data for ${ticker}`),{
      code:'RELATIVE_STRENGTH_INPUT_INVALID',
      details:{errors:check.errors,temporal:check.temporal,quarantined:check.quarantined}
    });
  }
}
function rowValue(row,history,sessionDate){
  const indicator=pointInTimeIndicators(row,history,sessionDate);
  return finite(indicator.relativeStrength20);
}
function buildRelativeStrengthEvidence(row,history=[],sessionDate=String(row?.sessionDate||''),universeRows=[row]){
  validateRow(row,sessionDate);
  const ticker=String(row?.ticker||'');
  const value=rowValue(row,history,sessionDate);
  const comparable=[];
  for(const candidate of Array.isArray(universeRows)?universeRows:[]){
    if(String(candidate?.sessionDate||'')!==sessionDate)continue;
    const candidateTicker=String(candidate?.ticker||'');
    if(!candidateTicker)continue;
    const candidateValue=finite(candidate?.technicalInputs?.relativeStrength20);
    if(candidateValue!==null)comparable.push({ticker:candidateTicker,value:candidateValue});
  }
  if(value!==null&&!comparable.some(x=>x.ticker===ticker))comparable.push({ticker,value});
  comparable.sort((a,b)=>(b.value-a.value)||a.ticker.localeCompare(b.ticker));
  const rank=value===null?null:comparable.findIndex(x=>x.ticker===ticker)+1;
  return Object.freeze({
    ticker,
    securityId:row?.securityId||ticker,
    sourceRef:row?.snapshotId||ticker,
    asOfSessionDate:sessionDate,
    relativeStrength20:value,
    crossSection:Object.freeze({
      comparableCount:comparable.length,
      rank:rank>0?rank:null,
      ordering:'relativeStrength20 DESC, ticker ASC'
    }),
    provenance:Object.freeze({
      source:'IndicatorSnapshot.relativeStrength20',
      marketSnapshotId:row?.snapshotId||null
    })
  });
}

module.exports=Object.freeze({buildRelativeStrengthEvidence});
