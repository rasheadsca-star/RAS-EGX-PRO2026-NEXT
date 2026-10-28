'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateOpportunity}=require('../../scripts/astra/g22-postclose-refresh.cjs');
const good=()=>({ticker:'TEST',rank:1,entryPlan:{low:10,high:11},stopLoss:9,targets:[13],risk:{entry:11,stopLoss:9,targets:[13]},evidence:[{sourceRef:'G11-CAN-TEST-2026-10-27'}],strategyExecutionRef:'S1',trace:{inputSnapshotRefs:['G11-CAN-TEST-2026-10-27']}});
test('complete current sourced entry stop targets pass',()=>assert.doesNotThrow(()=>validateOpportunity(good(),'2026-10-27')));
test('missing malformed contradictory and stale opportunities fail closed',()=>{
 for(const mutate of [r=>delete r.entryPlan,r=>r.stopLoss=null,r=>r.targets=[],r=>r.entryPlan.high=Infinity,r=>r.entryPlan.low=0,r=>r.stopLoss=11,r=>r.risk.entry=10,r=>r.targets=[false],r=>r.evidence=[],r=>r.trace.inputSnapshotRefs=['G11-CAN-TEST-2026-10-26']]){
 const r=good();mutate(r);assert.throws(()=>validateOpportunity(r,'2026-10-27'));
 }
});
