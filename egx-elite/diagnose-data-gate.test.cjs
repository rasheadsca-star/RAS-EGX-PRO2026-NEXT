'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {diagnose}=require('./diagnose-data-gate.cjs');
const price={expectedSession:'2026-10-22',acceptedRows:197,sampleRejected:[{ticker:'ESRS',reason:'SOURCE_SESSION_MISMATCH'}]};
const handoff={sessionDate:'2026-10-22',expectedSession:'2026-10-22'};
const app={sourceDecision:{session:'2026-10-21'}};
const second={expectedSession:'2026-08-24',records:{}};
test('insufficient accepted rows and stale evidence are rejected',()=>{
 const x=diagnose(price,handoff,app,second);assert.equal(x.shortfall,3);assert.equal(x.eligibleForRegeneration,false);assert.equal(x.secondSourceEvidenceCurrent,false);
});
test('same-session bars and handoff are necessary',()=>{
 const x=diagnose({...price,acceptedRows:200},handoff,app,{...second,expectedSession:price.expectedSession});assert.equal(x.eligibleForRegeneration,false);
});
test('all gate requirements satisfied',()=>{
 const x=diagnose({...price,acceptedRows:200},handoff,{sourceDecision:{session:price.expectedSession}},{...second,expectedSession:price.expectedSession});assert.equal(x.eligibleForRegeneration,true);
});
test('does not mutate original inputs',()=>{
 const p=JSON.stringify(price);diagnose(price,handoff,app,second);assert.equal(JSON.stringify(price),p);
});
