'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {simulateValidated}=require('../../scripts/stable/history-s3-validated-push.cjs');
const git=(cwd,...args)=>cp.execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-validated-push-')),work=path.join(root,'work'),remote=path.join(root,'remote.git'),
  evidencePath=path.join(root,'evidence.json'),artifact=path.join(root,'result.json');
 fs.mkdirSync(work);git(root,'init','--bare',remote);git(work,'init','-b','main');
 git(work,'config','user.name','CI');git(work,'config','user.email','ci@example.com');
 fs.writeFileSync(path.join(work,'file'),'base');git(work,'add','.');git(work,'commit','-m','base');git(work,'push',remote,'HEAD:main');
 const before=git(work,'ls-remote',remote,'refs/heads/main').split(/\s+/)[0];
 fs.writeFileSync(path.join(work,'file'),'candidate');git(work,'add','.');git(work,'commit','-m','candidate');
 const valid={mode:'SHADOW_ONLY',passed:true,stages:{preflight:'PASS',quarantine:'PASS',staticGuard:'PASS',r8:'PASS',rebase:'PASS'},
  rebase:{cleanMerge:true},r8:{previousSessionsIntact:true,unaffectedFilesIntact:true},errors:[]};
 const run=(ev)=>{fs.writeFileSync(evidencePath,JSON.stringify(ev));return simulateValidated({candidate:work,remote,evidencePath,artifact})};
 return {root,work,remote,before,valid,run,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('full evidence with R8 failure stops push and preserves bare remote SHA',()=>{
 const f=fixture();try{
  const r=f.run({...f.valid,r8:{previousSessionsIntact:false,unaffectedFilesIntact:true}});
  assert.equal(r.gate,'FAIL');assert.equal(r.pushAttempted,false);assert.equal(r.remoteAfter,f.before);
 }finally{f.cleanup()}
});
test('full evidence with static guard failure stops push',()=>{
 const f=fixture();try{
  const r=f.run({...f.valid,stages:{...f.valid.stages,staticGuard:'FAIL'}});
  assert.equal(r.gate,'FAIL');assert.equal(r.pushAttempted,false);assert.equal(r.remoteAfter,f.before);
 }finally{f.cleanup()}
});
test('complete verified evidence permits push only to test bare remote',()=>{
 const f=fixture();try{
  const r=f.run(f.valid);assert.equal(r.gate,'PASS');assert.equal(r.pass,true);assert.notEqual(r.remoteAfter,f.before);
 }finally{f.cleanup()}
});
