'use strict';
const assert=require('node:assert/strict');const {audit,family}=require('../../scripts/quant/audit-source-lineage.cjs');
assert.equal(family('Yahoo Finance / yfinance / Kaggle'),'YAHOO_FINANCE');
assert.equal(family('https://query1.finance.yahoo.com/v8/finance/chart'),'YAHOO_FINANCE');
const seed=[
{ticker:'ABCD',date:'2026-01-26',open:9,high:10,low:8,close:9,volume:100,source:'Kaggle / Yahoo Finance',qualityStatus:'VALID_STRUCTURAL'},
{ticker:'MOSC',date:'2026-01-26',open:164,high:169,low:159,close:161.55,volume:6232,source:'yfinance',qualityStatus:'VALID_STRUCTURAL'},
{ticker:'NOPE',date:'2026-01-27',close:1,volume:10,source:'yfinance',qualityStatus:'QUARANTINED'}];
const archive=[
{ticker:'ABCD',date:'2026-01-26',open:9,high:10,low:8,close:9,volume:100,source:'yahoo'},
{ticker:'MOSC',date:'2026-01-26',open:164,high:169,low:159,close:162.05,adjustedClose:161.55,volume:6232,source:'Yahoo Finance'}];
const r=audit(seed,archive);assert.equal(r.count.overlapPairs,2);
assert.equal(r.count.sameSourceLineage,2);assert.equal(r.count.rawCloseMatches,1);
assert.equal(r.count.adjustedOnlyMatches,1);assert.equal(r.count.volumeMatches,2);
assert.equal(r.count.ohlcvExactMatches,1);assert.equal(r.independentlyVerifiedRows,0);
assert.equal(r.productionPriceImports,0);
assert.equal(r.conflicts[0].reason,'ADJUSTED_VS_RAW_CLOSE');
assert.throws(()=>audit([...seed,seed[0]],archive));
console.log('Source-lineage audit: PASS');
