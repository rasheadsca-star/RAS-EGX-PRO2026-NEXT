'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {changeConsistent,roundingBand}=require('../../scripts/stable/v16-price-change-consistency.cjs');
test('historical tolerance retained',()=>assert.equal(changeConsistent({close:10,previousClose:9.8,reportedChangePct:2}),true));
test('rounding can explain otherwise inconsistent penny-stock percent',()=>{
 assert.equal(changeConsistent({close:0.12,previousClose:0.11,reportedChangePct:6}),true);
});
test('large mismatch outside band stays rejected',()=>{
 assert.equal(changeConsistent({close:10,previousClose:8,reportedChangePct:0}),false);
});
test('zero prior price cannot manufacture band',()=>assert.equal(roundingBand(1,0),null));
test('missing reported percent preserves earlier no-rejection semantics',()=>assert.equal(changeConsistent({close:1,previousClose:1.5,reportedChangePct:null}),true));
test('undefined reported percent preserves earlier no-rejection semantics',()=>assert.equal(changeConsistent({close:1,previousClose:1.5}),true));
