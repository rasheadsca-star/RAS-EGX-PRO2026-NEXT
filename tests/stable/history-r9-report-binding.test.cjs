'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluation,hash}=require('../../scripts/stable/history-quarantine-policy.cjs');
const {verifyTruthBinding}=require('../../scripts/stable/history-r9-report-binding.cjs');
const row={ticker:'MIPH',date:'2026-10-25',source:'v16_session_aware_price_truth',close:683.5};
function fixture(){
 const assessment={runId:'run-25-001',expectedSession:'2026-10-25',sourceEligible:true,acceptedRows:2,
 accepted:[row],missingHistory:['BONY'],rejected:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}],
 inputRows:3,inputSymbols:['MIPH','BONY','FAIT'],dropped:[]};
 const a=evaluation(assessment);
 const report={schemaVersion:'16.3.5-session-aware-price-truth-bound',runId:a.runId,expectedSession:a.expectedSession,
 acceptedRows:2,updatedHistoryFiles:1,missingHistoryFiles:['BONY'],manifestSha256:a.manifestSha256,
 rejectedFull:[{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}],droppedFull:[],
 sourceEligible:true,ready:true,executionGrade:true,inputRows:3,
 inputSymbolsSha256:hash(['BONY','FAIT','MIPH']),rejectedRows:1,droppedRows:0};
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

test('R25 refuses false ready and executionGrade',()=>{
 for(const patch of [{ready:false},{executionGrade:false},{sourceEligible:false}]){
  const f=fixture();Object.assign(f.report,patch);
  assert.throws(()=>verifyTruthBinding(f),/R9_PRODUCER_REPORT_MISMATCH/);
 }
});
test('R26 rejects disappearing classifications and invented input symbols',()=>{
 const f=fixture();f.assessment.inputSymbols=['MIPH','BONY','ARCC'];
 assert.throws(()=>verifyTruthBinding(f),/R9_CLASSIFICATION_CONSERVATION_FAILED/);
 const g=fixture();g.assessment.rejected=[];
 assert.throws(()=>verifyTruthBinding(g),/R9_CLASSIFICATION_CONSERVATION_FAILED/);
});
test('R27 accepts multiple missing and rejected symbols irrespective of order',()=>{
 const f=fixture();
 f.assessment.missingHistory=['TANM','BONY'];
 f.assessment.rejected=[{ticker:'SEIG',reason:'SESSION_STALE'},{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}];
 f.assessment.acceptedRows=3;f.assessment.inputRows=5;f.assessment.inputSymbols=['SEIG','MIPH','TANM','FAIT','BONY'];
 const a=evaluation(f.assessment);
 Object.assign(f.report,{acceptedRows:3,updatedHistoryFiles:1,missingHistoryFiles:['TANM','BONY'],
  manifestSha256:a.manifestSha256,rejectedRows:2,inputRows:5,
  inputSymbolsSha256:hash(['BONY','FAIT','MIPH','SEIG','TANM']),
  rejectedFull:[{ticker:'SEIG',reason:'SESSION_STALE'},{ticker:'FAIT',reason:'REPORTED_CHANGE_MISMATCH'}]});
 assert.equal(verifyTruthBinding(f).classifiedRows,5);
});

test('R28 rejects ineligible assessment even with otherwise sound report',()=>{
 const f=fixture();f.assessment.sourceEligible=false;
 assert.throws(()=>verifyTruthBinding(f),/R9_SOURCE_NOT_ELIGIBLE/);
});
test('R28 pins all reported row counts and input digest independently',()=>{
 const changes=[{rejectedRows:2},{droppedRows:1},{inputRows:4},
  {inputSymbolsSha256:'0'.repeat(64)}];
 for(const change of changes){const f=fixture();Object.assign(f.report,change);
  assert.throws(()=>verifyTruthBinding(f),/R9_PRODUCER_REPORT_MISMATCH/);
 }
});
test('R28 requires conservation of accepted rejected dropped equals input',()=>{
 const f=fixture();f.report.inputRows=4;f.assessment.inputRows=4;
 f.assessment.inputSymbols.push('ARCC');f.report.inputSymbolsSha256=hash(['ARCC','BONY','FAIT','MIPH']);
 assert.throws(()=>verifyTruthBinding(f),/R9_CLASSIFICATION_CONSERVATION_FAILED/);
});
test('R28 checks dropped records and noncanonical order with multiple dropped symbols',()=>{
 const f=fixture();
 f.assessment.dropped=[{ticker:'ZEUS',reason:'STALE'},{ticker:'ARCC',reason:'NO_PRICE'}];
 f.assessment.inputSymbols=['ZEUS','MIPH','ARCC','BONY','FAIT'];
 f.assessment.inputRows=5;
 Object.assign(f.report,{droppedRows:2,inputRows:5,inputSymbolsSha256:hash(['ARCC','BONY','FAIT','MIPH','ZEUS']),
  droppedFull:[{ticker:'ARCC',reason:'NO_PRICE'},{ticker:'ZEUS',reason:'STALE'}]});
 assert.equal(verifyTruthBinding(f).classifiedRows,5);
 f.report.droppedFull=[{ticker:'ARCC',reason:'NO_PRICE'},{ticker:'KABO',reason:'STALE'}];
 assert.throws(()=>verifyTruthBinding(f),/R9_PRODUCER_REPORT_MISMATCH/);
});
test('R28 rejects malformed dropped ticker rather than trusting coercion',()=>{
 const f=fixture();f.assessment.dropped=[{ticker:'../outside',reason:'STALE'}];
 f.assessment.inputSymbols.push('../outside');f.assessment.inputRows=4;
 assert.throws(()=>verifyTruthBinding(f),/R9_CLASSIFICATION_CONSERVATION_FAILED/);
});
