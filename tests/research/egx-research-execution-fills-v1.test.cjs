'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {resolveExit}=require('../../scripts/research/egx-research-execution-fills-v1.cjs');
const b=(open,high,low,close)=>({open,high,low,close,volume:1000,executable:true});
test('stop gap executes at opening price, not unattainable stop price',()=>{const x=resolveExit([b(90,92,88,90)],100,1);assert.equal(x.status,'STOP_GAP');assert.equal(x.exitPrice,90)});
test('same bar hits stop and target: stop-first conservative',()=>{const x=resolveExit([b(100,115,93,105)],100,1);assert.equal(x.status,'STOP');assert.equal(x.exitPrice,95)});
test('target gap does not assume positive price improvement',()=>{const x=resolveExit([b(115,120,110,118)],100,1);assert.ok(Math.abs(x.exitPrice-109)<1e-9)});
test('no price result for right-censored position without target or stop',()=>assert.equal(resolveExit([b(100,102,98,100)],100,10),null));
test('ten executable bars time exit only on the tenth',()=>{const x=resolveExit(Array.from({length:10},()=>b(100,101,99,100.5)),100,10);assert.equal(x.offset,9);assert.equal(x.status,'TIME_EXIT')});
