'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {audit}=require('../../scripts/independent/audit-history-provenance.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-provenance-audit-'));
 fs.mkdirSync(path.join(root,'data','history'),{recursive:true});
 fs.mkdirSync(path.join(root,'data','stable'),{recursive:true});
 fs.writeFileSync(path.join(root,'data','stable','v15-price-truth.json'),JSON.stringify({
 expectedSession:'2026-10-28',ready:true,executionGrade:true,acceptedRows:164,minimumExecutionRows:80
 }));
 return root;
}
test('read-only census reports missing and unverified historical OHLCV without approving it',()=>{
 const root=fixture();
 try{
  const bars=[{date:'2026-10-27',open:10,high:11,low:9,close:10,volume:1000},
   {date:'2026-10-28',open:10,high:11,low:9,close:10,volume:1200}];
  fs.writeFileSync(path.join(root,'data','history','COMI.json'),JSON.stringify({
   ticker:'COMI',symbolVerified:true,isin:'EGS60121C018',sessions:bars
  }));
  const original=fs.readFileSync(path.join(root,'data','history','COMI.json'),'utf8');
  const result=audit(root);
  assert.equal(result.session,'2026-10-28');
  assert.equal(result.totals.symbols,1);
  assert.equal(result.totals.with60Bars,0);
  assert.equal(result.totals.cleanLast60,0);
  assert.equal(result.symbols[0].verifiedProvenanceBars,0);
  assert.equal(result.symbols[0].unverifiedProvenanceBars,2);
  assert.equal(result.symbols[0].cleanLast60,false);
  assert.equal(fs.readFileSync(path.join(root,'data','history','COMI.json'),'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('duplicated sessions are explicitly counted and never qualify',()=>{
 const root=fixture();
 try{
  const bar={date:'2026-10-28',open:10,high:11,low:9,close:10,volume:1000};
  fs.writeFileSync(path.join(root,'data','history','ABCD.json'),JSON.stringify({
   ticker:'ABCD',symbolVerified:false,isin:null,sessions:[bar,{...bar}]
  }));
  const result=audit(root);
  assert.equal(result.totals.duplicatedSessionSymbols,1);
  assert.equal(result.symbols[0].duplicateSessions,true);
  assert.equal(result.totals.cleanLast60,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
