import test from'node:test';
import assert from'node:assert/strict';
import{certifiedUniverseFixture}from'./helpers/certified-universe-fixture.mjs';
import{verifyCertifiedUniverseAuthority}from'../src/certified-universe-authority.js';

test('official certified snapshot becomes deterministic production universe authority',()=>{const{universe}=certifiedUniverseFixture();const v=verifyCertifiedUniverseAuthority(universe);assert.equal(v.state,'READY');assert.equal(universe.authorityMode,'CERTIFIED_PRODUCTION');assert.equal(universe.total,1);assert.match(universe.authorityProof.authorityProofHash,/^[0-9a-f]{64}$/)});
test('certified universe proof cannot survive row tampering',()=>{const{universe}=certifiedUniverseFixture();const tampered={...universe,rows:universe.rows.map(r=>({...r,companyName:'Tampered'}))};const v=verifyCertifiedUniverseAuthority(tampered);assert.equal(v.state,'BLOCKED');assert.ok(v.reasons.includes('CERTIFIED_UNIVERSE_ROWS_MISMATCH'))});
test('certified universe proof cannot be replayed with another authority hash',()=>{const{universe}=certifiedUniverseFixture();const tampered={...universe,authorityProof:{...universe.authorityProof,authorityProofHash:'0'.repeat(64)}};const v=verifyCertifiedUniverseAuthority(tampered);assert.equal(v.state,'BLOCKED');assert.ok(v.reasons.includes('CERTIFIED_UNIVERSE_AUTHORITY_PROOF_MISMATCH'))});
