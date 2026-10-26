'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {run}=require('../../scripts/stable/history-s3-shadow-evidence.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-evidence-')),art=path.join(os.tmpdir(),'egx-shadow-art-'+path.basename(root)+'.json');
 cp.execFileSync('git',['init','-q',root]);
 for(const [k,v] of [['user.name','Test'],['user.email','test@example.com']])cp.execFileSync('git',['-C',root,'config',k,v]);
 for(const dir of ['data/history','data/stable','scripts/stable','.github/workflows'])fs.mkdirSync(path.join(root,dir),{recursive:true});
 fs.writeFileSync(path.join(root,'scripts/stable/v16-session-aware-price-truth.cjs'),"'use strict';\nconst fs=require('fs');\n");
 const date='2026-10-25',source='v16_session_aware_price_truth';
 fs.writeFileSync(path.join(root,'data/history/GOOD.json'),JSON.stringify({sessions:[{ticker:'GOOD',date,source,sourceSessionDate:date,fetchedAt:'2026-10-25T08:00:00Z',close:10}]}));
 fs.writeFileSync(path.join(root,'data/history/BAD.json'),JSON.stringify({sessions:[{ticker:'BAD',date,source,close:9}]}));
 const report={schemaVersion:'16.3.4-session-aware-price-truth',ready:true,executionGrade:true,generatedAt:'2026-10-25T08:30:00Z',expectedSession:date,source:{realFetch:true,preciseSource:true,inputRows:3},acceptedRows:2,rejectedRows:1,droppedRows:0,updatedHistoryFiles:1,missingHistoryFiles:['MISSING'],sampleRejected:[{ticker:'BAD',reason:'WRONG_SOURCE'}],sampleDropped:[]};
 fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 cp.execFileSync('git',['-C',root,'add','.']);cp.execFileSync('git',['-C',root,'commit','-qm','baseline']);
 const remoteSha=cp.execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 cp.execFileSync('git',['-C',root,'branch','remote-baseline']);
 return {root,art,run:()=>run({root,runId:'R1',startedAt:'2026-10-25T07:00:00Z',generatedAt:'2026-10-25T09:00:00Z',artifact:art,remoteRef:'remote-baseline',expectedRemoteSha:remoteSha}),cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(art,{force:true})}};
}
test('integrated shadow evidence includes quarantine, S2 guard, R8 with no push',()=>{
 const f=fixture();try{
  const result=f.run();assert.equal(result.passed,true,JSON.stringify(result));
  assert.deepEqual(result.stages,{preflight:'PASS',quarantine:'PASS',staticGuard:'PASS',r8:'PASS',rebase:'PASS'});
  assert.equal(result.quarantined.length,1);
  assert.equal(result.headAfter,result.head);
  assert.equal(result.rebase.cleanMerge,true);
  assert.equal(JSON.parse(fs.readFileSync(f.art)).passed,true);
 }finally{f.cleanup()}
});
test('static guard violation fails closed and reports evidence',()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.root,'scripts/stable/v16-session-aware-price-truth.cjs'),"eval('1');\n");
  const result=f.run();assert.equal(result.passed,false);
  assert.ok(result.errors.some(x=>x.includes('S3_STATIC_GUARD')));
  assert.equal(JSON.parse(fs.readFileSync(f.art)).passed,false);
 }finally{f.cleanup()}
});
