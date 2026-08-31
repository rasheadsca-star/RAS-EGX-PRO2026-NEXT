import test from 'node:test';import assert from 'node:assert/strict';import{validateBars,assertReady}from'../src/readiness.js';
const bars=Array.from({length:100},(_,i)=>({session:`2026-01-${String(i+1).padStart(2,'0')}`,open:10,high:11,low:9,close:10,volume:1000}));bars[99].session='2026-08-31';
test('valid complete data becomes READY',()=>assert.equal(validateBars(bars,{latestSession:'2026-08-31'}).state,'READY'));
test('bad OHLC fails closed',()=>{const x=structuredClone(bars);x[2].high=8;assert.equal(validateBars(x,{latestSession:'2026-08-31'}).state,'BLOCKED')});
test('cross-source conflict blocks recommendation path',()=>assert.equal(validateBars(bars,{latestSession:'2026-08-31',conflict:true}).state,'DATA_CONFLICT'));
test('stale last session is STALE',()=>assert.equal(validateBars(bars,{latestSession:'2026-09-01'}).state,'STALE'));
test('assertReady throws for non-ready',()=>assert.throws(()=>assertReady({ready:false,state:'STALE'}),/DATA_READINESS_BLOCK/));
