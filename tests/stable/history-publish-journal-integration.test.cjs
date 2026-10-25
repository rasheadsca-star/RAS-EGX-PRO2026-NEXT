'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {publish}=require('../../scripts/stable/history-safe-publish.cjs');
const {publicationJournal}=require('../../scripts/stable/history-publication-journal.cjs');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),M='d'.repeat(64);
function fixture(t,{pushFails=false,remoteHead=B}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-publisher-journal-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const assessmentFile=path.join(root,'a.json'),baselineFile=path.join(root,'b.json');
 fs.writeFileSync(assessmentFile,'{}');fs.writeFileSync(baselineFile,'{}');
 const db=new Map(),trace=[];
 const store=publicationJournal({
  read:id=>db.get(id)||null,
  create:(id,x)=>{if(db.has(id))return false;db.set(id,structuredClone(x));return true;},
  cas:(id,x,y)=>{if(JSON.stringify(db.get(id))!==JSON.stringify(x))return false;db.set(id,structuredClone(y));return true;}
 });
 function execute(args){
  trace.push(args[0]);
  if(args[0]==='branch')return 'main';
  if(args[0]==='status'||args[0]==='fetch'||args[0]==='rebase')return '';
  if(args[0]==='rev-parse')return args[1]==='HEAD'?B:A;
  if(args[0]==='ls-remote')return remoteHead+'\trefs/heads/main';
  if(args[0]==='push'){if(pushFails)throw new Error('SIMULATED_PUSH_TRANSPORT_FAILURE');return '';}
  throw Error('UNKNOWN_GIT:'+args);
 }
 const opts={root,assessmentFile,baselineFile,expectedRunId:'run1',execute,
  lockLease:{verify:()=>true},proofCheck:()=>({status:'PASS'}),
  journal:{store,input:{runId:'run1',baseSha:A,targetSha:B,leaseSha:C,manifestSha256:M}}};
 return {opts,db,trace};
}
test('journal must persist PREPARED/PUSH_PENDING and observe remote before PUBLISHED',t=>{
 const f=fixture(t),result=publish(f.opts);
 assert.equal(result.published,true);assert.equal(f.db.get('run1').phase,'PUBLISHED');
 assert.equal(f.trace.filter(x=>x==='push').length,1);
});
test('transport failure leaves durable PUSH_PENDING for later reconciliation',t=>{
 const f=fixture(t,{pushFails:true});
 assert.throws(()=>publish(f.opts),/PUSH_RESULT_UNCERTAIN_RECONCILIATION_REQUIRED/);
 assert.equal(f.db.get('run1').phase,'PUSH_PENDING');
});
test('remote divergence blocks PUBLISHED marker',t=>{
 const f=fixture(t,{remoteHead:C});
 assert.throws(()=>publish(f.opts),/REMOTE_PUBLICATION_NOT_VERIFIED/);
 assert.equal(f.db.get('run1').phase,'PUSH_PENDING');
});
test('mismatched target commit cannot create journal or push',t=>{
 const f=fixture(t);f.opts.journal.input.targetSha=C;
 assert.throws(()=>publish(f.opts),/PUBLICATION_INTENT_BINDING_MISMATCH/);
 assert.equal(f.trace.includes('push'),false);assert.equal(f.db.size,0);
});
