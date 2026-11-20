'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {analyzeEvidence,csv}=require('../../scripts/research/egx-price-evidence-triage-v1.cjs');
const conflict={schemaVersion:'egx-central-price-conflict-attribution-v1',reviewQueue:[
 {ticker:'ABC',date:'2026-10-20',priority:'P1',sourceClose:100,mainClose:110,differencePct:10,automaticRepairAllowed:false},
 {ticker:'XYZ',date:'2026-10-21',priority:'P2',sourceClose:50,mainClose:52,differencePct:4,automaticRepairAllowed:false}]};
const evidence=(over={})=>({ticker:'ABC',date:'2026-10-20',evidenceType:'EXCHANGE_OFFICIAL_CLOSE',sourceUrl:'https://example.org/document',
 documentSha256:'a'.repeat(64),sourceName:'Example official exchange record',capturedAt:'2026-10-24T10:00:00Z',observedClose:100,...over});
test('no evidence leaves every price unresolved',()=>{const out=analyzeEvidence(conflict);assert.equal(out.totalConflictRows,2);assert.equal(out.counts.AWAITING_INDEPENDENT_EVIDENCE,2);assert.equal(out.approvedPrices,0)});
test('evidence metadata alone cannot certify a price',()=>{const out=analyzeEvidence(conflict,[evidence()]);assert.equal(out.queue[0].evidenceState,'EVIDENCE_RECEIVED_PENDING_MANUAL_VERIFICATION');assert.equal(out.queue[0].approvedClose,null);assert.equal(out.canPromoteToProduction,false)});
test('contradictory submitted prices cannot pass',()=>{const out=analyzeEvidence(conflict,[evidence(),evidence({observedClose:110,documentSha256:'b'.repeat(64)})]);assert.equal(out.queue[0].evidenceState,'CONTRADICTORY_EVIDENCE_REQUIRES_REVIEW')});
test('invalid and unknown evidence is rejected',()=>{const out=analyzeEvidence(conflict,[evidence({documentSha256:'bad'}),evidence({ticker:'BAD'})]);assert.equal(out.rejected.length,2);assert.equal(out.queue[0].evidenceCount,0)});
test('CSV escapes cells and preserves row count',()=>{const out=analyzeEvidence(conflict);assert.equal(csv(out.queue).trim().split('\n').length,3)});
