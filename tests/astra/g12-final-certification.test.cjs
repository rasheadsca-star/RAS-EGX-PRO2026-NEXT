'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));

test('G12 final pre-certification invariants are all satisfied',()=>{
  const scan=scanLegacyDependencies(root);
  const plan=read('docs/astra/LEGACY_REMOVAL_PLAN.json');
  const gates=read('04_ACCEPTANCE_GATES.json');
  const map=new Map(gates.gates.map(x=>[x.id,x.status]));
  for(let n=1;n<=11;n++)assert.equal(map.get('G'+String(n).padStart(2,'0')),'GREEN');
  assert.equal(scan.runtimeLegacyDependencyCount,0);
  assert.equal(scan.clean,true);
  assert.equal(plan.dependencies.length,8);
  assert.ok(plan.dependencies.every(x=>x.status==='CLOSED'));
});
test('G12 final boundary preserves G11 and forbids production cutover',()=>{
  const t=read('docs/astra/G11_TEST_EVIDENCE.json');
  const i=read('docs/astra/G11_DATA_HEALTH_ISSUES.json');
  const g=read('docs/astra/G11_CURRENT_UNIVERSE_GAPS.json');
  const p=read('docs/astra/G11_CURRENT_PIPELINE_RUN.json');
  assert.equal(t.status,'PASS');
  assert.equal(t.g11Tests,58);
  assert.equal(Number(i.criticalUnresolved||0),0);
  assert.equal(Number(i.highUnresolved??i.highProductionRelevantUnresolved??0),0);
  assert.equal(Number(g.gapCount??g.currentUniverseGapCount??0),0);
  assert.equal(p.productionCutover,false);
  assert.equal(p.legacyNetworkCalls,0);
});
