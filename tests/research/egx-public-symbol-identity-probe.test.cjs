'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parsePage,targets}=require('../../scripts/research/egx-public-symbol-identity-probe.cjs');
test('only actual ticker within page heading counts as public identity reference',()=>{
 const d=parsePage('<title>Market</title><h1>GTEX for Commercial and Industrial (GTEX)</h1><p>Trading Currency US Dollar</p>','GTEX');
 assert.equal(d.identityHeadingMatches,true);
 assert.equal(d.tradingCurrencyPublicPage,'US Dollar');
 assert.equal(d.status,'PUBLIC_HEADING_SYMBOL_MATCH_REVIEW_ONLY');
});
test('search text or fake 200 page does not certify symbol',()=>{
 const d=parsePage('<h1>Market not found</h1><script>var code="BLOCKS"</script><p>All securities</p>','BLOCKS');
 assert.equal(d.identityHeadingMatches,false);
});
test('all unindexed and Yahoo 404 histories enter source-probe queue without live changes',()=>{
 const map={BONY:{ticker:'BONY',active:true,currency:'EGP'},
  GTEX:{ticker:'GTEX',active:true},OK:{ticker:'OK',active:true},
  OFF:{ticker:'OFF',active:false}};
 const h={symbols:[{ticker:'BONY',lastUpdateError:'failed HTTP 404'},{ticker:'GTEX',lastUpdateError:null}]};
 const s={stocks:[{ticker:'OK'},{ticker:'BONY'}]};
 const q=targets(map,h,s);assert.deepEqual(q.map(x=>x.ticker),['GTEX','BONY']);
});
