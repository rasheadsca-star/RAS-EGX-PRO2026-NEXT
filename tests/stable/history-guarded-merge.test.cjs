'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {run}=require('../../scripts/stable/history-guarded-merge.cjs');
const {txnPath}=require('../../scripts/stable/history-transaction-journal.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-guarded-merge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data/history');fs.mkdirSync(dir,{recursive:true});
 const a={sessions:[{date:'2026-10-22',close:742}],firstSession:'2026-10-22'};
 const b={sessions:[{date:'2026-10-22',close:43}],firstSession:'2026-10-22'};
 for(const [ticker,doc] of [['MIPH',a],['FAIT',b]])fs.writeFileSync(path.join(dir,ticker+'.json'),JSON.stringify(doc));
 const orig=['MIPH','FAIT'].map(x=>fs.readFileSync(path.join(dir,x+'.json'),'utf8'));
 const rows=['MIPH','FAIT'].map((ticker,i)=>({ticker,date:'2026-10-25',close:i+1,primarySource:'test',
  validationStatus:'test',confidence:{overall:86},sourceSessionDate:'2026-10-25'}));
 const opts={root,runId:'run-1',rows,generatedAt:'2026-10-25T10:00:00Z'};
 const read=()=>['MIPH','FAIT'].map(x=>fs.readFileSync(path.join(dir,x+'.json'),'utf8'));
 return {opts,orig,read,root};
}
test('guarded merge holds journal during post-write validation then removes it',t=>{
 const f=fixture(t);
 const result=run({...f.opts,validate:()=>{
  assert.equal(fs.existsSync(txnPath(f.root)),true);
  assert.equal(JSON.parse(f.read()[0]).sessions.length,2);
 }});
 assert.equal(result.updated,2);assert.equal(fs.existsSync(txnPath(f.root)),false);
});
test('guarded merge rolls back all changed files after simulated interruption',t=>{
 const f=fixture(t);
 assert.throws(()=>run({...f.opts,validate:()=>{},faultAfter:0}),/INJECTED_TRANSACTION_INTERRUPTION/);
 assert.deepEqual(f.read(),f.orig);assert.equal(fs.existsSync(txnPath(f.root)),false);
});
test('guarded merge rolls back after an R8 or manifest failure in validation',t=>{
 const f=fixture(t);
 assert.throws(()=>run({...f.opts,validate:()=>{throw new Error('MANIFEST_HASH_FAILURE');}}),/MANIFEST_HASH_FAILURE/);
 assert.deepEqual(f.read(),f.orig);
});
test('guarded merge does not write anything when staging encounters invalid file',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'data/history/FAIT.json'),'{bad');
 assert.throws(()=>run({...f.opts,validate:()=>{}}));
 assert.equal(fs.existsSync(txnPath(f.root)),false);
});
