'use strict';

const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');
const {pointInTimeIndicators}=require('./indicators.cjs');

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);
  for(const child of Object.values(value))deepFreeze(child);
  return value;
}
function validateRow(row,sessionDate){
  const ticker=String(row?.ticker||'UNKNOWN');
  const snapshot={snapshotId:row?.snapshotId||`TA-${ticker}-${sessionDate}`,sessionDate,rows:[row]};
  const check=validateCanonicalSnapshot(snapshot,sessionDate);
  if(check.errors.length||check.temporal.length||check.quarantined.length){
    throw Object.assign(new Error(`Technical-analysis input is not valid point-in-time canonical data for ${ticker}`),{
      code:'TECHNICAL_ANALYSIS_INPUT_INVALID',
      details:{errors:check.errors,temporal:check.temporal,quarantined:check.quarantined}
    });
  }
}
function buildTechnicalEvidence(row,history=[],sessionDate=String(row?.sessionDate||'')){
  validateRow(row,sessionDate);
  const indicators=pointInTimeIndicators(row,history,sessionDate);
  const ticker=String(row?.ticker||'');
  return deepFreeze({
    ticker,
    securityId:row?.securityId||ticker,
    sourceRef:row?.snapshotId||ticker,
    asOfSessionDate:sessionDate,
    indicators,
    momentum:{
      return1Pct:indicators.return1Pct,
      return5Pct:indicators.return5Pct,
      return20Pct:indicators.return20Pct
    },
    trend:{
      aboveSma20:indicators.aboveSma20,
      aboveSma50:indicators.aboveSma50
    },
    volatility:{annualized20Pct:indicators.volatility20AnnualizedPct},
    participation:{relativeVolume20:indicators.relativeVolume20}
  });
}

module.exports=Object.freeze({buildTechnicalEvidence});
