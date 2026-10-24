'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../../scripts/research/egx-strategy-top-four-tournament-v1.cjs');
test('each strategy gets its own top four ranked by pre-existing score',()=>{
 const trades=Array.from({length:7},(_,i)=>({ticker:'S'+i,variant:'breakout_filtered',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-10',signalScore:70+i,netReturnPct:5}));
 const m=evaluate({trades}).models[0];assert.deepEqual(m.topFourPerDecisionDay[0].topFour.map(x=>x.ticker),['S6','S5','S4','S3']);assert.equal(m.portfolio.selectedTrades,4);
});
test('different strategies are not forced to own the same tickers',()=>{
 const trades=[{ticker:'A',variant:'breakout_filtered',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-10',signalScore:72,netReturnPct:1},{ticker:'B',variant:'trend_pullback',signalDate:'2026-01-01',entryDate:'2026-01-02',exitDate:'2026-01-10',signalScore:73,netReturnPct:1}];
 const r=evaluate({trades});assert.equal(r.models[0].topFourPerDecisionDay[0].topFour[0].ticker,'A');assert.equal(r.models[2].topFourPerDecisionDay[0].topFour[0].ticker,'B');
});

test('no trades below the minimum score and permit fewer than four',()=>{const trades=[{ticker:'A',variant:'breakout_filtered',signalDate:'2026-01-01',exitDate:'2026-01-10',signalScore:59,netReturnPct:9},{ticker:'B',variant:'breakout_filtered',signalDate:'2026-01-01',exitDate:'2026-01-10',signalScore:61,netReturnPct:-1}];const result=evaluate({trades}).models[0];assert.equal(result.totalCandidateSignals,1);assert.equal(result.portfolio.selectedTrades,1);assert.equal(result.topFourPerDecisionDay[0].topFour[0].ticker,'B')});
