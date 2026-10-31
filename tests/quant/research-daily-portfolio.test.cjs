'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {run}=require('../../scripts/quant/research-daily-portfolio.cjs');
const data={trades:[
{status:'CLOSED',ticker:'AMOC',strategyId:'breakout',entryDate:'2026-10-28',exitDate:'2026-10-29',entryPrice:10,exitPrice:11,netReturnPct:9,rMultiple:1},
{status:'CLOSED',ticker:'ABUK',strategyId:'pullback',entryDate:'2026-10-28',exitDate:'2026-10-29',entryPrice:20,exitPrice:18,netReturnPct:-11,rMultiple:-1}
]};
const r=run(data,{initialEquityEgp:100000,positionFraction:.1,maxPositions:1});
assert.equal(r.accepted,1);assert.equal(r.rejected,1);assert.equal(r.executionReady,false);
assert.equal(r.performanceCertified,false);assert(r.curve.length>0);
assert(r.curve.every(x=>x.openPositions<=1));
assert(r.endingEquityEgp>0);assert(r.maxDrawdownPct>=0&&r.maxDrawdownPct<=100);
const single=run({trades:[{...data.trades[0],netReturnPct:9}]},{initialEquityEgp:100000,positionFraction:.1,maxPositions:1});
assert.equal(single.endingEquityEgp,100900);
assert.equal(single.closedPositions[0].pnlEgp,900);
assert.equal(single.closedPositions[0].netReturnPct,9);
assert(Number.isInteger(single.missingMarks));
const sameDay=run({trades:[
 {...data.trades[0],netReturnPct:9},
 {status:'CLOSED',ticker:'ABUK',strategyId:'trend_follow',entryDate:'2026-10-29',exitDate:'2026-10-29',entryPrice:20,exitPrice:20,netReturnPct:0,rMultiple:0}
]},{initialEquityEgp:100000,positionFraction:.1,maxPositions:1});
assert.equal(sameDay.accepted,1,'unknown intraday proceeds must not be recycled');
assert.equal(sameDay.rejected,1,'same-session capacity must remain blocked at entry');
assert.equal(single.maxOpenPositions,1);
assert.equal(single.calendarVerified,false);
assert(Array.isArray(single.excludedCalendarDates));
assert.equal(single.accepted+single.rejected,1);
assert(single.curve.every(d=>d.cashEgp>=0&&d.equityEgp>=0));
assert.equal(single.valuationComplete,single.missingMarks===0);
assert.equal(single.missingMarkDetails.length,single.missingMarks);
console.log('Research daily portfolio guard PASS');
