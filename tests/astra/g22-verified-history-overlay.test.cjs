'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mergeHistory,validRow}=require('../../scripts/astra/g22-verified-history-overlay.cjs');
const ticker='TEST', expected='2026-10-27';
const bar=(date,extra={})=>({ticker,date,sourceSessionDate:date,open:10,high:11,low:9,close:10.5,volume:100,validationStatus:'single_source_validated',primarySource:'yahoo',sourceUrls:{primary:'https://query1.finance.yahoo.com/v8/finance/chart/TEST.CA'},...extra});
const doc=rows=>({ticker,symbolVerified:true,isin:'EGS123',sessions:rows});
test('fills pinned historical gap and preserves exact provenance without certifying execution',()=>{
 const observed=bar('2026-10-26');const merged=mergeHistory(doc([bar('2026-09-17')]),doc([observed]),ticker,expected);
 assert.deepEqual(merged.added,['2026-10-26']);assert.deepEqual(merged.document.sessions[1],observed);assert.equal(merged.document.sessions[1].validationStatus,'single_source_validated');
});
test('future rows never enter historical or current inputs',()=>{
 const result=mergeHistory(doc([]),doc([bar('2026-10-28')]),ticker,expected);assert.equal(result.added.length,0);assert.equal(result.rejected[0].reason,'SESSION_INVALID_OR_FUTURE');
});
test('missing values, fabricated OHLC warnings and rejected sources fail closed',()=>{
 for(const extra of [{volume:null},{volume:''},{volume:' '},{validationStatus:'ANYTHING'},{primarySource:'untrusted'},{open:undefined},{warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']},{validationStatus:'source_conflict'},{sourceUrls:{}},{sourceSessionDate:'2026-10-25'}]) assert.ok(validRow(bar('2026-10-26',extra),ticker,expected));
});
test('source conflicts cannot overwrite pinned observed prices',()=>{
 const original=bar('2026-10-26');const result=mergeHistory(doc([original]),doc([bar('2026-10-26',{close:10.8})]),ticker,expected);
 assert.deepEqual(result.document.sessions,[original]);assert.equal(result.rejected[0].reason,'PINNED_SOURCE_PRICE_CONFLICT');
});
test('conflicting duplicates reject both alternatives',()=>{
 const result=mergeHistory(doc([]),doc([bar('2026-10-26'),bar('2026-10-26',{close:10.8})]),ticker,expected);assert.equal(result.added.length,0);assert.equal(result.rejected[0].reason,'CONFLICTING_SOURCE_DUPLICATE');
});
test('unverified, swapped ticker and ISIN conflicts reject the whole source',()=>{
 for(const extra of [{symbolVerified:false},{ticker:'OTHER'},{isin:'WRONG'}]){const result=mergeHistory(doc([]),{...doc([bar('2026-10-26')]),...extra},ticker,expected);assert.equal(result.added.length,0);assert.equal(result.rejected[0].reason,'IDENTITY_NOT_VERIFIED_OR_CONFLICT');}
});
test('a second overlay is idempotent',()=>{
 const source=doc([bar('2026-10-26')]);const once=mergeHistory(doc([]),source,ticker,expected);const twice=mergeHistory(once.document,source,ticker,expected);assert.equal(twice.added.length,0);assert.deepEqual(twice.document,once.document);
});

test('impossible dates and EGX weekend dates fail validation',()=>{assert.ok(validRow(bar('2026-02-30'),ticker,expected));assert.equal(validRow(bar('2026-10-23'),ticker,expected),'NON_TRADING_WEEKDAY');});

test('recognized provider cannot lend another security its source URL',()=>{assert.equal(validRow(bar('2026-10-26',{sourceUrls:{primary:'https://query1.finance.yahoo.com/v8/finance/chart/WRONG.CA'}}),ticker,expected),'SOURCE_URL_TICKER_MISMATCH');});
