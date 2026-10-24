'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectPortfolio}=require('../../scripts/research/egx-top-four-portfolio-v1.cjs');
test('chooses at most four strongest same-day eligible signals',()=>{
 const t=Array.from({length:8},(_,i)=>({ticker:'T'+i,variant:'breakout_filtered',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-12',netReturnPct:1,signalScore:i}));
 const r=selectPortfolio(t,'breakout_filtered');assert.equal(r.selectedTrades,4);assert.deepEqual(r.selected.map(x=>x.ticker),['T7','T6','T5','T4']);
});
test('cannot reopen an active position or exceed four positions',()=>{
 const a=[{ticker:'ABC',variant:'trend_pullback',signalDate:'2026-01-01',exitDate:'2026-01-15',signalScore:5,netReturnPct:1},{ticker:'ABC',variant:'trend_pullback',signalDate:'2026-01-04',exitDate:'2026-01-20',signalScore:5,netReturnPct:1}];
 const r=selectPortfolio(a,'trend_pullback');assert.equal(r.selectedTrades,1);assert.equal(r.rejected.alreadyHeld,1);
});
test('final capital responds to selected trades not discarded ones',()=>{
 const t=[{ticker:'A',variant:'relative_momentum',signalDate:'2026-01-01',exitDate:'2026-01-11',signalScore:7,netReturnPct:8}];
 const r=selectPortfolio(t,'relative_momentum');assert.equal(r.totalReturnPct,2);
});
