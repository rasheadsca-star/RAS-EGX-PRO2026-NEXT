'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../../data/symbol-map.json');
const {identityCheck}=require('../../scripts/history/adapters/yahoo-history-adapter.cjs');
test('NAHO/TRTO are USD-traded EGX securities with unchanged ISIN and independent identity gate',()=>{
 for(const [ticker,isin] of [['NAHO','EGS69182C011'],['TRTO','EGS79072C012']]){
  const entry=m[ticker];assert.equal(entry.currency,'USD');
  assert.equal(entry.active,true);assert.equal(entry.isin,isin);
  assert.equal(entry.symbolVerified,false);
  const x=identityCheck({symbol:ticker+'.CA',currency:'USD',
   fullExchangeName:'Egyptian Exchange',exchangeName:'CAI',shortName:ticker},
   ticker+'.CA',entry,null);
  assert.ok(!x.warnings.some(z=>z.startsWith('currency_mismatch')));
  const wrong=identityCheck({symbol:ticker+'.CA',currency:'EGP',
   fullExchangeName:'Egyptian Exchange',exchangeName:'CAI',shortName:ticker},
   ticker+'.CA',entry,null);
  assert.ok(wrong.warnings.some(z=>z==='currency_mismatch:EGP'));
 }
});
test('separate VLMRA EGP class and ORHD/PHGC hold policies unchanged',()=>{
 assert.equal(m.VLMRA.currency,'EGP');
 assert.equal(m.ORHD.currency,'EGP');
 assert.equal(m.PHGC.currency,'EGP');
 assert.equal(m.ORHD.symbolVerified,false);
 assert.equal(Object.values(m).filter(z=>z.active!==false).length,237);
});
