'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {scan,importsFrom,zoneFor,runtimeBoundaryManifest}=require('../../astra/certification/g13-architecture-baseline.cjs');
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
test('data-health uses public registry and no longer imports the decision pipeline directly',()=>{
  const r=scan();
  const xs=r.findings.items.filter(x=>x.file==='astra/data-health/g11-data-health.cjs');
  assert.equal(xs.some(x=>x.code==='DATA_HEALTH_DECISION_COUPLING'),false);
  assert.equal(xs.some(x=>x.code==='FORBIDDEN_LOGICAL_IMPORT'),false);
  assert.equal(xs.some(x=>x.target==='astra/strategies/g08-final-overlay.cjs'),false);
  assert.ok(r.graph.edges.some(e=>e.from==='astra/data-health/g11-data-health.cjs'&&e.target==='astra/strategies/strategy-registry.cjs'));
});
test('active adapters are explicit registered boundaries outside the 30 business modules',()=>{
  assert.equal(zoneFor('astra/runtime/bridges/v19-local.cjs').kind,'registered-adapter-boundary');
  assert.equal(zoneFor('deploy/rc2-safe-shell/api/index.js').kind,'registered-adapter-boundary');
  assert.equal(zoneFor('gann-fusion-x/scripts/sync-sepa.cjs').kind,'registered-adapter-boundary');
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

test('private strategy implementation may compose internally but active consumers cannot bypass public facades',()=>{
  const r=scan();
  const directPrivate=r.findings.items.filter(x=>x.code==='DIRECT_INTERNAL_IMPLEMENTATION_ACCESS'&&x.targetZone==='strategy-core-private');
  assert.equal(directPrivate.length,0,JSON.stringify(directPrivate,null,2));
  const guarded=[
    'astra/certification/g08-certify.cjs',
    'astra/certification/g09-certify.cjs',
    'astra/pipeline/g09-unified-decision-pipeline.cjs',
    'astra/data-health/g11-data-health.cjs',
    'astra/runtime/bridges/v19-local.cjs',
    'astra/runtime/bridges/v20-local.cjs',
    'astra/runtime/bridges/sepa-local.cjs',
    'astra/runtime/bridges/tfe-local.cjs'
  ];
  for(const file of guarded){
    const src=fs.readFileSync(file,'utf8');
    assert.equal(/require\s*\(\s*['"][^'"]*\/g08-[^'"]*\.cjs['"]\s*\)/.test(src),false,file);
  }
});
test('historical parity control remains the only non-facade policy exception for private G08 imports',()=>{
  const r=scan();
  const privateEdges=r.graph.edges.filter(e=>e.targetZone==='strategy-core-private');
  const illegal=privateEdges.filter(e=>{
    const z=zoneFor(e.from);
    return !(z.kind==='private-implementation'||z.id==='strategy-registry'||z.id==='strategy-runner'||z.id==='parity-control');
  });
  assert.deepEqual(illegal,[]);
});

test('Family 3 isolates certification and data-health from direct business implementation imports',()=>{
  const r=scan();
  assert.equal(r.findings.items.filter(x=>x.code==='FORBIDDEN_LOGICAL_IMPORT').length,0);
  assert.equal(r.findings.items.filter(x=>x.code==='DATA_HEALTH_DECISION_COUPLING').length,0);
  const dh=fs.readFileSync('astra/data-health/g11-data-health.cjs','utf8');
  assert.equal(dh.includes("require('../pipeline/g09-unified-decision-pipeline.cjs')"),false);
  for(const p of ['astra/certification/g08-certify.cjs','astra/certification/g09-certify.cjs','astra/certification/g11-certify.cjs','astra/certification/g11-derived-build-failures.cjs','astra/certification/g11-source-dispositions.cjs']){
    const s=fs.readFileSync(p,'utf8');
    assert.equal(/require\(['"]\.\.\/(?:pipeline|strategies|data-health)\//.test(s),false,p);
  }
});

test('Family 4 registry covers exactly the eight active adapters without changing target module count',()=>{
  const m=runtimeBoundaryManifest();
  assert.equal(m.boundaries.length,8);
  assert.equal(new Set(m.boundaries.map(x=>x.file)).size,8);
  assert.equal(m.ioProviders.length,3);
  assert.equal(m.policy.targetArchitectureModulesUnchanged,30);
  assert.equal(m.productionCutover,false);
  for(const b of m.boundaries)assert.equal(zoneFor(b.file).kind,'registered-adapter-boundary',b.file);
  for(const p of m.ioProviders)assert.equal(zoneFor(p.file).kind,'io-boundary',p.file);
});
test('Family 4 registered adapters have no unregistered/direct IO/network/data-path findings',()=>{
  const r=scan(),m=runtimeBoundaryManifest();
  const registered=new Set(m.boundaries.map(x=>x.file));
  const blocked=new Set(['UNREGISTERED_ACTIVE_LAYER','DIRECT_FILE_IO_BYPASS','DIRECT_NETWORK_ACCESS','DIRECT_DATA_PATH_COUPLING']);
  const bad=r.findings.items.filter(x=>registered.has(x.file)&&blocked.has(x.code));
  assert.deepEqual(bad,[]);
  assert.equal(r.findings.items.filter(x=>x.code==='UNREGISTERED_ACTIVE_LAYER').length,0);
  assert.equal(r.findings.items.filter(x=>x.code==='DIRECT_FILE_IO_BYPASS').length,0);
  assert.equal(r.findings.items.filter(x=>x.code==='DIRECT_NETWORK_ACCESS').length,0);
});
test('Family 4 moves concrete IO ownership behind explicit providers',()=>{
  const app=fs.readFileSync('astra/runtime/v18/app.js','utf8');
  const client=fs.readFileSync('astra/runtime/v18/resource-client.js','utf8');
  const api=fs.readFileSync('deploy/rc2-safe-shell/api/index.js','utf8');
  const sync=fs.readFileSync('gann-fusion-x/scripts/sync-sepa.cjs','utf8');
  const q=fs.readFileSync('astra/runtime/bridges/quant-edge-archive.cjs','utf8');
  assert.equal(/\bfetch\s*\(/.test(app),false);
  assert.equal(/docs\/astra\//.test(app),false);
  assert.equal(/\bfetch\s*\(/.test(client),true);
  assert.equal(/https?:\/\//i.test(client),false);
  assert.equal(/\b(?:readFileSync|writeFileSync|existsSync)\s*\(/.test(api),false);
  assert.equal(/\b(?:readFileSync|writeFileSync|existsSync)\s*\(/.test(sync),false);
  assert.equal(/docs\/astra\//.test(q),false);
});
