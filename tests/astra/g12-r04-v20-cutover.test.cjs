'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');
test('R04 cut removes V20 Pages Raw and CDN runtime sources',()=>{
  const s=fs.readFileSync(path.join(root,'scripts/stable/v16-main-app-consensus.cjs'),'utf8');
  assert.match(s,/V20_LOCAL\.pendingState\(\)/);
  assert.doesNotMatch(s,/RAS-EGX0\.1\/data\/v20\/native-current\.json/i);
  assert.doesNotMatch(s,/EXTERNAL_SOURCES\.v20/);
});
test('R04 disappears from full G12 scan while R05 remains for its own step',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R04_V20_NATIVE_PAGES'),false);
  assert.equal(x.dependencyIds.includes('R05_QUANT_EDGE_API'),true);
  assert.ok(x.runtimeLegacyDependencyCount<=4);
});
