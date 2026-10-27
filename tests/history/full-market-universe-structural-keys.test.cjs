'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectFromObject,normalizeTicker}=require('../../scripts/history/full-market-universe-builder.cjs');
const keys=['BLOCKS','BUCKETS','FOLLOW','RISK','RULES'];
test('watchlist collection fields are not treated as securities',()=>{
 const fake={buckets:{follow:[{ticker:'COMI',name:'CIB',open:40,high:42,low:39,close:41,volume:1000}],risk:[{symbol:'HRHO',open:25,close:24,high:26,low:23,volume:100}]},
  rules:[{ticker:'ABUK'}],rows:[{ticker:'FWRY',blocks:[{reason:'bad price'}]}]};
 const d=new Map();collectFromObject(fake,'data/actionable-watchlist.json',d);
 for(const key of keys)assert.equal(d.has(key),false,key+' must not enter market universe');
 assert.ok(d.has('COMI'));assert.ok(d.has('HRHO'));assert.ok(d.has('FWRY'));
});
test('case-insensitive metadata keys remain distinct from verified explicit ticker fields',()=>{
 const d=new Map();collectFromObject({BLOCKS:{anything:{reason:'x'}},Buckets:{watch:[{ticker:'ETEL',open:10,high:11,low:9,close:10,volume:800}]},
  Follow:{name:'Follow'},Risk:{price:5},Rules:{price:10}},'data/actionable-watchlist.json',d);
 for(const key of keys)assert.equal(d.has(key),false,key);
 assert.ok(d.has('ETEL'));
});
test('a stock explicitly identified on a source row is not excluded because its name resembles a key',()=>{
 const d=new Map();collectFromObject({rows:[{ticker:'GTEX',name:'GTEX for Commercial & Industrial',open:.04,high:.05,low:.03,close:.04,volume:100}]},'data/market.json',d);
 assert.ok(d.has('GTEX'));
 assert.equal(normalizeTicker('GTEX.CA'),'GTEX');
});
