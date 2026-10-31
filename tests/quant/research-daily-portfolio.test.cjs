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
console.log('Research daily portfolio guard PASS');
