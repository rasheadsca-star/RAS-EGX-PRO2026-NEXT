'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {simulate}=require('../../scripts/stable/history-s3-push-simulator.cjs');
const git=(cwd,...args)=>cp.execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-s3-push-')),work=path.join(root,'work'),remote=path.join(root,'remote.git'),artifact=path.join(root,'shadow.json');
 fs.mkdirSync(work);git(root,'init','--bare',remote);git(work,'init','-b','main');git(work,'config','user.name','Test');git(work,'config','user.email','test@example.com');
 fs.writeFileSync(path.join(work,'data.txt'),'first');git(work,'add','.');git(work,'commit','-m','base');git(work,'push',remote,'HEAD:refs/heads/main');
 const before=git(work,'ls-remote',remote,'refs/heads/main').split(/\s+/)[0];
 fs.writeFileSync(path.join(work,'data.txt'),'second');git(work,'add','.');git(work,'commit','-m','candidate');
 return {root,work,remote,artifact,before,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('failed safety gate never attempts push and leaves remote SHA intact',()=>{
 const f=fixture();try{
  const r=simulate({candidate:f.work,remote:f.remote,artifact:f.artifact,gate:()=>{throw Error('R8_PREVIOUS_SESSIONS_CHANGED')}});
  assert.equal(r.gate,'FAIL');assert.equal(r.pushAttempted,false);assert.equal(r.remoteAfter,f.before);
  assert.equal(JSON.parse(fs.readFileSync(f.artifact)).remoteAfter,f.before);
 }finally{f.cleanup()}
});
test('passed safety gate can push only to temporary bare remote',()=>{
 const f=fixture();try{
  const r=simulate({candidate:f.work,remote:f.remote,artifact:f.artifact,gate:()=>true});
  assert.equal(r.gate,'PASS');assert.equal(r.pass,true);assert.notEqual(r.remoteAfter,f.before);
 }finally{f.cleanup()}
});

test('false, null, undefined, zero and object all block push without moving remote',()=>{
 for(const value of [false,null,undefined,0,{}]){
  const f=fixture();
  try{
   const r=simulate({candidate:f.work,remote:f.remote,artifact:f.artifact,gate:()=>value});
   assert.equal(r.gate,'FAIL');
   assert.equal(r.error,'GATE_NOT_PASSED');
   assert.equal(r.pushAttempted,false);
   assert.equal(r.remoteAfter,f.before);
  }finally{f.cleanup()}
 }
});
