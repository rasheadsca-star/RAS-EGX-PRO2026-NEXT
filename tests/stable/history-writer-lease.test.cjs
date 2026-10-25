'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lease}=require('../../scripts/stable/history-writer-lease.cjs');
function backend(){
 const refs=new Map();
 return {refs,readRef:r=>refs.get(r)||null,createRef:(r,sha)=>{if(refs.has(r))return false;refs.set(r,sha);return true;},
 deleteRef:(r,sha)=>{if(refs.get(r)!==sha)return false;refs.delete(r);return true;}};
}
const a='a'.repeat(40),b='b'.repeat(40);
test('single owner acquires, verifies, releases durable ref lease',()=>{
 const db=backend(),one=lease({...db,owner:'workflow-1'});
 assert.equal(one.acquire(a).commit,a);assert.equal(one.verify(),true);
 assert.equal(one.release(),true);assert.equal(db.refs.size,0);
});
test('competing writer blocked while ref occupied',()=>{
 const db=backend(),one=lease({...db,owner:'workflow-1'}),two=lease({...db,owner:'workflow-2'});
 one.acquire(a);assert.throws(()=>two.acquire(b),/HISTORY_WRITER_ALREADY_LOCKED/);
 one.release();assert.equal(two.acquire(b).commit,b);
});
test('lost lock cannot authorize operation or release newer owner',()=>{
 const db=backend(),one=lease({...db,owner:'workflow-1'});
 one.acquire(a);db.refs.set('refs/heads/egx-history-writer-lease',b);
 assert.throws(()=>one.verify(),/HISTORY_WRITER_LOCK_LOST/);
 assert.throws(()=>one.release(),/HISTORY_WRITER_LOCK_LOST/);
 assert.equal(db.refs.get('refs/heads/egx-history-writer-lease'),b);
});
test('non-atomic backend confirmation fails closed',()=>{
 const db=backend(),one=lease({...db,owner:'one',createRef:()=>false});
 assert.throws(()=>one.acquire(a),/ATOMIC_REF_CREATE_UNCONFIRMED/);
});
