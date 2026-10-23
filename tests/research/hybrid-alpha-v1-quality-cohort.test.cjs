'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit,eligible}=require('../../scripts/research/hybrid-alpha-v1-quality-cohort.cjs');
const f={volumeRatio:2,momentum20Pct:3,avgTurnover20:150000,aboveSma50:true};
test('filter uses stored point-in-time features only',()=>assert.equal(eligible({signalFeatures:f}),true));
test('rejects insufficient liquidity without applying lookahead',()=>assert.equal(eligible({signalFeatures:{...f,avgTurnover20:9000}}),false));
test('missing historical features remain unclassified',()=>assert.equal(eligible({}),null));
test('keeps accepted and rejected subsets of identical original trades',()=>{
 const x={trades:[{variant:'breakout',netReturnPct:4,status:'TARGET',signalFeatures:f},{variant:'breakout',netReturnPct:-5,status:'STOP',signalFeatures:{...f,momentum20Pct:-1}},{variant:'vcp',netReturnPct:3,status:'TARGET',signalFeatures:f}]};
 const r=audit(x);assert.equal(r.baseline.trades,2);assert.equal(r.accepted.trades,1);assert.equal(r.rejected.trades,1);assert.equal(r.pass,true);
});
