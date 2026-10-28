'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('unified-console/index.html','utf8');
test('unified console references actual stored source files',()=>{for(const p of ['data/stable/v15-price-truth.json','data/ops/g22-main-app-handoff.json','astra-prod/app/data.json','unified-console/gann-research.json'])assert.ok(html.includes(p));});
test('stale Astra plans are labeled archived and cannot claim live',()=>{assert.ok(html.includes('aDate===market'));assert.ok(html.includes('أرشيفية — غير صالحة'));assert.ok(html.includes('التنفيذ الآلي والتداول الورقي التنفيذي مغلقان'));});
test('safe rendering uses textContent and no dynamic innerHTML',()=>{assert.ok(html.includes('textContent'));assert.ok(!html.includes('.innerHTML='));});

test('Pages workflow enforces live independent archive and zero-order ledger E2E',()=>{
 const yml=fs.readFileSync('.github/workflows/static.yml','utf8');
 assert.ok(yml.includes('INDEPENDENT_PAPER_LIVE_E2E_PASS'));
 assert.ok(yml.includes('/unified-console/independent-last-verified.json'));
 assert.ok(yml.includes('/unified-console/independent-paper-ledger.json'));
 assert.ok(yml.includes("ledger['orders'] == []"));
});
