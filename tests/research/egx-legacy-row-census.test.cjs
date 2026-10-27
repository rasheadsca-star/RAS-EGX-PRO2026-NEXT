'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {census}=require('../../scripts/research/egx-legacy-row-census.cjs');
const price={date:'2026-07-02',open:10,high:12,low:9,close:11,volume:100,source:'workflow-market-snapshot'};
test('archive rows remain review-only despite passing OHLC arithmetic',()=>{
 const result=census({expectedSession:'2026-10-27',missingHistoryFiles:['BONY']},{generatedAt:'2026-07-02',symbols:{BONY:[price]}});
 assert.equal(result.validCandidateRows,1);assert.equal(result.executionGradeRows,0);assert.equal(result.productionPromotion,false);
});
test('reject invalid archived candles',()=>{
 const result=census({expectedSession:'2026-10-27',missingHistoryFiles:['BONY']},{symbols:{BONY:[{...price,high:8}]}});
 assert.equal(result.validCandidateRows,0);assert.equal(result.records[0].invalidRows,1);
});
test('missing archive tickers produce no fabricated history',()=>{
 const result=census({expectedSession:'2026-10-27',missingHistoryFiles:['ACTF']},{symbols:{}});
 assert.equal(result.records[0].rawRows,0);assert.equal(result.executionGradeRows,0);
});
