'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../../scripts/stable/v16-session-aware-price-truth.cjs');
test('no unconditional historical verification imports at module top-level',()=>{
 const src=fs.readFileSync(file,'utf8');
 const beforeMain=src.slice(0,src.indexOf('async function main()'));
 assert.doesNotMatch(beforeMain,/require\(['"]\.\/history-(?:producer-assessment|r8-integrity|r9-report-binding|publication-gate|guarded-merge)/);
});
test('guarded modules loaded only after explicit opt-in',()=>{
 const src=fs.readFileSync(file,'utf8');
 assert.match(src,/guardedHistory = process\.env\.EGX_HISTORY_GUARDED_INTEGRATION === '1'/);
 assert.match(src,/guardedTools = guardedHistory \?/);
 assert.match(src,/guardedHistory\s*\? require\('\.\/history-guarded-merge\.cjs'\)/);
});
