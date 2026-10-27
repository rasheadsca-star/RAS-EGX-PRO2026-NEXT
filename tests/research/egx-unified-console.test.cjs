'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('unified-console/index.html','utf8');
test('unified console references actual stored source files',()=>{for(const p of ['data/stable/v15-price-truth.json','data/ops/g22-main-app-handoff.json','astra-prod/app/data.json','unified-console/gann-research.json'])assert.ok(html.includes(p));});
test('stale Astra plans are labeled archived and cannot claim live',()=>{assert.ok(html.includes('aDate===market'));assert.ok(html.includes('أرشيفية — غير صالحة'));assert.ok(html.includes('التنفيذ الآلي والتداول الورقي التنفيذي مغلقان'));});
test('safe rendering uses textContent and no dynamic innerHTML',()=>{assert.ok(html.includes('textContent'));assert.ok(!html.includes('.innerHTML='));});
