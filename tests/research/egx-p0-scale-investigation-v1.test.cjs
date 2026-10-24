'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../../scripts/research/egx-p0-scale-investigation-v1.cjs');
const a={schemaVersion:'egx-central-price-conflict-attribution-v1',reviewQueue:[
 {ticker:'AAA',date:'2026-10-01',priority:'P0_PERSISTENT_SCALE_NEEDS_IDENTITY_CA_PROOF',sourceClose:10,mainClose:100,differencePct:900},
 {ticker:'AAA',date:'2026-10-02',priority:'P0_PERSISTENT_SCALE_NEEDS_IDENTITY_CA_PROOF',sourceClose:11,mainClose:110,differencePct:900},
 {ticker:'BBB',date:'2026-10-02',priority:'P2_DAILY_CLOSE_MISMATCH',sourceClose:5,mainClose:6,differencePct:20}]};
test('P0 queue collapses sessions into evidence cases without losing dates',()=>{const x=summarize(a);assert.equal(x.caseCount,1);assert.equal(x.conflictSessionCount,2);assert.equal(x.cases[0].conflictingDates.length,2)});
test('scale is diagnostic only and never authorizes adjustment',()=>{const c=summarize(a).cases[0];assert.equal(c.approximateMedianMainToSource,10);assert.equal(c.adjustmentAuthorized,false);assert.equal(c.priceWinner,null)});
test('invalid input blocked',()=>assert.throws(()=>summarize({reviewQueue:[]}),/Invalid/));
