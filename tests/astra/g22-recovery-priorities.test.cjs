'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prioritize}=require('../../scripts/astra/g22-recovery-priorities.cjs');
test('distinguishes source and risk restrictions without promoting rejected securities',()=>{
 const x=prioritize({session:'2026-10-27',universeG11:224,rows:[
 {ticker:'AAA',actionableGroup:'REQUIRES_VERIFIED_CURRENT_BAR',reason:'CURRENT_SESSION_PRICE_MISSING',current:false},
 {ticker:'BBB',actionableGroup:'V16_RISK_FILTER_OR_FEATURE_REJECTION',v16RootCause:'ATR_ABOVE_V16_MAXIMUM_14_PCT',current:true},
 {ticker:'CCC',actionableGroup:'G11_V16_FEATURE_DISAGREEMENT',current:true}
 ]});
 assert.deepEqual(x.records.map(y=>y.ticker),['CCC','AAA','BBB']);
 assert.equal(x.certifiedDecisionReady,false);
 assert.equal(x.approvedPriceRepairs,0);
 assert.ok(x.records.every(y=>y.provisionalOnly===true));
});
