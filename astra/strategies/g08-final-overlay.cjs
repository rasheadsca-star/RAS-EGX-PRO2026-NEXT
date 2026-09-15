'use strict';
const strict=require('./g08-strict-overlay.cjs');
const core=require('./g08-internal-strategies.cjs');
const SPECS=strict.SPECS;

function semanticOutput(out){
  const copy={...out};
  delete copy.strategyExecutionId;
  delete copy.executionHash;
  return copy;
}
function crossSectionIdentity(input){
  if(!input||(!Array.isArray(input.trainingSessions)&&!Array.isArray(input.currentRows)))return null;
  return core.hash({
    trainingSessions:Array.isArray(input.trainingSessions)?input.trainingSessions:[],
    currentRows:Array.isArray(input.currentRows)?input.currentRows:[]
  });
}
function executeStrategy(id,input={},config={}){
  const out=strict.executeStrategy(id,input,config);
  if(!['V16_TWO_STAGE_TOP_GAINER','V19_TOP10_PROBABILITY_INV_VOL_3'].includes(id))return out;
  const identity={
    strategyId:out.strategyId,
    strategyVersion:out.strategyVersion,
    snapshotId:input?.snapshot?.snapshotId||null,
    sessionDate:input?.snapshot?.sessionDate||null,
    ticker:input?.snapshot?.ticker||null,
    canonicalHistoryHash:core.hash((input?.history||[]).map(r=>({
      sessionDate:r.sessionDate||r.date,
      close:r.close??r.ohlc?.close,
      volume:r.volume,
      turnover:r.turnover,
      validationStatus:r.validationStatus,
      migrationValidationStatus:r.migrationValidationStatus
    }))),
    crossSectionHash:crossSectionIdentity(input),
    config:config||{},
    output:semanticOutput(out)
  };
  const executionHash=core.hash(identity);
  return{...out,strategyExecutionId:`G08-${executionHash.slice(0,24)}`,executionHash};
}
module.exports={SPECS,executeStrategy,crossSectionIdentity};
