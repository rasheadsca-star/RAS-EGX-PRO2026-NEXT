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

test('persistent tenfold cross-feed scale is flagged for corporate action or identity review, never adjusted',()=>{
 const ds=['2026-09-01','2026-09-02','2026-09-03','2026-09-06'];
 const raw=ds.map((date,i)=>bar(date,70+i));
 const main=ds.map((date,i)=>({...bar(date,(70+i)*10),source:'mubasher'}));
 const x=reconcileOne({ticker:'ORAS',sessions:raw},{sessions:main});
 assert.equal(x.conflictCount,4);
 assert.equal(x.suspectedScaleMismatch.classification,'STABLE_PRICE_SCALE_DISAGREEMENT_REQUIRES_CA_OR_IDENTITY_PROOF');
 assert.equal(x.suspectedScaleMismatch.autoAdjustAllowed,false);
 assert.ok(Math.abs(x.suspectedScaleMismatch.approximateMainToSourceFactor-10)<0.001);
});
test('isolated high price mismatch is not labelled a persistent price-scale issue',()=>{
 const x=reconcileOne({ticker:'ABC',sessions:[bar('2026-09-01',70)]},{sessions:[bar('2026-09-01',700)]});
 assert.equal(x.suspectedScaleMismatch,null);
});
