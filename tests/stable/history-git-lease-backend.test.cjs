'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {backend}=require('../../scripts/stable/history-git-lease-backend.cjs');
const {lease}=require('../../scripts/stable/history-writer-lease.cjs');
function command(cwd,...args){
 const r=cp.spawnSync('git',args,{cwd,encoding:'utf8'});
 if(r.status!==0)throw new Error(args.join(' ')+':'+r.stderr);
 return r.stdout.trim();
}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-git-lease-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bare=path.join(dir,'remote.git');command(dir,'init','--bare',bare);
 function writer(name){
  const cwd=path.join(dir,name);command(dir,'clone',bare,cwd);
  command(cwd,'config','user.email',name+'@test.invalid');command(cwd,'config','user.name',name);
  command(cwd,'checkout','--orphan','lease-token-'+name);
  command(cwd,'commit','--allow-empty','-m','unique owner '+name);
  const token=command(cwd,'rev-parse','HEAD');
  const driver=lease({...backend({cwd}),owner:name});
  return {cwd,token,driver};
 }
 return {writer,bare};
}
test('real Git remote accepts first owner and rejects second; release permits second',t=>{
 const f=fixture(t),first=f.writer('first'),second=f.writer('second');
 first.driver.acquire(first.token);
 assert.throws(()=>second.driver.acquire(second.token),/HISTORY_WRITER_ALREADY_LOCKED|ATOMIC_REF_CREATE_UNCONFIRMED/);
 assert.equal(first.driver.verify(),true);
 first.driver.release();
 second.driver.acquire(second.token);
 assert.equal(second.driver.verify(),true);
 second.driver.release();
});
test('real Git compare-and-delete refuses stale owner after remote replacement',t=>{
 const f=fixture(t),first=f.writer('first'),second=f.writer('second');
 first.driver.acquire(first.token);
 // An administrative forced replacement is a hostile/lost-lease event.
 command(second.cwd,'push','--force','origin',second.token+':refs/heads/egx-history-writer-lease');
 assert.throws(()=>first.driver.release(),/HISTORY_WRITER_LOCK_LOST/);
 const current=backend({cwd:first.cwd}).readRef('refs/heads/egx-history-writer-lease');
 assert.equal(current,second.token);
});
