import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBars, assertReady } from '../src/readiness.js';

const bars = Array.from({length:100},(_,i)=>{const d=new Date(Date.UTC(2026,0,1+i));return{session:d.toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000}});
bars[99].session='2026-08-31';

test('valid complete data becomes READY',()=>assert.equal(validateBars(bars,{latestSession:'2026-08-31'}).state,'READY'));
test('bad OHLC fails closed',()=>{const x=structuredClone(bars);x[2].high=8;assert.equal(validateBars(x,{latestSession:'2026-08-31'}).state,'BLOCKED')});
test('cross-source conflict blocks recommendation path',()=>assert.equal(validateBars(bars,{latestSession:'2026-08-31',conflict:true}).state,'DATA_CONFLICT'));
test('stale last session is STALE',()=>assert.equal(validateBars(bars,{latestSession:'2026-09-01'}).state,'STALE'));
test('assertReady throws for non-ready',()=>assert.throws(()=>assertReady({ready:false,state:'STALE'}),/DATA_READINESS_BLOCK/));
test('non-monotonic history fails closed',()=>{const x=structuredClone(bars);[x[2],x[3]]=[x[3],x[2]];const r=validateBars(x,{latestSession:'2026-08-31'});assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.some(x=>x.startsWith('non_monotonic_session:')))});
test('future session fails closed even if last row is current',()=>{const x=structuredClone(bars);x[50].session='2026-09-01';const r=validateBars(x,{latestSession:'2026-08-31'});assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.some(x=>x.startsWith('future_session:')))});
test('history row outside exchange calendar fails closed',()=>{const allowed=new Set(bars.map(x=>x.session));allowed.delete(bars[20].session);const r=validateBars(bars,{latestSession:'2026-08-31',allowedSessions:allowed});assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.some(x=>x.startsWith('non_exchange_session:')))});
