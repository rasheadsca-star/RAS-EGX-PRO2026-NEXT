'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SOURCE,hash,acceptedManifest,evaluation,reconcile,verifyManifest}=require('../../scripts/stable/history-quarantine-policy.cjs');
const day='2026-10-25', prior='2026-10-22', stamp='2026-10-25T16:04:33Z';
const row=(source=SOURCE,date=day,close=683.5)=>({ticker:'MIPH',date,source,close,primarySource:'mubasher_symbol_pages_precise_enriched'});
const doc=(...sessions)=>({sessions,firstSession:prior,lastSession:day,availableSessions:sessions.length,staleData:false,
  generatedAt:'old-run',priceTruthLatest:{date:day,close:683.5},historyStatus:'existing',averageConfidence:71});
const assessment=(accepted=[],rejected=[{ticker:'MIPH',reason:'REPORTED_CHANGE_MISMATCH'}],sourceEligible=true)=>
  evaluation({runId:'scan-16-04',expectedSession:day,sourceEligible,acceptedRows:accepted.length,accepted,rejected});
const act=(document,assess=assessment(),ticker='MIPH')=>
  reconcile({document,ticker,expectedSession:day,assessment:assess,generatedAt:stamp});
test('reject only exact-source current-session candle; retain other source and previous session',()=>{
 const old=row(SOURCE,prior,742.36),other=row('independent_approved',day,681),today=row();
 const out=act(doc(old,other,today));
 assert.equal(out.quarantined.length,1);assert.deepEqual(out.quarantined[0].row,today);
 assert.equal(out.quarantined[0].rowSha256,hash(today));assert.equal(out.quarantined[0].rejectionReason,'REPORTED_CHANGE_MISMATCH');
 assert.equal(out.quarantined[0].runId,'scan-16-04');
 assert.deepEqual(out.document.sessions,[old,other]);assert.equal(out.document.lastSession,day);
 assert.equal(out.document.availableSessions,2);assert.equal(out.document.firstSession,prior);
 assert.equal(out.document.staleData,false);assert.equal(out.document.generatedAt,stamp);
 assert.equal(out.document.priceTruthLatest.close,other.close);
 assert.equal(out.document.historyStatus,'existing');assert.equal(out.document.averageConfidence,71);
});
test('quarantine updates stale metadata after last-current candle removed',()=>{
 const old=row(SOURCE,prior,742.36),out=act(doc(old,row()));
 assert.deepEqual(out.document.sessions,[old]);assert.equal(out.document.lastSession,prior);
 assert.equal(out.document.availableSessions,1);assert.equal(out.document.firstSession,prior);
 assert.equal(out.document.staleData,true);assert.equal(out.document.priceTruthLatest.close,742.36);
 assert.equal(out.document.priceTruthLatest.date,prior);
});
test('different source and past session do not modify document byte-wise',()=>{
 const original=doc(row('other',day),row(SOURCE,prior));
 const out=act(original);
 assert.equal(out.document,original);assert.deepEqual(out.quarantined,[]);
});
test('unassessed and NOT_IN_MARKET symbols never quarantined',()=>{
 const original=doc(row());const e=assessment([],[]);
 assert.equal(act(original,e).document,original);assert.equal(act(original,e).quarantined.length,0);
});
test('source-ineligible scan never quarantines',()=>{
 const original=doc(row());const e=assessment([], [{ticker:'MIPH',reason:'REPORTED_CHANGE_MISMATCH'}],false);
 assert.equal(act(original,e).document,original);
});
test('incomplete manifest or overlapping rejection is invalid',()=>{
 assert.throws(()=>evaluation({runId:'x',expectedSession:day,sourceEligible:true,acceptedRows:1,accepted:[],rejected:[]}),/MANIFEST_COUNT/);
 assert.throws(()=>assessment([row()],[{ticker:'MIPH',reason:'x'}]),/INVALID_REJECTED_ENTRY/);
 assert.throws(()=>assessment([row(),row()],[]),/DUPLICATE_ACCEPTED_TICKER/);
});
test('invalid session or mismatched session must throw',()=>{
 const e=assessment();const original=doc(row());
 for(const date of ['2026-10-25T00:00:00Z','2026-02-30','2026-10-24','']){
  assert.throws(()=>reconcile({document:original,ticker:'MIPH',expectedSession:date,assessment:e,generatedAt:stamp}));
 }
});
test('manifest SHA stable across key insertion orders and includes runId',()=>{
 const a=row(),b={close:a.close,source:a.source,date:a.date,ticker:a.ticker,primarySource:a.primarySource};
 assert.equal(hash(a),hash(b));
 const x=assessment([a],[]),y=evaluation({runId:'scan-other',expectedSession:day,sourceEligible:true,acceptedRows:1,accepted:[a],rejected:[]});
 assert.notEqual(x.manifestSha256,y.manifestSha256);
 assert.deepEqual(x.manifest,acceptedManifest([a]));
});
test('manifest hash check rejects modified, missing, duplicate or stale rows',()=>{
 const a=row(),m=acceptedManifest([a]);
 assert.equal(verifyManifest(m,{MIPH:doc(a)}),true);
 assert.throws(()=>verifyManifest(m,{MIPH:doc(row(SOURCE,day,680))}),/MANIFEST_HISTORY_HASH_MISMATCH/);
 assert.throws(()=>verifyManifest(m,{}),/MANIFEST_HISTORY_HASH_MISMATCH/);
 assert.throws(()=>verifyManifest(m,{MIPH:doc(a,a)}),/MANIFEST_HISTORY_HASH_MISMATCH/);
 assert.throws(()=>verifyManifest([...m,...m],{MIPH:doc(a)}),/INVALID_MANIFEST_ENTRY/);
});
test('duplicate rejection or incomplete input fails closed',()=>{
 assert.throws(()=>assessment([], [{ticker:'MIPH',reason:'a'},{ticker:'MIPH',reason:'b'}]),/INVALID_REJECTED_ENTRY/);
 assert.throws(()=>evaluation({runId:'x',expectedSession:day,acceptedRows:0,accepted:[]}),/INVALID_EVALUATION/);
 assert.throws(()=>reconcile({document:doc(row()),ticker:'MIPH',expectedSession:day,assessment:{},generatedAt:stamp}),/INVALID_EVALUATION/);
});
test('repeated reject is idempotent; rejection does not recreate candle',()=>{
 const first=act(doc(row())),second=act(first.document);
 assert.equal(first.quarantined.length,1);assert.equal(second.quarantined.length,0);
 assert.equal(second.document,first.document);
});

test('B2 accepted-but-missing ticker cannot simultaneously be rejected',()=>{
 assert.throws(()=>evaluation({runId:'run-overlap',expectedSession:day,sourceEligible:true,
  acceptedRows:1,accepted:[],missingHistory:['BONY'],
  rejected:[{ticker:'BONY',reason:'REPORTED_CHANGE_MISMATCH'}]}),/INVALID_REJECTED_ENTRY/);
});
