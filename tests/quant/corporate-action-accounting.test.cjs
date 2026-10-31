'use strict';
const assert=require('node:assert/strict');
const {applyShareRatio,crossingActions}=require('../../scripts/quant/corporate-action-accounting.cjs');
for(const ratio of [3.2288508184,4]){
 const before={units:100,lastPrice:160};
 const after=applyShareRatio(before,ratio);
 assert(Math.abs(before.units*before.lastPrice-after.units*after.lastPrice)<1e-8);
 assert.equal(after.units,100*ratio);
 assert.equal(before.units,100);
}
assert.throws(()=>applyShareRatio({units:10,lastPrice:10},0));
const actions=[{ticker:'DTPP',effectiveDate:'2026-10-22',type:'FORWARD_SPLIT',shareRatio:4}];
const trades=[{ticker:'DTPP',entryDate:'2026-10-20',exitDate:'2026-10-23'},{ticker:'DTPP',entryDate:'2026-10-23',exitDate:'2026-10-26'},{ticker:'FWRY',entryDate:'2026-10-20',exitDate:'2026-10-23'}];
const hits=crossingActions(trades,actions);
assert.equal(hits.length,1);assert.equal(hits[0].status,'UNRECONCILED_POSITION_AND_PRICE_BASIS');
console.log('Corporate actions unit/value accounting and event exposure: PASS');
