'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {partitionPersistable,verifyPersisted}=require('../../scripts/stable/v16-persisted-price-acceptance.cjs');
const date='2026-10-27';
const row=(t,extras={})=>({ticker:t,date,sourceSessionDate:date,open:10,high:11,low:9,close:10,volume:100,warnings:[],...extras});
function history(root,t,extras={}){
 const p=path.join(root,t+'.json');
 fs.writeFileSync(p,JSON.stringify({ticker:t,symbolVerified:true,isin:null,sessions:[{...row(t),date}],...extras}));
}
test('reject missing or unverified history instead of inflating acceptedRows',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persist-'));
 try{
  history(root,'GOOD');history(root,'BAD',{symbolVerified:false});
  const out=partitionPersistable([row('GOOD'),row('BAD'),row('NONE')],root);
  assert.deepEqual(out.accepted.map(x=>x.ticker),['GOOD']);
  assert.deepEqual(out.rejected.map(x=>x.reason),['SYMBOL_IDENTITY_NOT_VERIFIED','HISTORY_FILE_MISSING']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('never admit a reconstructed OHLC candle as observed price truth',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persist-'));
 try{
  history(root,'GOOD');
  const out=partitionPersistable([row('GOOD',{warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']})],root);
  assert.equal(out.accepted.length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('verify all admitted current bars exist with identical observed OHLCV',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persist-'));
 try{
  history(root,'GOOD');assert.equal(verifyPersisted([row('GOOD')],root),1);
  assert.throws(()=>verifyPersisted([row('GOOD',{volume:101})],root),/ACCEPTED_OHLCV_NOT_PERSISTED_GOOD/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
