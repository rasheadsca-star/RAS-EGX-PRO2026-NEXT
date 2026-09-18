'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {scan,importsFrom,zoneFor}=require('../../astra/certification/g13-architecture-baseline.cjs');
const registry=require('../../astra/strategies/strategy-registry.cjs');
const runner=require('../../astra/strategies/strategy-runner.cjs');
const privateCore=require('../../astra/strategies/g08-final-overlay.cjs');

test('G13 baseline preserves the certified G01-G12 boundary and keeps G13 pending',()=>{
  const r=scan();
  assert.equal(r.priorGateBoundary.g01ThroughG12Green,true);
  assert.equal(r.priorGateBoundary.g12Status,'GREEN');
  assert.equal(r.priorGateBoundary.runtimeLegacyDependencyCount,0);
  assert.equal(r.priorGateBoundary.dependenciesClosed,'8/8');
  assert.equal(r.priorGateBoundary.productionCutover,false);
  assert.equal(r.gateStatus,'PENDING');
  assert.equal(r.productionCutover,false);
  assert.equal(r.contract.logicalModuleCount,30);
});
test('G13 baseline builds a real static source/import graph',()=>{
  const r=scan();
  assert.ok(r.scanScope.sourceFiles>0);
  assert.ok(r.dependencyGraph.nodeCount>0);
  assert.ok(r.dependencyGraph.edgeCount>0);
  assert.ok(r.graph.edges.some(e=>e.classification==='relative-static-import'));
});
test('G13 baseline distinguishes physical-boundary collapse from missing mapping',()=>{
  const r=scan();
  assert.ok(r.findings.items.some(x=>x.code==='PHYSICAL_BOUNDARY_COLLAPSE'));
  assert.ok(r.findings.items.some(x=>x.code==='NO_DEDICATED_IMPLEMENTATION_BOUNDARY'));
});
test('data-health registry access uses public facade while remaining pipeline coupling stays visible',()=>{
  const r=scan();
  const xs=r.findings.items.filter(x=>x.file==='astra/data-health/g11-data-health.cjs');
  assert.ok(xs.some(x=>x.code==='DATA_HEALTH_DECISION_COUPLING'));
  assert.ok(xs.some(x=>x.code==='FORBIDDEN_LOGICAL_IMPORT'));
  assert.equal(xs.some(x=>x.target==='astra/strategies/g08-final-overlay.cjs'),false);
  assert.ok(r.graph.edges.some(e=>e.from==='astra/data-health/g11-data-health.cjs'&&e.target==='astra/strategies/strategy-registry.cjs'));
});
test('active adapters are explicit baseline zones rather than silently treated as target modules',()=>{
  assert.equal(zoneFor('astra/runtime/bridges/v19-local.cjs').kind,'active-unregistered-layer');
  assert.equal(zoneFor('deploy/rc2-safe-shell/api/index.js').kind,'active-unregistered-layer');
  assert.equal(zoneFor('gann-fusion-x/scripts/sync-sepa.cjs').kind,'active-unregistered-layer');
});
test('import parser handles commonjs and esm static imports',()=>{
  const x=importsFrom("const a=require('../x.cjs');\nimport b from './y.js';\nimport 'node:fs';");
  assert.deepEqual(new Set(x),new Set(['../x.cjs','./y.js','node:fs']));
});
test('baseline scanner does not mutate gate state',()=>{
  const before=fs.readFileSync('04_ACCEPTANCE_GATES.json','utf8');
  scan();
  const after=fs.readFileSync('04_ACCEPTANCE_GATES.json','utf8');
  assert.equal(after,before);
});

test('strategy registry and runner are dedicated public architecture boundaries',()=>{
  assert.deepEqual(zoneFor('astra/strategies/strategy-registry.cjs').modules,['strategy-registry']);
  assert.equal(zoneFor('astra/strategies/strategy-registry.cjs').kind,'target-module');
  assert.deepEqual(zoneFor('astra/strategies/strategy-runner.cjs').modules,['strategy-runner']);
  assert.equal(zoneFor('astra/strategies/strategy-runner.cjs').kind,'target-module');
  assert.equal(zoneFor('astra/strategies/g08-final-overlay.cjs').kind,'private-implementation');
});
test('public strategy facades preserve certified G08 descriptor and execution semantics',()=>{
  assert.deepEqual(registry.listStrategyIds(),Object.keys(privateCore.SPECS));
  for(const id of registry.listStrategyIds())assert.equal(registry.getStrategyDescriptor(id),privateCore.SPECS[id]);
  const input={snapshot:{snapshotId:'G13-FACADE',ticker:'COMI',sessionDate:'2026-09-17',validationStatus:'INVALID'},history:[]};
  assert.deepEqual(runner.executeStrategy('TREND_FOLLOW',input),privateCore.executeStrategy('TREND_FOLLOW',input));
});
test('first G13 remediation family removes direct G08 implementation access from selected consumers',()=>{
  const files=[
    'astra/data-health/g11-data-health.cjs',
    'astra/runtime/bridges/v19-local.cjs',
    'astra/runtime/bridges/v20-local.cjs',
    'astra/runtime/bridges/sepa-local.cjs',
    'astra/runtime/bridges/tfe-local.cjs'
  ];
  for(const file of files){
    const src=fs.readFileSync(file,'utf8');
    assert.equal(src.includes('g08-final-overlay.cjs'),false,file);
  }
});
