'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executable,tradingWindow,tradeForwardWindow}=require('../../scripts/research/egx-executable-session-series-v1.cjs');
const bars=Array.from({length:56},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),open:100+i,high:101+i,low:99+i,close:100+i,volume:1000,executable:true}));
test('exclude zero-volume bars even when their close is misleading',()=>{
 const poisoned=bars.slice();poisoned.splice(23,0,{...bars[23],close:100000,volume:0,executable:false});
 assert.deepEqual(tradingWindow(poisoned,poisoned.length-1,55),tradingWindow(bars,bars.length-1,55));
 assert.equal(executable(poisoned[23]),false);
});
test('signals require 55 actually traded candles, no synthetic padding',()=>{const short=bars.slice(0,54);short.push({close:100,volume:0,executable:false});assert.equal(tradingWindow(short,short.length-1,55),null)});
test('no lookahead when later prices change',()=>{const original=tradingWindow(bars,54,55);const changed=bars.map((x,i)=>i>54?{...x,close:-999}:x);assert.deepEqual(tradingWindow(changed,54,55),original)});
test('holding period counts executable sessions rather than reference bars',()=>{const a=bars.slice(0,4);a[1]={...a[1],executable:false,volume:0};assert.deepEqual(tradeForwardWindow(a,0,3).map(x=>x.close),[100,102,103])});

test('momentum and 20/50-day trend signals invariant to injected zero-volume bar',()=>{
 const {features}=require('../../scripts/research/egx-strategy-challengers-v1.cjs');
 const one=bars.map(x=>({...x})),two=bars.map(x=>({...x}));two.splice(20,0,{...two[20],close:90000,open:90000,high:90001,low:89999,volume:0,executable:false});
 const f1=features(one,54),f2=features(two,55);
 assert.deepEqual(f2,f1);
});
test('zero-volume latest bar never creates a signal',()=>{
 const {features}=require('../../scripts/research/egx-strategy-challengers-v1.cjs');
 assert.equal(features([...bars.slice(0,55),{...bars[55],volume:0,executable:false}],55),null);
});
