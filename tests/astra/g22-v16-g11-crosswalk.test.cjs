'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {crosswalk}=require('../../scripts/astra/g22-v16-g11-crosswalk.cjs');
test('crosswalk preserves evidence and distinguishes risk exclusion from missing prices',()=>{
 const g={session:'2026-10-27',counts:{active:224},gaps:[{ticker:'AAAA',current:false},{ticker:'BBBB',current:true},{ticker:'CCCC',current:true}]};
 const v={session:'2026-10-27',active:237,records:[{ticker:'AAAA',reason:'NO_CURRENT_SESSION_BAR'}, {ticker:'BBBB',reason:'BASE_FEATURE_REJECTED',rootCause:'ATR_ABOVE_V16_MAXIMUM_14_PCT'}, {ticker:'CCCC',reason:'FEATURE_OK'}]};
 const r=crosswalk(g,v);
 assert.equal(r.counts.REQUIRES_VERIFIED_CURRENT_BAR,1);
 assert.equal(r.counts.V16_RISK_FILTER_OR_FEATURE_REJECTION,1);
 assert.equal(r.counts.G11_V16_FEATURE_DISAGREEMENT,1);
 assert.equal(r.rows[1].v16RootCause,'ATR_ABOVE_V16_MAXIMUM_14_PCT');
 assert.equal(r.automaticPromotion,false);
});
test('crosswalk rejects mismatched sessions',()=>assert.throws(()=>crosswalk({session:'2026-10-27',gaps:[]},{session:'2026-10-26',records:[]}),/SESSION_MISMATCH/));
