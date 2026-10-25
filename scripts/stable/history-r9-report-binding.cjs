'use strict';
// R9 publication binding: independent check of a COMPLETE producer report.
// The existing v15-price-truth.json has only samples, so it MUST NOT pass this gate.
const {evaluation,hash}=require('./history-quarantine-policy.cjs');
function verifyTruthBinding({assessment,report}){
 if(!assessment||!report||typeof report!=='object')throw new Error('R9_MISSING_REPORT');
 const a=evaluation(assessment);
 if(report.schemaVersion!=='16.3.5-session-aware-price-truth-bound'
  ||report.runId!==a.runId||report.expectedSession!==a.expectedSession
  ||report.acceptedRows!==a.acceptedRows
  ||report.updatedHistoryFiles!==a.manifest.length
  ||report.manifestSha256!==a.manifestSha256
  ||!Array.isArray(report.missingHistoryFiles)
  ||hash([...report.missingHistoryFiles].sort())!==hash(a.missingHistory)
  ||!Array.isArray(report.rejectedFull)
  ||hash(report.rejectedFull.map(x=>({ticker:x.ticker,reason:x.reason})).sort((x,y)=>x.ticker<y.ticker?-1:x.ticker>y.ticker?1:0))
     !==hash([...a.rejected].map(([ticker,reason])=>({ticker,reason})).sort((x,y)=>x.ticker<y.ticker?-1:x.ticker>y.ticker?1:0)))
  throw new Error('R9_PRODUCER_REPORT_MISMATCH');
 return {runId:a.runId,acceptedRows:a.acceptedRows,writtenRows:a.manifest.length,missingHistory:a.missingHistory.length};
}
module.exports={verifyTruthBinding};
