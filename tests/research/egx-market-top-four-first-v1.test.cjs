'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rankUniverse,evaluate}=require('../../scripts/research/egx-market-top-four-first-v1.cjs');
const rows=Array.from({length:75},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:100+i,close:100+i,high:101+i,low:99+i,volume:10000}));
test('market screening selects no more than four per day before strategy',()=>{const universe=Object.fromEntries(Array.from({length:8},(_,i)=>['T'+i,rows.map(x=>({...x,volume:10000+i*1000}))]));const r=rankUniverse(universe);assert.ok([...r.selected.values()].every(x=>x.size<=4));assert.ok([...r.selected.values()].some(x=>x.size===4))});
test('strategy cannot introduce stock absent from prior market shortlist',()=>{const r=evaluate({AAA:rows},[{ticker:'UNKNOWN',signalDate:rows[60].date,variant:'breakout_filtered',signalScore:3,netReturnPct:9,exitDate:rows[69].date}]);assert.equal(r.models[0].selectedTrades,0)});
