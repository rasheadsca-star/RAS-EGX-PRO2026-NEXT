'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {filterApproved,verify,observed}=require('../../scripts/stable/v16-verified-incremental-recovery.cjs');
const date='2026-10-27',ticker='PHGC';
const history={ticker,isin:'EGS123456789',symbolVerified:true,sessions:[]};
const symbols={[ticker]:{active:true}};
const primary={rows:[{symbol:ticker,price:0.08,open:0.07,high:0.08,low:0.07,volume:1000,sourceSessionDate:date}]};
const rejected={expectedSession:date,acceptedRows:193,ready:true,executionGrade:true,sampleRejected:[{ticker,reason:'REPORTED_CHANGE_MISMATCH'}]};
const second={expectedSession:date,records:{[ticker]:{approved:true,approvedEvidence:{status:'APPROVED',provider:'YAHOO_CHART',sessionDate:date,close:0.08}}}};
test('approved independent source plus observed primary OHLCV and verified ISIN history survives',()=>{
 const f=filterApproved(second,rejected,primary,symbols,{[ticker]:history});
 assert.equal(f.approvedCount,1);
 assert.equal(f.records[ticker].approved,true);
});
test('unverified ticker or absent history cannot become current-session seed',()=>{
 const f=filterApproved(second,rejected,primary,symbols,{});
 assert.equal(f.approvedCount,0);
 assert.equal(f.records[ticker].quarantineReason,'EXISTING_VERIFIED_ISIN_HISTORY_REQUIRED');
});
test('incomplete primary OHLCV is quarantined instead of reconstructed',()=>{
 const f=filterApproved(second,rejected,{rows:[{...primary.rows[0],high:null}]},symbols,{[ticker]:history});
 assert.equal(f.approvedCount,0);
 assert.equal(f.records[ticker].quarantineReason,'OBSERVED_OHLCV_REQUIRED_NO_RECONSTRUCTION');
});
test('stale primary requires complete independent OHLCV',()=>{
 const r={...rejected,sampleRejected:[{ticker,reason:'SOURCE_SESSION_MISMATCH'}]};
 const f=filterApproved(second,r,primary,symbols,{[ticker]:history});
 assert.equal(f.approvedCount,0);
});
test('recovery count and exact evidence must reconcile with accepted delta',()=>{
 const after={...rejected,acceptedRows:194,secondSourceReconciliation:{recoveredTickersThisRun:[ticker]}};
 const h={...history,sessions:[{date,sourceSessionDate:date,secondSourceConfirmed:true,secondSourceProvider:'YAHOO_CHART',open:0.07,high:0.08,low:0.07,close:0.08,volume:1000}]};
 const f=filterApproved(second,rejected,primary,symbols,{[ticker]:history});
 assert.equal(verify(rejected,after,f,{[ticker]:h}).increment,1);
 assert.throws(()=>verify(rejected,{...after,acceptedRows:195},f,{[ticker]:h}),/DELTA_MISMATCH/);
});
test('numeric missing fields are never treated as observed zero',()=>assert.equal(observed({open:1,high:1,low:1,close:1,volume:null}),false));
