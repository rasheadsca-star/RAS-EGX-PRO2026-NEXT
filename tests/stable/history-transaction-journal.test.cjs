'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {begin,apply,recover,complete,txnPath}=require('../../scripts/stable/history-transaction-journal.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data/history');fs.mkdirSync(dir,{recursive:true});
 const before={sessions:[{ticker:'MIPH',date:'2026-10-22',close:742}]};
 fs.writeFileSync(path.join(dir,'MIPH.json'),JSON.stringify(before));
 fs.writeFileSync(path.join(dir,'FAIT.json'),JSON.stringify({sessions:[{date:'2026-10-22',close:43}]}));
 const snapshot=()=>['MIPH','FAIT'].map(t=>fs.readFileSync(path.join(dir,t+'.json'),'utf8'));
 const original=snapshot();
 const updates=[{ticker:'MIPH',after:{sessions:[{ticker:'MIPH',date:'2026-10-22',close:742},{date:'2026-10-25',close:683}]}},
 {ticker:'FAIT',after:{sessions:[]}}];
 return {root,dir,original,updates,snapshot};
}
test('journal exists with original data before canonical writes',t=>{
 const f=fixture(t),record=begin({root:f.root,runId:'run-1',updates:f.updates});
 assert.equal(fs.existsSync(txnPath(f.root)),true);assert.deepEqual(f.snapshot(),f.original);
 assert.equal(record.entries.length,2);
 assert.throws(()=>begin({root:f.root,runId:'run-2',updates:f.updates}),/UNRECOVERED_HISTORY_TRANSACTION/);
});
test('interruption after first canonical write recovers both originals',t=>{
 const f=fixture(t),record=begin({root:f.root,runId:'run-1',updates:f.updates});
 assert.throws(()=>apply({root:f.root,record,faultAfter:0}),/INJECTED_TRANSACTION_INTERRUPTION/);
 assert.notDeepEqual(f.snapshot(),f.original);
 assert.deepEqual(recover({root:f.root}),{recovered:true,runId:'run-1',restoredFiles:2});
 assert.deepEqual(f.snapshot(),f.original);assert.equal(fs.existsSync(txnPath(f.root)),false);
});
test('unapplied journal rolls back safely; repeated recovery is idempotent',t=>{
 const f=fixture(t);begin({root:f.root,runId:'run-1',updates:f.updates});
 assert.equal(recover({root:f.root}).recovered,true);assert.deepEqual(f.snapshot(),f.original);
 assert.deepEqual(recover({root:f.root}),{recovered:false});
});
test('complete checks all staged hashes and removes journal only after writes',t=>{
 const f=fixture(t),record=begin({root:f.root,runId:'run-1',updates:f.updates});
 assert.throws(()=>complete({root:f.root,record}),/INCOMPLETE_TRANSACTION/);
 apply({root:f.root,record});assert.equal(complete({root:f.root,record}).complete,true);
 assert.equal(fs.existsSync(txnPath(f.root)),false);
});
test('recovery refuses external mutations without overwriting them',t=>{
 const f=fixture(t);begin({root:f.root,runId:'run-1',updates:f.updates});
 fs.writeFileSync(path.join(f.dir,'MIPH.json'),JSON.stringify({sessions:[{close:999}]}));
 assert.throws(()=>recover({root:f.root}),/RECOVERY_CONFLICT/);
 assert.equal(fs.existsSync(txnPath(f.root)),true);
});
test('invalid or duplicate ticker is rejected before journal creation',t=>{
 const f=fixture(t);
 for(const ticker of ['../escape','..','miph'])assert.throws(()=>begin({root:f.root,runId:'run-1',updates:[{ticker,after:{sessions:[]}}]}),/INVALID_TRANSACTION_TICKER/);
 assert.throws(()=>begin({root:f.root,runId:'run-1',updates:[f.updates[0],f.updates[0]]}),/INVALID_TRANSACTION_TICKER/);
 assert.equal(fs.existsSync(txnPath(f.root)),false);
});

test('tampering journal source path is rejected before recovery modifies any files',t=>{
 const f=fixture(t);begin({root:f.root,runId:'run-1',updates:f.updates});
 const j=txnPath(f.root),record=JSON.parse(fs.readFileSync(j,'utf8'));
 record.entries[0].ticker='../outside';fs.writeFileSync(j,JSON.stringify(record));
 assert.throws(()=>recover({root:f.root}),/INVALID_JOURNAL_TICKER/);
 assert.deepEqual(f.snapshot(),f.original);
});
test('tampering original snapshot digest fails closed',t=>{
 const f=fixture(t);begin({root:f.root,runId:'run-1',updates:f.updates});
 const j=txnPath(f.root),record=JSON.parse(fs.readFileSync(j,'utf8'));
 record.entries[0].beforeBase64=Buffer.from('not original').toString('base64');
 fs.writeFileSync(j,JSON.stringify(record));
 assert.throws(()=>recover({root:f.root}),/JOURNAL_CONTENT_HASH_MISMATCH/);
 assert.deepEqual(f.snapshot(),f.original);
});
test('different in-memory record cannot be used to apply another journal',t=>{
 const f=fixture(t),record=begin({root:f.root,runId:'run-1',updates:f.updates});
 const forged={...record,entries:[{...record.entries[0],ticker:'FAIT'},record.entries[1]]};
 assert.throws(()=>apply({root:f.root,record:forged}),/INVALID_JOURNAL_TICKER|JOURNAL_RECORD_MISMATCH/);
 assert.deepEqual(f.snapshot(),f.original);
});
