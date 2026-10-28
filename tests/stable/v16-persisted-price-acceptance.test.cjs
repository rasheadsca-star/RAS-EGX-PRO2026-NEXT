'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../scripts/stable/v16-session-aware-price-truth.cjs'),'utf8');
const start=source.indexOf('function partitionPersistable('),end=source.indexOf('function mergeIntoHistory(');
assert.ok(start>0&&end>start,'producer functions must be present');
const context={fs,path,
 n:(v,f=null)=>v===null||v===undefined||v===''?f:Number.isFinite(Number(v))?Number(v):f,
 normSymbol:v=>String(v||'').trim().toUpperCase().replace(/\.CA$/i,'').replace(/[^A-Z0-9._-]/g,''),
 dateOnly:v=>(String(v||'').match(/^(\d{4}-\d{2}-\d{2})/)||[])[1]||null,
 readJson:(p,f=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return f;}}
};
const {partitionPersistable,verifyPersisted}=vm.runInNewContext(source.slice(start,end)+';({partitionPersistable,verifyPersisted})',context);
const date='2026-10-27';
const row=(t,extra={})=>({ticker:t,date,sourceSessionDate:date,open:10,high:11,low:9,close:10,volume:100,warnings:[],...extra});
function history(root,t,extra={}){
 fs.writeFileSync(path.join(root,t+'.json'),JSON.stringify({ticker:t,symbolVerified:true,isin:null,
  sessions:[{...row(t),date}],...extra}));
}
test('producer rejects missing and unverified histories from acceptedRows',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persist-'));
 try{
  history(root,'GOOD');history(root,'BAD',{symbolVerified:false});
  const p=partitionPersistable([row('GOOD'),row('BAD'),row('NONE')],root);
  assert.deepEqual(Array.from(p.accepted,x=>x.ticker),['GOOD']);
  assert.deepEqual(Array.from(p.rejected,x=>x.reason),['SYMBOL_IDENTITY_NOT_VERIFIED','HISTORY_FILE_MISSING']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('producer refuses reconstructed or stale-session candles',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persist-'));
 try{
  history(root,'GOOD');
  const p=partitionPersistable([row('GOOD',{warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']}),
    row('GOOD',{sourceSessionDate:'2026-10-26'})],root);
  assert.equal(p.accepted.length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('producer verifies exact persisted OHLCV after merge',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-persist-'));
 try{
  history(root,'GOOD');assert.equal(verifyPersisted([row('GOOD')],root),1);
  assert.throws(()=>verifyPersisted([row('GOOD',{volume:101})],root),/ACCEPTED_OHLCV_NOT_PERSISTED_GOOD/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
