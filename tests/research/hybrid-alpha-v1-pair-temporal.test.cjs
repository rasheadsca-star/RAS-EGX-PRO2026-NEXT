'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../../scripts/research/hybrid-alpha-v1-pair-temporal.cjs');
const features={closePosition:0.85,extensionSma20Pct:3,atr14Pct:4};
test('partitions by distinct whole dates into chronological thirds',()=>{
 const trades=Array.from({length:9},(_,i)=>({ticker:'X',variant:'breakout',signalDate:'2026-10-'+String(i+1).padStart(2,'0'),netReturnPct:i%2?3:-4,signalFeatures:features}));
 const r=audit({trades});assert.equal(r.results.reduce((x,y)=>x+y.breakout.n,0),9);assert.equal(r.results.length,3);assert.equal(r.pass,true);
});
