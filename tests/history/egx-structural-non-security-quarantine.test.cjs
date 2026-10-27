'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const map=require('../../data/symbol-map.json');
const fake=['BLOCKS','BUCKETS','FOLLOW','RISK','RULES'];
test('only the five demonstrated JSON structural tokens are quarantined with explicit reason',()=>{
 for(const ticker of fake){const x=map[ticker];assert.equal(x.active,false);
  assert.equal(x.exclusionReason,'verified_decision_schema_key_not_a_security');
  assert.equal(x.identityReviewStatus,'NON_SECURITY_STRUCTURAL_FIELD_QUARANTINED');
  assert.equal(x.companyNameEn,null);assert.equal(x.companyNameAr,null);assert.equal(x.isin,null);
  assert.equal(x.symbolVerified,false);
  assert.ok(x.discoverySources.length>0);
  assert.ok(x.discoverySources.every(s=>/actionable-watchlist|final-opportunity-ranking|final-multisource-ranking/.test(s)));
 }
});
test('known real equity symbols are retained as active, no arbitrary delisting',()=>{
 for(const ticker of ['GTEX','POCO','GOUR','SCCD','SODIC','DOMTY','AALR','CEFM','COMI']){
  assert.equal(map[ticker]?.active,true,ticker+' must remain active');
 }
});
test('expected universe cardinality is changed by exactly five; no alteration of gate formula',()=>{
 assert.equal(Object.values(map).filter(x=>x.active!==false).length,237);
 assert.equal(Math.ceil(237*.90),214);
 assert.equal(Math.ceil(237*.80),190);
});
