'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execute}=require('../../scripts/stable/history-s3-shadow-quarantine.cjs');
const SOURCE='v16_session_aware_price_truth',session='2026-10-25';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-s3-shadow-')),dir=path.join(root,'data/history');
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});
 const row=t=>({ticker:t,date:session,sourceSessionDate:session,source:SOURCE,close:10,fetchedAt:'2026-10-25T08:00:00Z'});
 fs.writeFileSync(path.join(dir,'GOOD.json'),JSON.stringify({sessions:[row('GOOD')]}));
 fs.writeFileSync(path.join(dir,'BAD.json'),JSON.stringify({sessions:[{...row('BAD'),close:9}]}));
 const report={schemaVersion:'16.3.4-session-aware-price-truth',expectedSession:session,generatedAt:'2026-10-25T08:10:00Z',
  ready:true,executionGrade:true,source:{realFetch:true,preciseSource:true,inputRows:3},
  acceptedRows:2,updatedHistoryFiles:1,missingHistoryFiles:['MISSING'],rejectedRows:1,droppedRows:0,
  sampleRejected:[{ticker:'BAD',reason:'SOURCE_SESSION_MISMATCH'}],sampleDropped:[]};
 const save=()=>fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 save();return {root,report,save,dir,run:()=>execute({root,runId:'RUN-1',startedAt:'2026-10-25T07:00:00Z',generatedAt:'2026-10-25T08:15:00Z'})};
}
test('accept then reject in same session quarantines producer candle, preserves old rows',()=>{
 const f=fixture();try{
  const bad=path.join(f.dir,'BAD.json');const doc=JSON.parse(fs.readFileSync(bad));
  doc.sessions.unshift({ticker:'BAD',date:'2026-10-22',source:SOURCE,close:8});
  fs.writeFileSync(bad,JSON.stringify(doc));
  const x=f.run();assert.equal(x.quarantined.length,1);assert.equal(x.result.acceptedRows,2);
  assert.equal(x.result.writtenRows,1);assert.equal(x.result.handoffEligible,false);
  const after=JSON.parse(fs.readFileSync(bad));assert.deepEqual(after.sessions,[doc.sessions[0]]);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('incomplete rejection evidence fails before changes',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(path.join(f.dir,'BAD.json'));
  f.report.sampleRejected=[];f.save();
  assert.throws(f.run,/S3_INCOMPLETE_REJECTION/);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'BAD.json')),before);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('runner refuses any non-shadow invocation',()=>{
 const f=fixture();try{
  assert.throws(()=>execute({root:f.root,runId:'RUN-1',startedAt:'2026-10-25T07:00:00Z',
   generatedAt:'2026-10-25T08:15:00Z',shadow:false}),/S3_SHADOW_ONLY/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
