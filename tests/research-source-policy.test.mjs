import test from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH_SOURCE_POLICY,getResearchSourcePolicy,stampResearchRecord,assertResearchOnly } from '../src/research-source-policy.js';

test('legacy Yahoo and Mubasher research sources can never claim production authority',()=>{
  for(const id of Object.keys(RESEARCH_SOURCE_POLICY)){
    const p=getResearchSourcePolicy(id);
    assert.equal(p.productionAuthority,false);
  }
});

test('stamped Yahoo research row is explicitly research only',()=>{
  const row=stampResearchRecord({ticker:'ABUK',session:'2026-08-31',close:50},{sourceId:'YAHOO_RESEARCH'});
  assert.equal(row.authorityMode,'RESEARCH');
  assert.equal(row.researchOnly,true);
  assert.equal(row.productionAuthority,false);
  assert.equal(assertResearchOnly(row),true);
});

test('production relabel attempt is rejected',()=>{
  const row=stampResearchRecord({ticker:'COMI'},{sourceId:'MUBASHER_RESEARCH'});
  assert.throws(()=>assertResearchOnly({...row,authorityMode:'CERTIFIED_PRODUCTION'}),/RESEARCH_AUTHORITY_BOUNDARY_VIOLATION/);
});

test('unknown source cannot enter research warehouse',()=>{
  assert.throws(()=>stampResearchRecord({ticker:'X'},{sourceId:'UNDECLARED_SOURCE'}),/UNKNOWN_RESEARCH_SOURCE/);
});
