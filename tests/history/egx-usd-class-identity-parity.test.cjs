'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const map=require('../../data/symbol-map.json');
const {identityCheck}=require('../../scripts/history/adapters/yahoo-history-adapter.cjs');
test('USD security class identities GTEX and VLMR are preserved without source-verification bypass',()=>{
 for(const ticker of ['GTEX','VLMR']){
  const m=map[ticker];
  assert.equal(m.active,true);assert.equal(m.currency,'USD');
  assert.equal(m.symbolVerified,false);
  const meta={symbol:ticker+'.CA',currency:'USD',exchangeName:'CAI',fullExchangeName:'EGX',shortName:ticker};
  const x=identityCheck(meta,ticker+'.CA',m,null);
  assert.doesNotMatch(x.warnings.join('|'),/currency_mismatch/);
  assert.equal(x.evidence.returnedSymbol,ticker+'.CA');
  assert.equal(x.verified,true);
  const wrong={...meta,currency:'EGP'};
  assert.match(identityCheck(wrong,ticker+'.CA',m,null).warnings.join('|'),/currency_mismatch:EGP/);
 }
});
test('separate VLMRA EGP share class and true active universe retained',()=>{
 assert.equal(map.VLMRA.currency,'EGP');
 assert.equal(map.VLMRA.active,true);
 assert.equal(Object.values(map).filter(x=>x.active!==false).length,237);
 for(const ticker of ['GTEX','VLMR','VLMRA'])assert.equal(map[ticker].isin,null);
});
