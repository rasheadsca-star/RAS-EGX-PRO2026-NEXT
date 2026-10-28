'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifiedSnapshot,retainArchive,updateLedger,validArchive,validLedger}=
 require('../../scripts/independent/preserve-verified-paper.cjs');
const observation=(ticker='COMI',session='2026-10-27',close=121.82)=>({
 ticker,session,close,currency:'EGP',evidenceLevel:'DATED_PROVIDER_EVIDENCE',
 state:'DATED_PRICE_OBSERVATION_NOT_A_SIGNAL'});
const source=(session='2026-10-27',rows=[observation()])=>({
 session,mode:'PAPER_ONLY',executable:false,recommendations:[],watchlist:[],
 datedPriceObservations:rows,status:'RESEARCH_ONLY_PRICE_GATE_BLOCKED'});
test('archives only dated, non-executable evidence',()=>{
 const a=verifiedSnapshot(source());
 assert.equal(validArchive(a),true);
 assert.equal(a.session,'2026-10-27');
 assert.equal(a.datedPriceObservations.length,1);
 assert.deepEqual(a.orders,[]);
 assert.deepEqual(a.recommendations,[]);
});
test('failed fetch or empty research cannot destroy last verified snapshot',()=>{
 const old=verifiedSnapshot(source());
 assert.deepEqual(retainArchive(old,source('2026-10-28',[])),old);
 assert.deepEqual(retainArchive(old,null),old);
 assert.deepEqual(retainArchive(old,{...source(),executable:true}),old);
});
test('a newer verified session replaces old archive, not vice versa',()=>{
 const old=verifiedSnapshot(source());
 const newer=source('2026-10-28',[observation('COMI','2026-10-28',123)]);
 const latest=retainArchive(old,newer);
 assert.equal(latest.session,'2026-10-28');
 assert.deepEqual(retainArchive(latest,source()),latest);
});
test('same-session shrink or price correction cannot silently overwrite archived prices',()=>{
 const old=verifiedSnapshot(source('2026-10-27',[observation(),observation('EGBE','2026-10-27',0.5)]));
 assert.deepEqual(retainArchive(old,source()),old);
 assert.deepEqual(retainArchive(old,source('2026-10-27',[observation('COMI','2026-10-27',999),observation('EGBE','2026-10-27',0.5)])),old);
});
test('append-only ledger deduplicates same session and keeps zero orders',()=>{
 const first=updateLedger(null,source());
 const same=updateLedger(first,source());
 assert.equal(validLedger(same),true);
 assert.deepEqual(same,first);
 const next=updateLedger(same,source('2026-10-28',[observation('COMI','2026-10-28',123)]));
 assert.equal(next.observations.length,2);
 assert.deepEqual(next.orders,[]);
 assert.deepEqual(updateLedger(next,source()),next);
});
test('ledger rejects a changed price for same ticker and session',()=>{
 const first=updateLedger(null,source());
 assert.throws(()=>updateLedger(first,source('2026-10-27',[observation('COMI','2026-10-27',999)])),/PAPER_OBSERVATION_PRICE_CONFLICT/);
});
test('malformed or executable data cannot enter archival ledger',()=>{
 const first=updateLedger(null,source());
 for(const invalid of [
  {...source(),executable:true},
  {...source(),recommendations:[{ticker:'COMI'}]},
  source('2026-10-27',[observation('COMI','2026-10-26')]),
  source('2026-10-27',[observation('COMI','2026-10-27',-1)]),
  source('2026-10-27',[observation(),observation()]),
  source('2026-02-30',[observation('COMI','2026-02-30')])
 ])assert.deepEqual(updateLedger(first,invalid),first);
});
test('invalid existing archive or ledger fails closed rather than being erased',()=>{
 assert.throws(()=>retainArchive({foo:'bar'},source()),/INVALID_PREVIOUS_VERIFIED_ARCHIVE/);
 assert.throws(()=>updateLedger({foo:'bar'},source()),/INVALID_PREVIOUS_PAPER_LEDGER/);
});
