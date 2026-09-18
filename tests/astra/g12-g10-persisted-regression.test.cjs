'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));

test('persisted G10 certification remains GREEN and fully source-covered',()=>{
  const gates=read('04_ACCEPTANCE_GATES.json');
  const t=read('docs/astra/G10_TEST_EVIDENCE.json');
  const p=read('docs/astra/G10_PARITY_RESULTS.json');
  const c=read('docs/astra/G10_PARITY_COVERAGE.json');
  assert.equal(gates.gates.find(x=>x.id==='G10').status,'GREEN');
  assert.equal(t.status,'PASS');
  assert.equal(t.g10Tests,25);
  assert.equal(p.status,'GREEN');
  assert.equal(p.metrics.identifiedStrategyVersions,33);
  assert.equal(p.metrics.implementationSourceCoverage,33);
  assert.equal(p.metrics.unresolvedMismatches,0);
  assert.equal(p.metrics.fieldLevelGoldenComparisons.mismatch,0);
  assert.equal(c.metrics?.strategiesAccounted??c.strategiesAccounted,18);
});

test('persisted G10 production and QUANT_EDGE invariants remain intact',()=>{
  const a=read('docs/astra/PRODUCTION_ELIGIBILITY_AUDIT.json');
  const p=read('docs/astra/G10_PARITY_RESULTS.json');
  assert.equal(a.status,'PASS');
  assert.equal(a.productionEligibleCount,1);
  assert.deepEqual(a.productionEligibleStrategyIds,['PORTFOLIO_BASKET_EQUAL_WEIGHT']);
  assert.equal(a.historicalParityEligibleCount,18);
  assert.equal(p.quantEdge.parityMode,'OUTPUT_INTEGRITY_ONLY');
  assert.equal(p.quantEdge.algorithmicallyReproduced,false);
  assert.equal(p.legacyNetworkCalls,0);
  assert.equal(p.productionEligibilityInvariant,true);
});
