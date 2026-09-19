'use strict';

const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');
const {pointInTimeIndicators}=require('./indicators.cjs');
const {buildTechnicalEvidence}=require('./technical-analysis.cjs');

function finite(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function round(value,digits=6){
  const n=finite(value);
  return n===null?null:Number(n.toFixed(digits));
}
function validateRow(row,sessionDate){
  const ticker=String(row?.ticker||'UNKNOWN');
  const snapshot={snapshotId:row?.snapshotId||`SR-${ticker}-${sessionDate}`,sessionDate,rows:[row]};
  const check=validateCanonicalSnapshot(snapshot,sessionDate);
  if(check.errors.length||check.temporal.length||check.quarantined.length){
    throw Object.assign(new Error(`Support/resistance input is not valid point-in-time canonical data for ${ticker}`),{
      code:'SUPPORT_RESISTANCE_INPUT_INVALID',
      details:{errors:check.errors,temporal:check.temporal,quarantined:check.quarantined}
    });
  }
}
function buildSupportResistanceEvidence(row,history=[],sessionDate=String(row?.sessionDate||'')){
  validateRow(row,sessionDate);
  const source=row?.supportResistanceInputs||{};
  const technical=buildTechnicalEvidence(row,history,sessionDate);
  const indicators=pointInTimeIndicators(row,history,sessionDate);
  const close=finite(row?.ohlc?.close??row?.close);
  const support=finite(source.support);
  const resistance=finite(source.resistance);
  const asOfSessionDate=String(source.asOfSessionDate||source.sessionDate||sessionDate);
  return Object.freeze({
    ticker:String(row?.ticker||''),
    securityId:row?.securityId||String(row?.ticker||''),
    sourceRef:technical.sourceRef,
    asOfSessionDate,
    support,
    resistance,
    supportDistancePct:close>0&&support!==null?round((close/support-1)*100):null,
    resistanceUpsidePct:close>0&&resistance!==null?round((resistance/close-1)*100):null,
    atr14:finite(indicators.atr14),
    availability:Object.freeze({
      support:support!==null,
      resistance:resistance!==null,
      both:support!==null&&resistance!==null
    }),
    provenance:Object.freeze({
      source:'CanonicalMarketSnapshot.supportResistanceInputs',
      marketSnapshotId:row?.snapshotId||null,
      technicalEvidenceRef:technical.sourceRef
    })
  });
}

module.exports=Object.freeze({buildSupportResistanceEvidence});
