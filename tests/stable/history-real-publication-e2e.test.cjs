'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {publish}=require('../../scripts/stable/history-safe-publish.cjs');
const {publicationJournal}=require('../../scripts/stable/history-publication-journal.cjs');
const {gitBackend}=require('../../scripts/stable/history-publication-git-store.cjs');
const {backend}=require('../../scripts/stable/history-git-lease-backend.cjs');
const {lease}=require('../../scripts/stable/history-writer-lease.cjs');
const M='d'.repeat(64);
function git(cwd,...args){const r=cp.spawnSync('git',args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error('git '+args.join(' ')+':'+r.stderr);return r.stdout.trim();}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-real-publication-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bare=path.join(dir,'remote.git');git(dir,'init','--bare',bare);
 const seed=path.join(dir,'seed');git(dir,'clone',bare,seed);git(seed,'config','user.email','seed@test.invalid');git(seed,'config','user.name','seed');
 git(seed,'checkout','-b','main');fs.writeFileSync(path.join(seed,'hello.txt'),'initial\n');git(seed,'add','.');git(seed,'commit','-m','initial');git(seed,'push','origin','main');
 const work=path.join(dir,'writer');git(dir,'clone',bare,work);git(work,'config','user.email','writer@test.invalid');git(work,'config','user.name','writer');git(work,'checkout','-b','main','origin/main');
 fs.writeFileSync(path.join(work,'hello.txt'),'updated\n');git(work,'add','.');git(work,'commit','-m','history update');
 const original=git(work,'rev-parse','origin/main'),target=git(work,'rev-parse','HEAD');
 const tokenDir=path.join(dir,'token');git(dir,'clone',bare,tokenDir);git(tokenDir,'config','user.email','owner@test.invalid');git(tokenDir,'config','user.name','owner');
 git(tokenDir,'checkout','--orphan','lease-owner');git(tokenDir,'commit','--allow-empty','-m','owner lease');const token=git(tokenDir,'rev-parse','HEAD');
 const lock=lease({...backend({cwd:tokenDir}),owner:'integration-writer'});lock.acquire(token);
 const assessmentFile=path.join(dir,'frozen-assessment.json'),baselineFile=path.join(dir,'frozen-baseline.json');
 fs.writeFileSync(assessmentFile,'{}');fs.writeFileSync(baselineFile,'{}');
 const store=publicationJournal(gitBackend({cwd:work}));
 const input={runId:'integration-42',baseSha:original,targetSha:target,leaseSha:token,manifestSha256:M};
 const opts={root:work,assessmentFile,baselineFile,expectedRunId:input.runId,branch:'main',
  lockLease:lock,journal:{store,input},proofCheck:()=>({status:'PASS',publication:{manifestSha256:M}})};
 return {bare,dir,work,seed,lock,store,opts,original,target,input};
}
test('real Git end-to-end lock -> persistent journal -> rebase -> push -> published',t=>{
 const f=fixture(t);
 const result=publish(f.opts);
 assert.equal(result.published,true);
 assert.equal(git(f.work,'ls-remote','--heads','origin','main').split(/\s+/)[0],f.target);
 assert.equal(f.store.reconcile({runId:f.input.runId,remoteSha:f.target}).decision,'NO_AUTOMATIC_ACTION');
 // Entire publication record survives a separate runner/clone.
 const clone=path.join(f.dir,'recovery');git(f.dir,'clone',f.bare,clone);
 const independent=publicationJournal(gitBackend({cwd:clone}));
 assert.equal(independent.reconcile({runId:f.input.runId,remoteSha:f.target}).record.phase,'PUBLISHED');
 f.lock.release();
});
test('real Git rejected push preserves durable pending journal for independent runner',t=>{
 const f=fixture(t);
 const hook=path.join(f.bare,'hooks','pre-receive');
 fs.writeFileSync(hook,'#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then exit 1; fi\ndone\nexit 0\n');
 fs.chmodSync(hook,0o755);
 assert.throws(()=>publish(f.opts),/PUSH_RESULT_UNCERTAIN_RECONCILIATION_REQUIRED/);
 assert.equal(git(f.work,'ls-remote','--heads','origin','main').split(/\s+/)[0],f.original);
 const clone=path.join(f.dir,'recovery');git(f.dir,'clone',f.bare,clone);
 const independent=publicationJournal(gitBackend({cwd:clone}));
 assert.equal(independent.reconcile({runId:f.input.runId,remoteSha:f.original}).decision,'NOT_PUBLISHED_REQUIRES_OWNER_REVIEW');
 f.lock.release();
});
test('competing owner cannot publish during existing real Git lock',t=>{
 const f=fixture(t),other=lease({...backend({cwd:f.work}),owner:'other'});
 assert.throws(()=>other.acquire(f.target),/HISTORY_WRITER_ALREADY_LOCKED/);
 f.lock.release();
});
