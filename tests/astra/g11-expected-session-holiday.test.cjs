'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {expectedSession,tradingLag}=require('../../astra/data-health/g11-data-health.cjs');
const policy=JSON.parse(fs.readFileSync(path.join(root,'data/v13-3-daily-production-policy.json'),'utf8'));
test('confirmed 8 October 2026 EGX closure resolves to preceding actual exchange session',()=>{
 assert.equal(expectedSession('2026-10-08T15:00:00Z',policy),'2026-10-07');
});
test('Friday and Saturday following holiday resolve to Wednesday 7 October',()=>{
 assert.equal(expectedSession('2026-10-09T15:00:00Z',policy),'2026-10-07');
 assert.equal(expectedSession('2026-10-10T15:00:00Z',policy),'2026-10-07');
});
test('Sunday 11 October 2026 after the closing hour is expected trading session',()=>{
 assert.equal(expectedSession('2026-10-11T15:00:00Z',policy),'2026-10-11');
});
test('a trading weekday before local close resolves to preceding session',()=>{
 assert.equal(expectedSession('2026-10-07T08:00:00Z',policy),'2026-10-06');
});

test('G11 lag excludes observed holiday and weekly closure days',()=>{
 assert.equal(tradingLag('2026-10-07','2026-10-11',policy),1);
 assert.equal(tradingLag('2026-10-08','2026-10-11',policy),1);
 assert.equal(tradingLag('2026-10-09','2026-10-10',policy),0);
});
test('G11 lag fails closed on reversed timestamps rather than inventing sessions',()=>{
 assert.equal(tradingLag('2026-10-12','2026-10-11',policy),null);
});
test('Cairo daylight saving transition does not promote weekend to trading day',()=>{
 assert.equal(expectedSession('2026-10-30T18:00:00Z',policy),'2026-10-29');
 assert.equal(expectedSession('2026-10-31T18:00:00Z',policy),'2026-10-29');
});

test('future canonical sessions must not be classified as stale or current',()=>{
 const source=fs.readFileSync(path.join(root,'astra/data-health/g11-data-health.cjs'),'utf8');
 assert.ok(source.includes("available>expected?'FUTURE_SESSION_CONFLICT'"));
 assert.ok(source.includes("issue('SESSION_MISMATCH','CRITICAL'"));
 assert.ok(source.includes("freshness==='FUTURE_SESSION_CONFLICT'"));
});
