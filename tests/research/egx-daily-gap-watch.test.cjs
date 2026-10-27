'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../../scripts/research/egx-daily-gap-watch.cjs');
const truth=(session,missing)=>({expectedSession:session,missingHistoryFiles:missing,acceptedRows:193});
const summary={symbols:[{ticker:'BONY',lastSession:'2026-10-23',availableSessions:82,symbolVerified:false}]};
test('current missing symbols are quarantined',()=>{const x=build(truth('2026-10-27',['BONY']),summary);assert.equal(x.records[0].eligibleForTrading,false);assert.equal(x.records[0].consecutiveObservedSessions,1)});
test('persistent gap increments across observed sessions',()=>{const p=build(truth('2026-10-26',['BONY']),summary),n=build(truth('2026-10-27',['BONY']),summary,p);assert.equal(n.records[0].consecutiveObservedSessions,2);assert.equal(n.records[0].firstObservedSession,'2026-10-26')});
test('exiting missing list never certifies recovery',()=>{const p=build(truth('2026-10-26',['BONY']),summary),n=build(truth('2026-10-27',[]),summary,p);assert.equal(n.recovered[0].status,'NO_LONGER_MISSING_IN_PRICE_TRUTH_NOT_YET_CERTIFIED');assert.equal(n.productionEligibility,false)});
test('missing list must be explicit and duplicate-free',()=>{assert.throws(()=>build({expectedSession:'2026-10-27'},summary),/MISSING_EXPLICIT/);assert.throws(()=>build(truth('2026-10-27',['BONY','BONY']),summary),/DUPLICATE/)});

test('rerunning same exchange session does not increment gap persistence',()=>{
 const first=build(truth('2026-10-27',['BONY']),summary);
 const second=build(truth('2026-10-27',['BONY']),summary,first);
 assert.equal(second.records[0].consecutiveObservedSessions,1);
});

test('unverified zero-history ticker requires identity reconciliation',()=>{
 const x=build(truth('2026-10-27',['BONY']),summary);
 assert.equal(x.records[0].recoveryClass,'ZERO_HISTORY_IDENTITY_UNVERIFIED');
 assert.match(x.records[0].nextAction,/VERIFY_EXCHANGE_SECURITY_IDENTITY/);
 assert.equal(x.records[0].eligibleForTrading,false);
});
test('verified historical ticker with current gap requires session recovery',()=>{
 const x=build(truth('2026-10-27',['BONY']),{symbols:[{ticker:'BONY',lastSession:'2026-10-26',availableSessions:100,symbolVerified:true}]});
 assert.equal(x.records[0].recoveryClass,'CURRENT_SESSION_OR_SOURCE_GAP');
 assert.match(x.records[0].nextAction,/FETCH_INDEPENDENT_OHLCV/);
});
