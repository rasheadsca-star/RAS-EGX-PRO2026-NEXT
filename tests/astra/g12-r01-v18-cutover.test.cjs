'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');
test('R01 Raw shell is removed only after local replacement parity',()=>{
  const s=fs.readFileSync(path.join(root,'v18-live/index.html'),'utf8');
  assert.match(s,/\.\.\/astra\/runtime\/v18\/index\.html/);
  assert.doesNotMatch(s,/raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/v18-global-strategy-ensemble-20260906/i);
});
test('R01 disappears from full scan while later dependencies remain pending',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R01_V18_REMOTE_SHELL_RAW'),false);
  assert.ok(x.runtimeLegacyDependencyCount<=7);
});
