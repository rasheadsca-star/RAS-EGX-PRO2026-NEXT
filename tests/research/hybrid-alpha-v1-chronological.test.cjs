'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../../scripts/research/hybrid-alpha-v1-chronological.cjs');
const good={volumeRatio:2,momentum20Pct:3,avgTurnover20:150000,aboveSma50:true};
test('splits whole dates without leaking same-day symbols into opposite windows',()=>{
 const trades=[{ticker:'A',signalDate:'2026-10-01',variant:'breakout',netReturnPct:1,signalFeatures:good},{ticker:'B',signalDate:'2026-10-01',variant:'breakout',netReturnPct:2,signalFeatures:good},{ticker:'C',signalDate:'2026-10-02',variant:'breakout',netReturnPct:-1,signalFeatures:good}];
 const result=audit({trades});assert.equal(result.results[0].baseline.trades,2);assert.equal(result.results[1].baseline.trades,1);assert.equal(result.pass,true);
});
