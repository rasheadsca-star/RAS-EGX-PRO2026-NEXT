'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {expectedSession}=require('../../astra/data-health/g11-data-health.cjs');
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
