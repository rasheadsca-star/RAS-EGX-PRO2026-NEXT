'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {measure}=require('../../scripts/stable/history-s3-rebase-probe.cjs');
const git=(root,...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
function fixture(conflict){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-rebase-probe-'));
 git(root,'init','-q');git(root,'config','user.name','CI');git(root,'config','user.email','ci@example.com');
 fs.writeFileSync(path.join(root,'price.txt'),'base\n');git(root,'add','.');git(root,'commit','-qm','base');
 const base=git(root,'rev-parse','HEAD');git(root,'checkout','-qb','remote');
 fs.writeFileSync(path.join(root,'price.txt'),'remote change\n');git(root,'commit','-qam','remote');
 const remote=git(root,'rev-parse','HEAD');git(root,'checkout','-qb','candidate',base);
 fs.writeFileSync(path.join(root,conflict?'price.txt':'other.txt'),'candidate change\n');
 git(root,'add','.');git(root,'commit','-qm','candidate');
 return {root,remote,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('merge-tree reports prospective rebase conflict without rewriting HEAD',()=>{
 const f=fixture(true);try{
  const before=git(f.root,'rev-parse','HEAD'),result=measure({root:f.root,remoteRef:'remote',expectedRemoteSha:f.remote});
  assert.equal(result.prospectiveConflict,true);assert.equal(result.usedOursStrategy,false);
  assert.equal(git(f.root,'rev-parse','HEAD'),before);
  assert.equal(git(f.root,'status','--porcelain'),'');
 }finally{f.cleanup()}
});
test('merge-tree reports non-conflicting candidate and refuses moving remote',()=>{
 const f=fixture(false);try{
  assert.equal(measure({root:f.root,remoteRef:'remote',expectedRemoteSha:f.remote}).cleanMerge,true);
  assert.throws(()=>measure({root:f.root,remoteRef:'remote',expectedRemoteSha:'0'.repeat(40)}),/S3_REMOTE_SHA_MOVED/);
 }finally{f.cleanup()}
});
