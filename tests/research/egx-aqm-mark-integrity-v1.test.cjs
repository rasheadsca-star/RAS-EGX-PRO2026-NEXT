'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectMarks,eligibilityFromMarks}=require('../../scripts/research/egx-aqm-mark-integrity-v1.cjs');
test('missing candle after opening becomes a stale mark, not an invented close',()=>{
 const m=inspectMarks([{ticker:'ABC',qty:100,lastClose:10,lastMarkIndex:2}],3);
 assert.equal(m.stalePositionCount,1);assert.equal(m.stalePositionNotionalEgp,1000);
 assert.equal(m.stressUnrealizedLossEgp,50);
});
test('current dated quote is not a stale mark',()=>{assert.equal(inspectMarks([{ticker:'AAA',qty:2,lastClose:3,lastMarkIndex:5}],5).stalePositionCount,0)});
test('missing historical marks prevents publication of certified portfolio result',()=>{const q=eligibilityFromMarks({stalePositionSessions:1});assert.equal(q.completeSessionMarks,false);assert.equal(q.capitalPerformanceCertified,false)});
test('clean marks are still not independently certified price sources',()=>{const q=eligibilityFromMarks();assert.equal(q.completeSessionMarks,true);assert.equal(q.capitalPerformanceCertified,false)});

test('two missed quote sessions escalate hypothetical stress without pretending a sell was possible',()=>{
 const positions=[{ticker:'ABC',qty:100,lastClose:10,lastMarkIndex:2}];
 const a=inspectMarks(positions,3),b=inspectMarks(positions,4),c=inspectMarks(positions,10);
 assert.equal(a.stressUnrealizedLossEgp,50);
 assert.equal(b.stressUnrealizedLossEgp,100);
 assert.equal(c.stressUnrealizedLossEgp,300);
 assert.equal(c.staleDetails[0].hypotheticalHaircutPct,30);
});
