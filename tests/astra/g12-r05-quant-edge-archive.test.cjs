'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const q=require('../../astra/runtime/bridges/quant-edge-archive.cjs');
const root=path.resolve(__dirname,'../..');

test('R05 QUANT_EDGE replacement is historical-output-only and never pretends algorithmic reconstruction',()=>{
  const x=q.state();
  assert.equal(x.disposition,'HISTORICAL_OUTPUT_ONLY');
  assert.equal(x.runtimeMode,'HISTORICAL_OUTPUT_ONLY_NO_LIVE_CALL');
  assert.equal(x.algorithmicallyReproduced,false);
  assert.equal(x.liveDecisionInfluence,0);
  assert.equal(x.liveStrategyAvailable,false);
  assert.equal(x.blocked,true);
  assert.deepEqual(x.recommendations,[]);
});

test('R05 QEDGE G10 output-integrity oracle is exact',()=>{
  const g10=JSON.parse(fs.readFileSync(path.join(root,'docs/astra/G10_PARITY_RESULTS.json'),'utf8'));
  const rows=g10.results||g10.cases||[];
  const row=rows.find(x=>x.caseId==='QEDGE-OUTPUT-INTEGRITY');
  assert.ok(row);
  assert.equal(row.comparisonStatus,'EXACT_MATCH');
  const m=Object.fromEntries(row.fields.map(x=>[x.field,x.actual]));
  assert.equal(m.disposition,'HISTORICAL_OUTPUT_ONLY');
  assert.equal(m.algorithmicallyReproduced,false);
  assert.equal(m.liveDecisionInfluence,0);
});

test('R05 capability registry says QUANT_EDGE is unrecoverable with no formula inference',()=>{
  const c=JSON.parse(fs.readFileSync(path.join(root,'docs/astra/ENGINE_CAPABILITY_COVERAGE.json'),'utf8'));
  const e=c.engines.find(x=>x.engineId==='QUANT_EDGE');
  assert.ok(e);
  assert.equal(e.originalStatus,'unrecoverable');
  assert.equal(e.disposition,'HISTORICAL_OUTPUT_ONLY');
  assert.match(e.notes,/No formula inference/i);
  const src=fs.readFileSync(path.join(root,'astra/runtime/bridges/quant-edge-archive.cjs'),'utf8');
  assert.doesNotMatch(src,/https?:\/\/|fetch\s*\(/i);
});
