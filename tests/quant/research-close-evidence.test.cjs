'use strict';
const assert=require('node:assert/strict');
const {buildResearchCloseMap}=require('../../scripts/quant/research-close-evidence.cjs');
const dataset=require('../../data/quant/research-crosschecked-close-volume-2026.json');
const marks=buildResearchCloseMap(dataset);
assert.equal(marks.size,5);
assert.equal(marks.get('FWRY|2026-05-06').close,20.43);
assert.equal(marks.get('FWRY|2026-05-06').volume,32855089);
assert.equal(marks.get('FWRY|2026-05-06').sourceGrade,'MULTI_SOURCE_RESEARCH');
assert.equal(marks.get('MASR|2026-05-06').volume,10847406);
assert.equal(marks.get('GIHD|2026-05-06').close,41.78);
assert.equal(marks.get('IDRE|2026-05-06').volume,892993);
assert.equal(marks.get('COMI|2026-05-14').close,134.51);
for(const mutation of [
 x=>x.observations[0].finalCloseEvidence.pop(),
 x=>x.observations[0].productionMergeAllowed=true,
 x=>x.observations[0].closeEgp=20.99,
 x=>x.observations[0].volumeShares=0,
 x=>x.observations[0].date='invalid',
 x=>x.status='PRODUCTION',
]){
 const copy=JSON.parse(JSON.stringify(dataset));mutation(copy);
 assert.throws(()=>buildResearchCloseMap(copy));
}
console.log('Research crosschecked-close gate: PASS');
