'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('Pages E2E treats missing fetch-status accounting as research-only, not certified',()=>{
 const y=fs.readFileSync('.github/workflows/static.yml','utf8');
 assert.ok(y.includes("all(k in fetch_status for k in ('marketRows','rejectedCurrentSessionRows','inputRows'))"));
 assert.ok(y.includes("assert source['delayed'] is True"));
 assert.ok(y.includes("assert v16['executionReady'] is False"));
 assert.ok(y.includes("assert quant['liveExecutionEnabled'] is False"));
 assert.ok(y.includes('FETCH_STATUS_ACCOUNTING_UNVERIFIED_RESEARCH_ONLY'));
});
