'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));

test('G13 persisted regression preserves G01-G13 GREEN with G14 pending',()=>{
  const gates=read('04_ACCEPTANCE_GATES.json').gates;
  const map=new Map(gates.map(x=>[x.id,x.status]));
  for(let n=1;n<=13;n++)assert.equal(map.get('G'+String(n).padStart(2,'0')),'GREEN');
  assert.equal(map.get('G14'),'PENDING');
});

test('G13 persisted certification has zero findings and all 30 modules dedicated',()=>{
  const c=read('docs/astra/G13_CERTIFICATION.json');
  assert.equal(c.status,'GREEN');
  assert.equal(c.architecture.findingsTotal,0);
  assert.equal(c.architecture.highFindings,0);
  assert.equal(c.architecture.mediumFindings,0);
  assert.equal(c.architecture.logicalModules,30);
  assert.equal(c.architecture.dedicatedModules,30);
  assert.ok(c.architecture.allModules.every(x=>x.status==='DEDICATED_ZONE'));
});

test('G13 persisted certification preserves G12 zero-legacy and pre-production boundary',()=>{
  const c=read('docs/astra/G13_CERTIFICATION.json');
  assert.equal(c.g12Boundary.status,'GREEN');
  assert.equal(c.g12Boundary.runtimeLegacyDependencyCount,0);
  assert.equal(c.g12Boundary.dependenciesClosed,8);
  assert.equal(c.g12Boundary.dependenciesTotal,8);
  assert.equal(c.g12Boundary.strictScanClean,true);
  assert.equal(c.g12Boundary.strictScanMatches,0);
  assert.equal(c.productionCutover,false);
  assert.equal(c.nextGate,'G14');
  assert.equal(c.nextGateStatus,'PENDING');
});
