'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {buildCertification}=require('../../astra/certification/g13-certify.cjs');

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));

test('G13 final candidate starts from G01-G12 GREEN with G13 pending and G14 pending',()=>{
  const gates=read('04_ACCEPTANCE_GATES.json').gates;
  const map=new Map(gates.map(x=>[x.id,x.status]));
  for(let n=1;n<=12;n++)assert.equal(map.get('G'+String(n).padStart(2,'0')),'GREEN');
  assert.equal(map.get('G13'),'PENDING');
  assert.equal(map.get('G14'),'PENDING');
});
test('G13 final certification candidate has zero findings and all 30 modules dedicated',()=>{
  const prior=process.env.G13_REGRESSION_STATUS;
  process.env.G13_REGRESSION_STATUS='PASS';
  const c=buildCertification();
  if(prior===undefined)delete process.env.G13_REGRESSION_STATUS;else process.env.G13_REGRESSION_STATUS=prior;
  assert.equal(c.status,'GREEN',JSON.stringify(c.failedChecks));
  assert.equal(c.architecture.findingsTotal,0);
  assert.equal(c.architecture.highFindings,0);
  assert.equal(c.architecture.mediumFindings,0);
  assert.equal(c.architecture.logicalModules,30);
  assert.equal(c.architecture.dedicatedModules,30);
  assert.ok(c.architecture.allModules.every(x=>x.status==='DEDICATED_ZONE'));
});
test('G13 final certification preserves G12 zero-legacy and pre-production boundary',()=>{
  const prior=process.env.G13_REGRESSION_STATUS;
  process.env.G13_REGRESSION_STATUS='PASS';
  const c=buildCertification();
  if(prior===undefined)delete process.env.G13_REGRESSION_STATUS;else process.env.G13_REGRESSION_STATUS=prior;
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
