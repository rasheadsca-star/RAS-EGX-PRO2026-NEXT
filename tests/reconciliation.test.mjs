import test from 'node:test';import assert from 'node:assert/strict';import{reconcileObservations}from'../src/reconciliation.js';
const a={ticker:'ABUK',session:'2026-08-31',sourceId:'EGX',sourceClass:'OFFICIAL_EXCHANGE',open:10,high:11,low:9,close:10,volume:1000,capturedAt:'2026-08-31T15:00:00+03:00'};
test('consistent cross-source observations resolve without averaging',()=>{const b={...a,sourceId:'MUB',sourceClass:'PUBLIC_MARKET',close:10.05};const r=reconcileObservations([b,a],{maxCloseConflictPct:1});assert.equal(r.status,'READY');assert.equal(r.authoritative.sourceId,'EGX');assert.equal(r.authoritative.close,10)});
test('material close conflict fails closed',()=>{const b={...a,sourceId:'MUB',sourceClass:'PUBLIC_MARKET',close:12};assert.equal(reconcileObservations([a,b]).status,'DATA_CONFLICT')});
test('single source is not production-ready when cross-check required',()=>assert.equal(reconcileObservations([a]).status,'SOURCE_UNAVAILABLE'));
test('mixed sessions are blocked',()=>{const b={...a,sourceId:'MUB',sourceClass:'PUBLIC_MARKET',session:'2026-08-30'};assert.equal(reconcileObservations([a,b]).status,'BLOCKED')});
