'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {publish}=require('../../scripts/stable/history-safe-publish.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-safe-publish-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const assessmentFile=path.join(root,'assessment.json'),baselineFile=path.join(root,'baseline.json');
 fs.writeFileSync(assessmentFile,'{}');fs.writeFileSync(baselineFile,'{}');
 return {root,assessmentFile,baselineFile,expectedRunId:'run-1',branch:'main'};
}
test('cannot publish without explicit cross-run writer lock',t=>{
 const f=fixture(t),calls=[];
 assert.throws(()=>publish({...f,execute:a=>{calls.push(a);return '';}}),/PUBLISH_CROSS_RUN_LOCK_REQUIRED/);
 assert.equal(calls.length,0);
});
test('refuses wrong branch before fetching or rebasing',t=>{
 const f=fixture(t),calls=[];
 assert.throws(()=>publish({...f,lockLease:{verify:()=>true},execute:a=>{calls.push(a);return 'feature';}}),/WRONG_PUBLICATION_BRANCH/);
 assert.deepEqual(calls,[['branch','--show-current']]);
});
test('refuses dirty checkout before fetch and does not push',t=>{
 const f=fixture(t),calls=[];
 assert.throws(()=>publish({...f,lockLease:{verify:()=>true},execute:a=>{
  calls.push(a);return a[0]==='branch'?'main':' M data/history/MIPH.json';
 }}),/DIRTY_PUBLICATION_CHECKOUT/);
 assert.deepEqual(calls.map(a=>a[0]),['branch','status']);
});
test('requires frozen evidence files and rejects untrusted ref names',t=>{
 const f=fixture(t);
 assert.throws(()=>publish({...f,branch:'main;echo hacked',lockLease:{verify:()=>true},execute:()=>''}),/INVALID_PUBLISH_REF/);
 fs.unlinkSync(f.baselineFile);
 assert.throws(()=>publish({...f,lockLease:{verify:()=>true},execute:()=>''}),/FROZEN_EVIDENCE_REQUIRED/);
});
test('after safe rebase, invalid proof refuses push without rewriting evidence',t=>{
 const f=fixture(t),calls=[];
 assert.throws(()=>publish({...f,lockLease:{verify:()=>true},execute:a=>{
  calls.push(a);return a[0]==='branch'?'main':'';
 }}));
 assert.deepEqual(calls.map(a=>a[0]),['branch','status','fetch','rebase']);
 assert.equal(fs.readFileSync(f.assessmentFile,'utf8'),'{}');
});
