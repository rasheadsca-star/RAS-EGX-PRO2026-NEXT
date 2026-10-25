'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicationJournal}=require('../../scripts/stable/history-publication-journal.cjs');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),M='d'.repeat(64);
function fixture(){
 const db=new Map();
 const journal=publicationJournal({
  read:id=>db.get(id)||null,
  create:(id,x)=>{if(db.has(id))return false;db.set(id,structuredClone(x));return true;},
  cas:(id,old,next)=>{if(JSON.stringify(db.get(id))!==JSON.stringify(old))return false;db.set(id,structuredClone(next));return true;}
 });
 const input={runId:'run-1',baseSha:A,targetSha:B,leaseSha:C,manifestSha256:M};
 return {db,journal,input};
}
test('record lifecycle uses create-only and exact CAS transitions',()=>{
 const f=fixture();f.journal.begin(f.input);
 assert.throws(()=>f.journal.begin(f.input),/PUBLICATION_RUN_ALREADY_EXISTS/);
 assert.equal(f.journal.transition('run-1','PREPARED','PUSH_PENDING').phase,'PUSH_PENDING');
 assert.equal(f.journal.transition('run-1','PUSH_PENDING','PUBLISHED').phase,'PUBLISHED');
});
test('unexpected transition and stale phase fail closed',()=>{
 const f=fixture();f.journal.begin(f.input);
 assert.throws(()=>f.journal.transition('run-1','PREPARED','PUBLISHED'),/ILLEGAL_PUBLICATION_TRANSITION/);
 assert.throws(()=>f.journal.transition('run-1','PUSH_PENDING','PUBLISHED'),/PUBLICATION_PHASE_MISMATCH/);
});
test('uncertain push distinguishes original, target and unexpected remote SHA without auto-rollback',()=>{
 const f=fixture();f.journal.begin(f.input);f.journal.transition('run-1','PREPARED','PUSH_PENDING');
 assert.equal(f.journal.reconcile({runId:'run-1',remoteSha:A}).decision,'NOT_PUBLISHED_REQUIRES_OWNER_REVIEW');
 assert.equal(f.journal.reconcile({runId:'run-1',remoteSha:B}).decision,'PUBLISHED_OBSERVED_REQUIRES_CAS');
 assert.equal(f.journal.reconcile({runId:'run-1',remoteSha:C}).decision,'AMBIGUOUS_REMOTE_DIVERGENCE_STOP');
});
test('published record detects subsequent remote movement',()=>{
 const f=fixture();f.journal.begin(f.input);f.journal.transition('run-1','PREPARED','PUSH_PENDING');
 f.journal.transition('run-1','PUSH_PENDING','PUBLISHED');
 assert.equal(f.journal.reconcile({runId:'run-1',remoteSha:C}).decision,'REMOTE_MOVED_AFTER_PUBLICATION');
});
test('CAS failure does not certify publication',()=>{
 const db=new Map(),journal=publicationJournal({read:id=>db.get(id)||null,
  create:(id,x)=>{db.set(id,x);return true;},cas:()=>false});
 journal.begin({runId:'r',baseSha:A,targetSha:B,leaseSha:C,manifestSha256:M});
 assert.throws(()=>journal.transition('r','PREPARED','PUSH_PENDING'),/PUBLICATION_CAS_FAILED/);
});
