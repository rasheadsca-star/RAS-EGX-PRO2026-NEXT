'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');

test('R05 cut removes QUANT_EDGE live API and any network fetch from consensus builder',()=>{
  const s=fs.readFileSync(path.join(root,'scripts/stable/v16-main-app-consensus.cjs'),'utf8');
  assert.match(s,/QUANT_ARCHIVE\.state\(\)/);
  assert.match(s,/LOCAL_ARCHIVE_ONLY/);
  assert.doesNotMatch(s,/quant-edge-shadow/i);
  assert.doesNotMatch(s,/fetch\s*\(/);
});
test('R05 cut cannot grant current QUANT_EDGE vote',()=>{
  const q=require('../../astra/runtime/bridges/quant-edge-archive.cjs').state();
  assert.equal(q.blocked,true);
  assert.equal(q.freshness.isFresh,false);
  assert.deepEqual(q.recommendations,[]);
  assert.equal(q.liveDecisionInfluence,0);
  assert.equal(q.algorithmicallyReproduced,false);
});
test('R05 disappears from full G12 scan',()=>{
  const x=scanLegacyDependencies(root);
  assert.equal(x.dependencyIds.includes('R05_QUANT_EDGE_API'),false);
  assert.ok(x.runtimeLegacyDependencyCount<=3);
});
