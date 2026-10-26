'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {preflight}=require('../../scripts/stable/history-s3-shadow-preflight.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-preflight-'));
 cp.execFileSync('git',['init','-q',root]);
 cp.execFileSync('git',['-C',root,'config','user.name','CI']);
 cp.execFileSync('git',['-C',root,'config','user.email','ci@example.com']);
 const dir=path.join(root,'data/history');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});
 const date='2026-10-25',source='v16_session_aware_price_truth';
 fs.writeFileSync(path.join(dir,'GOOD.json'),JSON.stringify({sessions:[{ticker:'GOOD',date,source,sourceSessionDate:date,fetchedAt:'2026-10-25T08:00:00Z',close:10}]}));
 fs.writeFileSync(path.join(dir,'BAD.json'),JSON.stringify({sessions:[{ticker:'BAD',date,source,close:9}]}));
 const report={schemaVersion:'16.3.4-session-aware-price-truth',ready:true,executionGrade:true,generatedAt:'2026-10-25T08:30:00Z',expectedSession:date,
 source:{realFetch:true,preciseSource:true,inputRows:3},acceptedRows:2,rejectedRows:1,droppedRows:0,updatedHistoryFiles:1,
 missingHistoryFiles:['MISSING'],sampleRejected:[{ticker:'BAD',reason:'SOURCE_MISMATCH'}],sampleDropped:[]};
 const save=()=>fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 save();cp.execFileSync('git',['-C',root,'add','.']);cp.execFileSync('git',['-C',root,'commit','-qm','fixture']);
 return {root,report,save,run:()=>preflight({root,runId:'R1',startedAt:'2026-10-25T07:00:00Z'})};
}
test('preflight derives R8 affected set and preserves all files',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(path.join(f.root,'data/history/BAD.json'));
  const result=f.run();
  assert.deepEqual([...result.affectedTickers].sort(),['BAD','GOOD']);
  assert.equal(result.baseline.expectedSession,'2026-10-25');
  assert.deepEqual(fs.readFileSync(path.join(f.root,'data/history/BAD.json')),before);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('preflight rejects stale source before R8',()=>{
 const f=fixture();try{
  f.report.generatedAt='2026-10-25T06:00:00Z';f.save();
  assert.throws(f.run,/S3_STALE_REPORT/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('preflight rejects non-git subdirectory root',()=>{
 const f=fixture();try{
  assert.throws(()=>preflight({root:path.join(f.root,'data'),runId:'R1',startedAt:'2026-10-25T07:00:00Z'}),/S3_WORKTREE_ROOT_REQUIRED/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
