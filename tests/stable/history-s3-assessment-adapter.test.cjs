'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {derive}=require('../../scripts/stable/history-s3-assessment-adapter.cjs');
const SOURCE='v16_session_aware_price_truth',session='2026-10-25';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-s3-'));
 fs.mkdirSync(path.join(root,'data/history'),{recursive:true});
 fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});
 const row={ticker:'AALR',date:session,sourceSessionDate:session,source:SOURCE,close:10};
 fs.writeFileSync(path.join(root,'data/history/AALR.json'),JSON.stringify({sessions:[row]}));
 const report={schemaVersion:'16.3.4-session-aware-price-truth',generatedAt:new Date().toISOString(),
  expectedSession:session,ready:true,executionGrade:true,source:{preciseSource:true,realFetch:true,inputRows:3},
  acceptedRows:2,rejectedRows:1,droppedRows:0,updatedHistoryFiles:1,missingHistoryFiles:['BONY'],
  sampleRejected:[{ticker:'REJT',reason:'INVALID_SOURCE'}],sampleDropped:[]};
 const save=()=>fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 save();
 const run=()=>derive({root,runId:'TEST-1',startedAt:'2020-01-01T00:00:00.000Z'});
 return {root,report,save,run};
}
test('valid 2-row archive below 200 does not qualify for handoff',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(path.join(f.root,'data/history/AALR.json'));
  const r=f.run();
  assert.equal(r.summary.acceptedRows,2);
  assert.equal(r.summary.handoffEligible,false);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'data/history/AALR.json')),before);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('truncated rejection sample fails closed',()=>{
 const f=fixture();try{f.report.sampleRejected=[];f.save();assert.throws(f.run,/INCOMPLETE_REJECTION_EVIDENCE/)}
 finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('rejected producer candle fails closed',()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.root,'data/history/REJT.json'),JSON.stringify({sessions:[{ticker:'REJT',date:session,sourceSessionDate:session,source:SOURCE,close:1}]}));
  assert.throws(f.run,/REJECTED_CANDLE_STILL_PUBLISHED/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('missing history cannot be silently counted as written',()=>{
 const f=fixture();try{
  f.report.updatedHistoryFiles=2;f.save();assert.throws(f.run,/ACCEPTED_COUNT_MISMATCH/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
