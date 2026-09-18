import test from 'node:test';import assert from 'node:assert/strict';import {entryEngine} from '../src/features.js';
const mk=(price,pivot,vol=2_000_000,prev=null)=>{const b=Array.from({length:40},(_,i)=>({date:`2026-01-${String((i%28)+1).padStart(2,'0')}`,open:price,high:price*1.01,low:price*.99,close:price,volume:vol,valueTraded:price*vol,adjustmentFactor:1}));if(prev!=null)b[b.length-2].close=prev;return entryEngine(b,{raw:{pivot_price:pivot}},{raw:{AvgVolume20:vol/1.5}},{pass:true},{pass:true});};
test('GOLDEN strong but extended is never BUY',()=>{const x=mk(110,100);assert.equal(x.raw.status,'EXTENDED');});
test('GOLDEN near pivot is classified near',()=>{const x=mk(97,100);assert.equal(x.raw.status,'NEAR PIVOT');});
test('GOLDEN ready now is classified ready',()=>{const x=mk(99,100);assert.equal(x.raw.status,'READY NOW');});
