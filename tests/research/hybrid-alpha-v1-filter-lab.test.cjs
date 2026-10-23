'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decision,audit}=require('../../scripts/research/hybrid-alpha-v1-filter-lab.cjs');
const ok={closePosition:0.8,extensionSma20Pct:3,atr14Pct:4};
test('uses frozen signal features only',()=>assert.deepEqual(decision({signalFeatures:ok}),{quality:true,extension:true,volatility:true}));
test('missing fields are unclassified rather than passing',()=>assert.equal(decision({}),null));
test('filters partition exactly the same breakout trades',()=>{const r=audit({trades:[{variant:'breakout',netReturnPct:3,status:'TARGET',signalFeatures:ok},{variant:'breakout',netReturnPct:-5,status:'STOP',signalFeatures:{...ok,closePosition:0.3}}]});assert.equal(r.filters.quality.accepted.n,1);assert.equal(r.filters.quality.rejected.n,1);assert.equal(r.pass,true)});
