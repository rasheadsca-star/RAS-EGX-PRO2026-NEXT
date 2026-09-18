'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const boot=require('../../v18-live/bootstrap.js');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');

test('R02 cut: local bootstrap succeeds with no remote fallback surface',async()=>{
  const calls=[];let navigated=null,status='';
  const result=await boot.resolve({
    fetchFn:async url=>{calls.push(url);return{ok:true,status:200,text:async()=>'<title>Astra Local Decision Surface</title>'}},
    navigate:url=>{navigated=url},
    setStatus:value=>{status=value}
  });
  assert.equal(result,'LOCAL');
  assert.equal(navigated,boot.LOCAL);
  assert.deepEqual(calls,[boot.LOCAL]);
  assert.equal(status,'');
  const source=fs.readFileSync(path.join(root,'v18-live/bootstrap.js'),'utf8');
  assert.doesNotMatch(source,/cdn\.jsdelivr\.net|raw\.githubusercontent\.com|https?:\/\//i);
});

test('R02 cut: unavailable local runtime fails closed instead of reaching legacy host',async()=>{
  let status='';
  const result=await boot.resolve({
    fetchFn:async()=>{throw new Error('LOCAL_BLOCKED')},
    navigate:()=>assert.fail('must not navigate'),
    setStatus:value=>{status=value}
  });
  assert.equal(result,'FAIL_CLOSED');
  assert.match(status,/FAIL-CLOSED/);
});

test('R02 disappears from full legacy scan',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R02_V18_REMOTE_SHELL_JSDELIVR'),false);
  assert.ok(x.runtimeLegacyDependencyCount<=6);
});
