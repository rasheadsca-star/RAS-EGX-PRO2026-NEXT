'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {classifyMainProvenance,reconcileOne}=require('../../scripts/research/egx-central-price-conflict-attribution-v1.cjs');
const bar=(date,close)=>({date,open:close,high:close+1,low:close-1,close,volume:100});
test('reconstructed main OHLCV cannot be automatically treated as benchmark truth',()=>{
 const row={...bar('2026-10-20',110),warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']};
 const a=reconcileOne({ticker:'ABC',sessions:[bar('2026-10-20',100)]},{sessions:[row]});
 assert.equal(a.weakMainEvidenceDisagreements,1);assert.equal(a.eligibleForAutomaticPromotion,false);
});
test('independently sourced conflicting daily close also must be quarantined',()=>{
 const a=reconcileOne({ticker:'ABC',sessions:[bar('2026-10-20',100)]},{sessions:[{...bar('2026-10-20',110),source:'mubasher'}]});
 assert.equal(a.conflictWithNonReconstructedMain,1);assert.equal(a.eligibleForAutomaticPromotion,false);
});
test('aligned prices need no repair, while invalid long OHLCV does not count as valid',()=>{
 const a=reconcileOne({ticker:'ABC',sessions:[bar('2026-10-20',100),{...bar('2026-10-21',100),high:95}]},{sessions:[bar('2026-10-20',100)]});
 assert.equal(a.conflictCount,0);assert.equal(a.invalidHistoricalCandles,1);
});
test('officialVerified from secondary source is a claim, not automatic reclassification',()=>{
 assert.equal(classifyMainProvenance({officialVerified:true}),'MAIN_CLAIMS_OFFICIAL_VERIFICATION');
});
