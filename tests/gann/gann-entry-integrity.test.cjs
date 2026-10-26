'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../../gann-fusion-x/review/backtest.js');
const signal={ticker:'TEST',sessionDate:'2026-10-20',plan:{entryLow:10,entryHigh:11,stopLoss:9,target1:13}};
const bar=(date,open,low,high,close)=>({date,open,low,high,close});
test('no trade when entry range was never touched',()=>{
 const res=evaluate([signal],{TEST:[bar('2026-10-20',12,12,12,12),bar('2026-10-21',12,11.5,12.5,12)]});
 assert.equal(res.signals,0);assert.equal(res.skippedReasons[0].reason,'ENTRY_NOT_TRIGGERED');
});
test('gap across zone with unobservable entry is not invented',()=>{
 const res=evaluate([signal],{TEST:[bar('2026-10-20',12,12,12,12),bar('2026-10-21',12,10.5,12.5,12)]});
 assert.equal(res.evaluable,0);assert.equal(res.skippedReasons[0].reason,'ENTRY_TOUCHED_PRICE_UNKNOWN');
});
test('same candle stop and target is not treated as verified win',()=>{
 const res=evaluate([signal],{TEST:[bar('2026-10-20',12,12,12,12),bar('2026-10-21',10.5,8.5,13.5,10)]});
 assert.equal(res.ambiguous,1);assert.equal(res.evaluable,0);assert.equal(res.winRatePct,null);
});
test('valid open-in-range setup is counted and costs applied',()=>{
 const res=evaluate([signal],{TEST:[bar('2026-10-20',12,12,12,12),bar('2026-10-21',10.5,10,12,11),bar('2026-10-22',12,11,14,13)]});
 assert.equal(res.evaluable,1);assert.equal(res.wins,1);assert.equal(res.rows[0].entry,10.5);assert.equal(res.rows[0].outcome,'TARGET');
});
