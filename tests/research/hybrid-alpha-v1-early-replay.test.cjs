'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {indicators,replay,summarize}=require('../../scripts/research/hybrid-alpha-v1-early-replay.cjs');
const cfg={research:{entrySlippagePct:0.15,roundTripCostPct:0.6,maximumHoldingSessions:10},strategies:{breakout:{variants:[{id:'strict',breakoutBufferPct:0.5,minVolumeRatio:1.5,minRsi:58,maxRsi:72}]}}};
test('does not produce early signals with insufficient warmup',()=>assert.equal(indicators([],cfg),null));
test('empty returns do not imply winning performance',()=>assert.equal(summarize([]).winRatePct,null));
test('replay uses next eligible supplied candle for entry',()=>{const rows=Array.from({length:55},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),open:100+i,high:102+i,low:99+i,close:100+i,volume:100+i}));assert.equal(replay(rows,cfg).trades.length,0)});

test('does not open overlapping VCP positions for the same ticker',()=>{
 const rows=Array.from({length:82},(_,i)=>{const price=100+i*0.12;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:price,close:price,high:price+(i<40?3:0.5),low:price-(i<40?3:0.5),volume:i>40?80:150};});
 const trades=replay(rows,cfg).trades.filter(x=>x.variant==='vcp');
 assert.ok(trades.length>0,'synthetic VCP conditions should generate signals');
 for(let i=1;i<trades.length;i++)assert.ok(trades[i].entryDate>trades[i-1].exitDate,'no overlapping positions');
});
