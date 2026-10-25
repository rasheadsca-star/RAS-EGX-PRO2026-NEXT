'use strict';
// Adapter from producer's actual accepted/rejected/dropped arrays into the
// complete v16.3.5 report contract. Never invent a missing-history ticker.
const fs=require('node:fs'),path=require('node:path');
const {evaluation,hash}=require('./history-quarantine-policy.cjs');
const {verifyTruthBinding}=require('./history-r9-report-binding.cjs');
const sym=x=>String(x?.symbol||x?.ticker||x?.code||'').trim().toUpperCase().replace(/\.CA$/,'');
function prepare({root,expectedSession,runId,sourceEligible,marketRows,acceptedRows,rejected,dropped}){
 if(!sourceEligible)throw new Error('GUARD_SOURCE_INELIGIBLE');
 const inputSymbols=marketRows.map(sym);
 const invalid=inputSymbols.filter(t=>!/^[A-Z0-9._-]+$/.test(t)||t==='.'||t==='..');
 if(invalid.length||new Set(inputSymbols).size!==inputSymbols.length)
  throw new Error('GUARD_INVALID_OR_DUPLICATE_INPUT_SYMBOLS');
 const accepted=[],missingHistory=[];
 for(const row of acceptedRows){
  if(fs.existsSync(path.join(root,'data/history',row.ticker+'.json')))accepted.push(row);
  else missingHistory.push(row.ticker);
 }
 const rejectedFull=rejected.map(x=>({ticker:x.ticker,reason:x.reason}));
 const droppedFull=dropped.map(x=>({ticker:x.ticker,reason:x.reason}));
 const assessment={runId,expectedSession,sourceEligible:true,acceptedRows:acceptedRows.length,accepted,
  missingHistory,rejected:rejectedFull,dropped:droppedFull,inputRows:marketRows.length,inputSymbols};
 const a=evaluation(assessment);
 const reportFields={schemaVersion:'16.3.5-session-aware-price-truth-bound',runId,expectedSession,
  sourceEligible:true,ready:true,executionGrade:true,acceptedRows:acceptedRows.length,
  updatedHistoryFiles:accepted.length,missingHistoryFiles:missingHistory,
  manifestSha256:a.manifestSha256,rejectedRows:rejectedFull.length,droppedRows:droppedFull.length,
  rejectedFull,droppedFull,inputRows:marketRows.length,
  inputSymbolsSha256:hash([...inputSymbols].sort())};
 verifyTruthBinding({assessment,report:reportFields});
 return {assessment,reportFields};
}
module.exports={prepare};
