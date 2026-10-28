'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileFetchStatus,validOhlc}=require('../../scripts/stable/v16-market-coverage-reconciler.cjs');
const base={expectedSession:'2026-10-27',inputRows:213,marketRows:193,currentSessionRows:193,rejectedCurrentSessionRows:20,coveragePct:90.61,message:'Accepted 193 EGX prices'};
const params={now:'2026-10-27T22:00:41Z',ready:true,executionGrade:true,acceptedRows:195,rejectedRows:18,inputRows:213,effectiveMatchingRows:205,effectiveCoveragePct:96.24,cumulativeSecondSourceTickers:[],expectedSession:'2026-10-27'};
test('verified recoveries update every affected fetch-status count, without changing independent session evidence denominator',()=>{
 const out=reconcileFetchStatus(base,params);
 assert.equal(out.marketRows,195);
 assert.equal(out.currentSessionRows,195);
 assert.equal(out.rejectedCurrentSessionRows,18);
 assert.equal(out.coveragePct,91.55);
 assert.equal(out.sourceSessionEvidenceCoveragePct,96.24);
 assert.equal(out.verifiedSessionRows,205);
 assert.match(out.message,/195 verified EGX prices/);
 assert.equal(base.marketRows,193);
});
test('reconciled row counts cannot exceed observed input universe',()=>{
 assert.throws(()=>reconcileFetchStatus(base,{...params,acceptedRows:205,rejectedRows:20}),/RECONCILED_COUNTS_EXCEED_SOURCE_INPUT/);
 assert.throws(()=>reconcileFetchStatus(base,{...params,acceptedRows:214}),/INVALID_RECONCILED_ROW_COUNTS/);
});

test('same-session close confirmation never fabricates open high or low',()=>{
 const closeOnly={price:10,volume:500};
 assert.equal(validOhlc(closeOnly,10),null);
 assert.equal(validOhlc({open:9,high:11,price:10,volume:500},10),null);
 assert.equal(validOhlc({open:9,low:8,price:10,volume:500},10),null);
 assert.equal(validOhlc({open:9,high:11,low:8,price:10,volume:500},10).high,11);
});
test('recovered OHLCV requires actual volume and unmodified observed bounds',()=>{
 const observed={open:9,high:11,low:8,close:10,volume:100};
 assert.deepEqual(validOhlc(observed),observed);
 for(const volume of [null,undefined,'',-1,1.5])
  assert.equal(validOhlc({...observed,volume}),null,'invalid volume '+volume);
 assert.equal(validOhlc({...observed,high:9.5}),null);
 assert.equal(validOhlc({...observed,low:10.5}),null);
 assert.equal(validOhlc({...observed,open:12}),null);
});
