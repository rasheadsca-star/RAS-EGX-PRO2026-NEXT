import test from'node:test';
import assert from'node:assert/strict';
import{createRegistryManifest,verifyRegistryManifest,validateRegistrySnapshot,registryRowMatchesManifest}from'../src/registry-manifest.js';
import{sha256}from'../src/hash.js';
const rows=[{ticker:'ABUK',companyName:'A',readiness:'READY',reasons:[],lastSession:'2026-08-31',historyCount:100,sourceStatus:'READY'},{ticker:'COMI',companyName:'C',readiness:'INSUFFICIENT_HISTORY',reasons:['history_lt_100'],lastSession:'2026-08-31',historyCount:50,sourceStatus:'READY'}];
const registry={version:sha256(rows),total:2,counts:{READY:1,INSUFFICIENT_HISTORY:1},rows};

test('registry manifest binds exact rows session and authoritative universe version',()=>{const m=createRegistryManifest(registry,{marketSession:'2026-08-31',universeVersion:'U1'});assert.equal(verifyRegistryManifest(m).valid,true);assert.equal(m.registryVersion,registry.version);assert.match(m.manifestHash,/^[a-f0-9]{64}$/)});
test('changed registry row invalidates registry snapshot version',()=>{const bad={...registry,rows:rows.map((x,i)=>i?x:{...x,historyCount:99})};const v=validateRegistrySnapshot(bad);assert.equal(v.valid,false);assert.ok(v.reasons.includes('REGISTRY_VERSION_HASH_MISMATCH'))});
test('declared counts and totals are recomputed',()=>{assert.equal(validateRegistrySnapshot({...registry,total:3}).valid,false);assert.equal(validateRegistrySnapshot({...registry,counts:{READY:2}}).valid,false)});
test('duplicate tickers are rejected even under a recomputed hash',()=>{const duplicate=[rows[0],{...rows[0]}],r={version:sha256(duplicate),total:2,counts:{READY:2},rows:duplicate};assert.ok(validateRegistrySnapshot(r).reasons.some(x=>x.startsWith('REGISTRY_DUPLICATE_TICKER:')))});
test('registry member must match the exact row frozen in manifest',()=>{const m=createRegistryManifest(registry,{marketSession:'2026-08-31',universeVersion:'U1'});assert.equal(registryRowMatchesManifest(m,rows[0]),true);assert.equal(registryRowMatchesManifest(m,{...rows[0],historyCount:99}),false)});
