'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluation,hash}=require('../../scripts/stable/history-quarantine-policy.cjs');
const {verifyTruthBinding}=require('../../scripts/stable/history-r9-report-binding.cjs');
const row={ticker:'MIPH',date:'2026-10-25',source:'v16_session_aware_price_truth',close:683.5};
function fixture(){
 const assessment={runId:'run-25-001',expectedSession:'2026-10-25',sourceEligible:true,acceptedRows:2,
 accepted:[row],missingHistory:['BONY'],rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]};
 const a=evaluation(assessment);
 const report={schemaVersion:'16.3.5-session-aware-price-truth-bound',runId:a.runId,expectedSession:a.expectedSession,
 acceptedRows:2,updatedHistoryFiles:1,missingHistoryFiles:['BONY'],manifestSha256:a.manifestSha256,
 rejectedFull:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]};
 return {assessment,report};
}
test('R9 complete matching producer report permits binding',()=>{
 const f=fixture();assert.equal(verifyTruthBinding(f).writtenRows,1);
});
test('R9 sample-only current producer report cannot impersonate a complete report',()=>{
 const f=fixture();delete f.report.rejectedFull;f.report.sampleRejected=[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}];
 assert.throws(()=>verifyTruthBinding(f),/R9_PRODUCER_REPORT_MISMATCH/);
});
test('R9 rejects forged run, counts, manifest, missing history and rejected classifications',()=>{
 for(const patch of [{runId:'old'},{acceptedRows:3},{updatedHistoryFiles:2},{manifestSha256:'0'.repeat(64)},
  {missingHistoryFiles:['KRDI']},{rejectedFull:[{ticker:'FAIT',reason:'OTHER'}]},
  {schemaVersion:'16.3.4-session-aware-price-truth'}]){
  const f=fixture();Object.assign(f.report,patch);
  assert.throws(()=>verifyTruthBinding(f),/R9_PRODUCER_REPORT_MISMATCH/);
 }
});
