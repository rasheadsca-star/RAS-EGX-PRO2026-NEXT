'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {gitBackend}=require('../../scripts/stable/history-publication-git-store.cjs');
const {publicationJournal}=require('../../scripts/stable/history-publication-journal.cjs');
function cmd(cwd,...args){const r=cp.spawnSync('git',args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persistent-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bare=path.join(dir,'origin.git');cmd(dir,'init','--bare',bare);
 function writer(name){const cwd=path.join(dir,name);cmd(dir,'clone',bare,cwd);return {cwd,journal:publicationJournal(gitBackend({cwd}))};}
 return {writer};
}
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),M='d'.repeat(64);
const input={runId:'run-42',baseSha:A,targetSha:B,leaseSha:C,manifestSha256:M};
test('persistent record survives independent clones and CAS phase updates',t=>{
 const f=fixture(t),one=f.writer('one'),two=f.writer('two');
 one.journal.begin(input);
 assert.throws(()=>two.journal.begin(input),/PUBLICATION_RUN_ALREADY_EXISTS/);
 assert.equal(two.journal.transition(input.runId,'PREPARED','PUSH_PENDING').phase,'PUSH_PENDING');
 assert.equal(one.journal.reconcile({runId:input.runId,remoteSha:B}).decision,'PUBLISHED_OBSERVED_REQUIRES_CAS');
 assert.equal(one.journal.transition(input.runId,'PUSH_PENDING','PUBLISHED').phase,'PUBLISHED');
 assert.equal(two.journal.reconcile({runId:input.runId,remoteSha:B}).decision,'NO_AUTOMATIC_ACTION');
});
test('remote journal denies stale state CAS',t=>{
 const f=fixture(t),one=f.writer('one'),two=f.writer('two');
 one.journal.begin(input);
 one.journal.transition(input.runId,'PREPARED','PUSH_PENDING');
 assert.throws(()=>two.journal.transition(input.runId,'PREPARED','PUSH_PENDING'),/PUBLICATION_PHASE_MISMATCH/);
});
