'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {staticGuard}=require('./history-static-guard.cjs');
const root=path.resolve(__dirname,'../../..');
test('actual producer and github configuration are isolated',()=>{
 assert.deepEqual(staticGuard(root),[]);
});
test('negative test matrix rejects dangerous loaders',()=>{
 const fixtures=[
 "require('./history-guarded-merge.cjs')",
 "const r=require; r('./history-guarded-merge.cjs')",
 "module.require('./history-guarded-merge.cjs')",
 "require.call(null,'./history-guarded-merge.cjs')",
 "createRequire(__filename)('./history-guarded-merge.cjs')",
 "eval('1')",
 "new Function('return 1')",
 "const flag='EGX_HISTORY_GUARDED_INTEGRATION'",
 "import('./history-r8-integrity.cjs')",
 "require(x)",
 "require?.('./history-r9-report-binding.cjs')"
 ];
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'egx-s2-'));
 const product=path.join(tmp,'scripts/stable/v16-session-aware-price-truth.cjs');
 const wf=path.join(tmp,'.github/actions/local/action.yml');
 fs.mkdirSync(path.dirname(product),{recursive:true});
 fs.mkdirSync(path.dirname(wf),{recursive:true});
 try{
  fs.writeFileSync(wf,'name: ok');
  for(const snippet of fixtures){
   fs.writeFileSync(product,snippet);
   assert.notDeepEqual(staticGuard(tmp),[],snippet);
  }
  fs.writeFileSync(product,'function () {');
  assert.throws(()=>staticGuard(tmp),SyntaxError);
  fs.writeFileSync(product,"const fs=require('fs');");
  fs.writeFileSync(wf,'env: EGX_HISTORY_GUARDED_INTEGRATION: 1');
  assert.match(staticGuard(tmp).join(' '),/Activation flag in/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
