'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {computeSignals,replay}=require('../../scripts/research/egx-aqm-research-v1.cjs');
test('an elevated breakout extension ceiling does not change pullback signals',()=>{
 const dates=[];for(let i=0;i<145;i++){const d=new Date(Date.UTC(2025,0,1+i));dates.push({date:d.toISOString().slice(0,10),open:100+i*.3,high:101+i*.3,low:99+i*.3,close:100+i*.3,volume:1000000,executable:true})}
 const u={AAA:dates};
 const baseline=computeSignals(u,{breakoutMaxDistanceAtr:1.5}),changed=computeSignals(u,{breakoutMaxDistanceAtr:3});
 assert.deepEqual(baseline.signals.filter(x=>x.variant==='aqm_pullback'),changed.signals.filter(x=>x.variant==='aqm_pullback'));
});
test('strict version remains blocked even if breakout ceiling is relaxed',()=>{
 const r=computeSignals({}, {marketMode:'strict',breakoutMaxDistanceAtr:3});
 assert.equal(r.signals.length,0);
});
