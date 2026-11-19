import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RANKS,compute,outcomes} from './manual-importer.mjs';
const row=(rank,symbol,change,close,value)=>({rank,symbol,name:symbol,change,close,high:close+1,low:close-1,value,currency:'EGP',issues:[],page:17});
const mock={
  eligible:[row(1,'FWRY',5,20,1000000),row(2,'ZEOT',2,10,3000000),row(3,'HRHO',1,30,500000)],
  mapped:[row(1,'FWRY',5,20,1000000),row(2,'ZEOT',2,10,3000000),row(3,'HRHO',1,30,500000)]
};
test('nine weight sets are complete and unique',()=>{assert.equal(RANKS.length,9);assert.equal(new Set(RANKS).size,9)});
test('nine ranking outputs contain bounded price plans',()=>{
  const ranks=compute(mock);
  assert.deepEqual(Object.keys(ranks),RANKS);
  for(const v of Object.values(ranks)){assert.equal(v.length,3);for(const s of v){assert(s.entry>s.stop);assert(s.t1>s.entry);assert(s.t2>s.t1);assert(s.riskPct>0);assert.equal(s.identityVerified,false)}}
});
test('previous plans not entered are not executed losses',()=>{
  const prev={rankings:{'30/40/30':[{symbol:'FWRY',entry:99,stop:90,target1:105}]}};
  const row=outcomes(mock,prev)[0];assert.equal(row.state,'NO_ENTRY');assert.equal(row.executed,false);
});
test('unknown stock not counted as a paper trade',()=>{
  const prev={weights:{'30/40/30':[{symbol:'MISSING',entry:10,stop:8,t1:12}]}};
  assert.equal(outcomes(mock,prev)[0].state,'IDENTITY_OR_PRICE_UNAVAILABLE');
});
