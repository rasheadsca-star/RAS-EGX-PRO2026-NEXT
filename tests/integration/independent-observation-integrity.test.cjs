'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const data=JSON.parse(fs.readFileSync('unified-console/independent-paper.json','utf8'));
test('paper status cannot contradict executable or certified recommendations',()=>{
 assert.equal(data.mode,'PAPER_ONLY');
 if(data.executable!==true){assert.equal((data.recommendations||[]).length,0,'blocked source must publish zero trade recommendations')}
 if(data.status==='RESEARCH_ONLY_PRICE_GATE_BLOCKED')assert.equal((data.verifiedCandidates||[]).length,0);
});
test('observations are not trade signals and are session identified',()=>{
 for(const x of data.datedPriceObservations||[]){
  assert.match(x.session,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(x.state,'DATED_PRICE_OBSERVATION_NOT_A_SIGNAL');
  assert.equal(x.evidenceLevel,'DATED_PROVIDER_EVIDENCE');
  assert.ok(Number.isFinite(Number(x.close))&&Number(x.close)>0);
 }
});
test('failed lookback verification is never presented as indicator ready',()=>{
 for(const x of data.datedPriceObservations||[]){
  if(Array.isArray(x.indicatorBlockers)&&x.indicatorBlockers.length>0)assert.equal(x.indicatorReady,false);
 }
});
