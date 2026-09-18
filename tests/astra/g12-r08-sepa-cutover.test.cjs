'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');

test('R08 Pages build uses vendored SEPA and has no cross-branch checkout',()=>{
  const yml=fs.readFileSync(path.join(root,'.github/workflows/static.yml'),'utf8');
  assert.doesNotMatch(yml,/ref:\s*develop\/sepax-isolated-v1/);
  assert.doesNotMatch(yml,/\.sepax-pages-source/);
  assert.match(yml,/working-directory:\s*astra\/vendor\/sepa-x/);
  assert.match(yml,/astra\/vendor\/sepa-x\/scripts\/build-github-pages\.mjs/);
});

test('R08 removal closes the full G12 dependency scan',()=>{
  const x=scanLegacyDependencies(root);
  assert.deepEqual(x.dependencyIds,[]);
  assert.equal(x.runtimeLegacyDependencyCount,0);
  assert.equal(x.clean,true);
});
