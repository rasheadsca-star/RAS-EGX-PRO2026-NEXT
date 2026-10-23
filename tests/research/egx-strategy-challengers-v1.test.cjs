'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {features,backtest}=require('../../scripts/research/egx-strategy-challengers-v1.cjs');
test('insufficient history gives no features',()=>assert.equal(features([],20),null));
test('no cross-sectional momentum trades with fewer than 15 peers',()=>{const rows=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:100+i,high:101+i,low:99+i,close:100+i,volume:2000}));const r=backtest({ABC:rows});assert.equal(r.trades.filter(x=>x.variant==='relative_momentum').length,0)});
test('unresolved end-of-sample trades are not counted as closed',()=>{const rows=Array.from({length:70},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:100+i*.3,high:101+i*.3,low:99+i*.3,close:100+i*.3,volume:2000}));const r=backtest({ABC:rows});assert.ok(r.trades.every(x=>x.exitDate>=x.entryDate))});
