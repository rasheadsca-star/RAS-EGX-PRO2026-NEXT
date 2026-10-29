'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const symbolMap=JSON.parse(fs.readFileSync(path.join(root,'data/symbol-map.json'),'utf8'));
const index=JSON.parse(fs.readFileSync(path.join(root,'data/quant/market-search-index-v13-17.json'),'utf8'));
test('all active mapped securities are searchable',()=>{
 const indexed=new Set(index.stocks.map(x=>x.ticker));
 const missing=Object.values(symbolMap).filter(x=>x&&x.active!==false&&x.ticker&&!indexed.has(x.ticker)).map(x=>x.ticker);
 assert.deepEqual(missing,[]);
});
test('unverified search-only symbols do not masquerade as priced or actionable',()=>{
 const rows=index.stocks.filter(x=>x.searchOnly===true);
 assert.ok(rows.length>0);
 for(const row of rows){
  assert.equal(row.symbolVerified,false,row.ticker);
  assert.equal(row.executionReady,false,row.ticker);
  assert.equal(row.inTodayRecommendations,false,row.ticker);
  assert.equal(row.price,null,row.ticker);
  assert.equal(row.volume,null,row.ticker);
  assert.equal(row.turnover,null,row.ticker);
  assert.equal(row.historyAvailable,false,row.ticker);
  assert.equal(row.decisionCode,'SYMBOL_IDENTITY_UNVERIFIED',row.ticker);
 }
});
test('search index metadata counts reflect its current rows',()=>{
 assert.equal(index.summary.stocks,index.stocks.length);
 assert.equal(index.summary.todayRecommendations,index.stocks.filter(x=>x.inTodayRecommendations).length);
 assert.equal(index.summary.outsideToday,index.stocks.filter(x=>!x.inTodayRecommendations).length);
});
