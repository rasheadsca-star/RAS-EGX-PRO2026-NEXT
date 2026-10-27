'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {diagnose}=require('../../scripts/astra/g22-g11-blocker-evidence.cjs');
test('separate missing current bars and production strategy readiness',()=>{
 const h={universe:{records:[{ticker:'AAAA',active:true},{ticker:'BBBB',active:true},{ticker:'CCCC',active:true}]},
 historyStats:[{ticker:'AAAA',symbolVerified:true,currentSessionAvailable:true,validSessions:100},{ticker:'BBBB',symbolVerified:true,currentSessionAvailable:false,validSessions:45},{ticker:'CCCC',symbolVerified:true,currentSessionAvailable:true,validSessions:20}],
 strategyReadiness:{rows:[{ticker:'AAAA',productionCritical:true,status:'READY',reason:'READY'},{ticker:'BBBB',productionCritical:true,status:'MISSING_PRICE',reason:'CURRENT_CANONICAL_SESSION_UNAVAILABLE'},{ticker:'CCCC',productionCritical:true,status:'INSUFFICIENT_HISTORY',reason:'MINIMUM_BARS_50'}]},
 metrics:{currentCanonicalSecurities:{numerator:2},decisionPipeline:{pipelineReadySecurities:1}}};
 const r=diagnose(h,'2026-10-27');assert.equal(r.counts.active,3);assert.equal(r.gaps.length,2);
 assert.equal(r.reasons.CURRENT_SESSION_PRICE_MISSING[0],'BBBB');
 assert.equal(r.reasons.MINIMUM_BARS_50[0],'CCCC');
 assert.equal(r.automaticPromotion,false);
});
