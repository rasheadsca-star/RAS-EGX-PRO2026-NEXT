import test from'node:test';import assert from'node:assert/strict';import{reconcileObservations}from'../src/reconciliation.js';
const row=(sourceId,close,sourceClass='PUBLIC_MARKET')=>({ticker:'ABUK',session:'2026-08-31',sourceId,sourceClass,open:10,high:Math.max(11,close),low:9,close,volume:1000,capturedAt:'2026-08-31T15:00:00Z'});
test('consistent cross-source observations resolve without averaging',()=>{const r=reconcileObservations([row('A',10),row('B',10.05)]);assert.equal(r.status,'READY');assert.equal(r.authoritative.sourceId,'A');assert.equal(r.authoritative.close,10)});
test('material close conflict fails closed',()=>assert.equal(reconcileObservations([row('A',10),row('B',12)]).status,'DATA_CONFLICT'));
test('single source is not production-ready when cross-check required',()=>assert.equal(reconcileObservations([row('A',10)]).status,'SOURCE_UNAVAILABLE'));
test('mixed sessions are blocked',()=>{const b=row('B',10);b.session='2026-08-30';assert.equal(reconcileObservations([row('A',10),b]).status,'BLOCKED')});
