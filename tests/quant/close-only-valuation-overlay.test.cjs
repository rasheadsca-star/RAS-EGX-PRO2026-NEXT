'use strict';
const assert=require('node:assert/strict');
const {selectCloseMarks}=require('../../scripts/quant/close-only-valuation-overlay.cjs');
const base={ticker:'FWRY',date:'2026-05-06',close:20.43,sourceUrl:'https://stockanalysis.com/quote/egx/FWRY/history/',independentEvidenceUrl:'https://www.egx.com.eg/',sourceIndependentlyChecked:true,priceBasis:'RAW_UNADJUSTED',status:'VERIFIED_TRADED'};
const ok=selectCloseMarks([base]);assert.equal(ok.acceptedCount,1);assert.equal(ok.accepted[0].strategyBarComplete,false);assert.equal(ok.productionMergeAllowed,false);
for(const bad of [{sourceIndependentlyChecked:false},{independentEvidenceUrl:null},{priceBasis:'UNKNOWN'},{close:''},{close:-1},{status:'UNRESOLVED'},{priceBasis:'ADJUSTED_WITH_VERIFIED_FACTOR',adjustmentFactor:null}]){
const res=selectCloseMarks([{...base,...bad}]);assert.equal(res.acceptedCount,0,JSON.stringify(bad));
}
assert.equal(selectCloseMarks([base,base]).blockedCount,1);
console.log('Close-only valuation separation: PASS');
