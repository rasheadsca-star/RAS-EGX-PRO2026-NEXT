'use strict';
// Replay predictions are derived decisions, not canonical OHLCV market candles.
// Do not promote currentPrice to canonical daily close.
function auditReplayCoverage({tickers,snapshots}){
 if(!Array.isArray(tickers)||!Array.isArray(snapshots))throw Error('REPLAY_AUDIT_ARGS_REQUIRED');
 const result=Object.fromEntries(tickers.map(t=>[t,{ticker:t,derivedPredictionSessions:[],canonicalOHLCVEligible:false}]));
 for(const snapshot of snapshots){
  if(snapshot.schemaVersion!=='astra-replay-snapshot/v1'||typeof snapshot.session!=='string')
   throw Error('UNKNOWN_REPLAY_SCHEMA');
  for(const prediction of snapshot.predictions||[]){
   const row=result[prediction.ticker];
   if(!row)continue;
   if(row.derivedPredictionSessions.includes(snapshot.session))throw Error('DUPLICATE_REPLAY_SESSION');
   row.derivedPredictionSessions.push(snapshot.session);
  }
 }
 return Object.values(result).map(r=>({...r,derivedPredictionSessions:r.derivedPredictionSessions.sort(),
  classification:r.derivedPredictionSessions.length?'DERIVED_RESEARCH_ONLY_NO_CANONICAL_IMPORT':'NOT_PRESENT_IN_REPLAY_PREDICTIONS'}));
}
module.exports={auditReplayCoverage};
