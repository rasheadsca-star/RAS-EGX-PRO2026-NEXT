'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePlan:evaluate,summarize}=require('../../scripts/astra/research/execution-replay.cjs');
const signal={ticker:'TEST',signalDate:'2026-09-20',entryLow:10,entryHigh:10.1,stop:9,target1:12};
const policy={entryExpirySessions:3,maxHoldSessions:10,roundTripCostPct:0.6};
const first={date:'2026-09-21',open:10,high:10.5,low:9.5,close:10.2};
const second={date:'2026-09-22',open:10.2,high:10.5,low:9.5,close:10.3};
test('incomplete hold remains open with no realized return',()=>{
 const r=evaluate(signal,[first],policy);assert.equal(r.state,'OPEN');assert.equal(r.netPct,null);assert.equal(r.terminalDate,null);
});
test('incomplete entry window does not become expired',()=>{
 const r=evaluate(signal,[{...first,open:13,high:14,low:12.5,close:13}],policy);
 assert.equal(r.state,'WAITING_FOR_ENTRY');assert.equal(r.terminalDate,null);
});
test('adverse gap exits at the observed open before later target touches',()=>{
 const r=evaluate(signal,[first,{...second,open:8,high:13,low:7.5,close:8}],policy);
 assert.equal(r.exitPrice,8);assert.equal(r.outcome,'STOP_GAP');assert.equal(r.netPct,-20.6);
});
test('target reached at a later open precedes that days later stop',()=>{
 const r=evaluate(signal,[first,{...second,open:13,high:14,low:8,close:10}],policy);
 assert.equal(r.exitPrice,12);assert.equal(r.outcome,'TARGET1');
});
test('true holding deadline creates time exit',()=>{
 const r=evaluate(signal,[first,second],{...policy,maxHoldSessions:2});
 assert.equal(r.state,'CLOSED');assert.equal(r.outcome,'TIME_EXIT');assert.equal(r.netPct,2.4);
});
test('unknown intraday entry/target ordering is excluded from realized metrics',()=>{
 const r=evaluate(signal,[{...first,open:13,high:14,low:9.5,close:10.2}],policy);
 assert.equal(r.state,'AMBIGUOUS_INTRADAY_PATH');assert.equal(r.netPct,null);
 assert.equal(summarize([r]).closed,0);
});
test('no pre-signal bar may trigger a trade and invalid OHLC fails',()=>{
 const r=evaluate(signal,[{...first,date:'2026-09-20',high:13,low:8}],policy);
 assert.equal(r.state,'WAITING_FOR_ENTRY');
 assert.throws(()=>evaluate(signal,[{...first,high:8}],policy),/Invalid OHLC/);
});
test('same-bar dual touch keeps conservative STOP_FIRST assumption explicit',()=>{
 const r=evaluate(signal,[{...first,high:13,low:8}],policy);
 assert.equal(r.outcome,'STOP_SAME_BAR');assert.equal(r.netPct,-10.6);
});
