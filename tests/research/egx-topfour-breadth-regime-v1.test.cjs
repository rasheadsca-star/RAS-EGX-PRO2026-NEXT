'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {breadthByDate,assess}=require('../../scripts/research/egx-topfour-breadth-regime-v1.cjs');
test('market breadth reflects only same-day and trailing closes',()=>{const rows=Array.from({length:57},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:100+i,close:100+i,high:101+i,low:99+i,volume:10000}));const v=breadthByDate({AAA:rows});assert.equal(v.get(rows[54].date).eligible,1);assert.equal(v.get(rows[54].date).pass,false);});
test('regime blocks otherwise eligible top-four selections',()=>{const trade={variant:'breakout_filtered',ticker:'AAA',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-12',signalScore:80,netReturnPct:8};const r=assess({trades:[trade]},new Map([['2026-01-01',{pass:false}]]));assert.equal(r.baseline[0].selectedTrades,1);assert.equal(r.filtered[0].selectedTrades,0)});
