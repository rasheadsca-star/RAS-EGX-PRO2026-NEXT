'use strict';
// R9 verifies a COMPLETE, run-bound producer report. This does not attest
// provenance until the producer emits and commits the report with its history.
const {evaluation,hash}=require('./history-quarantine-policy.cjs');
const sortSymbols=(a,b)=>a.ticker<b.ticker?-1:a.ticker>b.ticker?1:0;
function verifyTruthBinding({assessment,report}){
 if(!assessment||!report||typeof report!=='object')throw new Error('R9_MISSING_REPORT');
 const a=evaluation(assessment);
 const acceptedSymbols=[...a.manifest.map(x=>x.ticker),...a.missingHistory];
 const rejects=[...a.rejected].map(([ticker,reason])=>({ticker,reason})).sort(sortSymbols);
 const dropped=assessment.dropped||[];
 const inputSymbols=assessment.inputSymbols;
 if(!Array.isArray(dropped)||!Array.isArray(inputSymbols)||!Number.isInteger(assessment.inputRows)
   ||assessment.inputRows!==inputSymbols.length)throw new Error('R9_INCOMPLETE_INPUT_PROVENANCE');
 const classified=[...acceptedSymbols,...rejects.map(x=>x.ticker),...dropped.map(x=>x.ticker)];
 const canonicalSet=x=>[...x].sort();
 if(classified.some(x=>typeof x!=='string'||!/^[A-Z0-9._-]+$/.test(x)||x==='.'||x==='..')
    ||new Set(classified).size!==classified.length
    ||new Set(inputSymbols).size!==inputSymbols.length
    ||hash(canonicalSet(classified))!==hash(canonicalSet(inputSymbols)))
   throw new Error('R9_CLASSIFICATION_CONSERVATION_FAILED');
 const sourceReady=assessment.sourceEligible===true;
 if(!sourceReady)throw new Error('R9_SOURCE_NOT_ELIGIBLE');
 if(report.schemaVersion!=='16.3.5-session-aware-price-truth-bound'
  ||report.runId!==a.runId||report.expectedSession!==a.expectedSession
  ||report.sourceEligible!==sourceReady||report.ready!==true||report.executionGrade!==true
  ||report.acceptedRows!==a.acceptedRows||report.rejectedRows!==rejects.length||report.droppedRows!==dropped.length
  ||report.inputRows!==assessment.inputRows||report.inputSymbolsSha256!==hash(canonicalSet(inputSymbols))
  ||report.acceptedRows+report.rejectedRows+report.droppedRows!==report.inputRows
  ||report.updatedHistoryFiles!==a.manifest.length
  ||report.manifestSha256!==a.manifestSha256
  ||!Array.isArray(report.missingHistoryFiles)
  ||hash([...report.missingHistoryFiles].sort())!==hash(a.missingHistory)
  ||!Array.isArray(report.rejectedFull)
  ||hash(report.rejectedFull.map(x=>({ticker:x.ticker,reason:x.reason})).sort(sortSymbols))!==hash(rejects)
  ||!Array.isArray(report.droppedFull)
  ||hash(report.droppedFull.map(x=>x.ticker).sort())!==hash(dropped.map(x=>x.ticker).sort()))
  throw new Error('R9_PRODUCER_REPORT_MISMATCH');
 return {runId:a.runId,acceptedRows:a.acceptedRows,writtenRows:a.manifest.length,
  missingHistory:a.missingHistory.length,classifiedRows:classified.length};
}
module.exports={verifyTruthBinding};
