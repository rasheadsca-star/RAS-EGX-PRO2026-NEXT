'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {portfolio}=require('../../scripts/research/egx-pullback-breadth-mtm-diagnostic-v1.cjs');
test('four-position portfolio with daily marks reflects open losses',()=>{
 const rows=Array.from({length:5},(_,i)=>({date:'2026-01-0'+(i+1),open:100,close:i===2?80:100,high:101,low:79,volume:1000}));
 const trades=[{ticker:'AAA',variant:'trend_pullback',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-05',netReturnPct:1,signalScore:75}];
 const gate=new Map([['2026-01-01',{pass:true}]]);
 const result=portfolio({AAA:rows},trades,gate);assert.equal(result.executedTrades,1);assert.ok(result.markToMarketMaxDrawdownPct>4);
});
test('rejects entries without valid breadth regime',()=>{const rows=[{date:'2026-01-02',open:100,close:101}];const x=portfolio({AAA:rows},[{ticker:'AAA',variant:'trend_pullback',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-02',netReturnPct:1,signalScore:75}],new Map());assert.equal(x.executedTrades,0)});
