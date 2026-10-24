'use strict';
// PRODUCTION-DATA consistency check. Runs ONLY in the production gate (read-only, no writes).
// It was moved out of the unit-test file because it asserts on committed production artifacts.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');

test('market-universe history availability exactly matches repository history artifacts',()=>{
  const root=path.resolve(__dirname,'../..');
  const universe=JSON.parse(fs.readFileSync(path.join(root,'astra-prod/app/intelligence/market-universe.json'),'utf8'));
  const active=universe.records.filter(x=>x.active!==false);
  assert.equal(active.length,224);
  for(const r of active){
    const exists=fs.existsSync(path.join(root,'data/history',r.ticker+'.json'));
    assert.equal(Boolean(r.historyAvailable),exists,r.ticker+' historyAvailable/file mismatch');
    if(!exists) assert.equal(Number(r.historySessions||0),0,r.ticker+' unavailable history must expose zero sessions');
  }
});
