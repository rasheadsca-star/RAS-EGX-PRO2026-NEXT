'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../../scripts/research/egx-g11-readiness-triage.cjs');
test('G11 measures canonical and pipeline independently, with real source reasons',()=>{
 const u=Array.from({length:224},(_,i)=>({ticker:'T'+i,active:true,companyNameEn:'Test '+i}));
 const h={
  universe:{records:u},metrics:{activeUniverse:{count:224},currentCanonicalSecurities:{numerator:204},
   decisionPipeline:{pipelineReadySecurities:116}},
  sessionIntegrity:{latestExpectedSession:'2026-10-26'},
  historyStats:[{ticker:'T1',symbolVerified:false,currentSessionAvailable:false,validSessions:0},
   {ticker:'T2',symbolVerified:true,currentSessionAvailable:true,validSessions:158,latestValidSession:'2026-10-26'}],
  strategyReadiness:{productionCritical:{readySecurities:116,globalTrainingSessions:50},
   rows:[{ticker:'T1',productionCritical:true,status:'SYMBOL_UNRESOLVED',reason:'SYMBOL_IDENTITY_NOT_VERIFIED'},
    {ticker:'T2',productionCritical:true,status:'INSUFFICIENT_HISTORY',reason:'EMBEDDED_V16_SOURCE_FEATURE_OR_CROSS_SECTION_NOT_READY'}]},
  issues:{highUnresolved:1,criticalUnresolved:0,issues:[{code:'REGIME_INPUT_INCOMPLETE',severity:'HIGH',affectedCount:1,affectedTickers:['T2']}]},
  pipeline:{ok:false,diagnostics:[{code:'NO_TRADE'}]}
 };
 const v=summarize(h,{expectedSession:'2026-10-26',missingHistoryFiles:['T1']});
 assert.equal(v.metrics.requiredCanonical,202);
 assert.equal(v.metrics.requiredPipeline,180);
 assert.equal(v.metrics.canonicalShortfall,0);
 assert.equal(v.metrics.pipelineShortfall,64);
 assert.equal(v.blockedReasons.SOURCE_HISTORY_MISSING,1);
 assert.equal(v.blockedReasons.G11_EMBEDDED_V16_SOURCE_FEATURE_OR_CROSS_SECTION_NOT_READY,1);
 assert.equal(v.productionEligible,false);
 assert.equal(v.exactSessionMatch,true);
});
test('refuses to mark different price-truth session matched',()=>{
 const h={sessionIntegrity:{latestExpectedSession:'2026-10-25'},metrics:{activeUniverse:{count:0}},universe:{records:[]}};
 assert.equal(summarize(h,{expectedSession:'2026-10-26'}).exactSessionMatch,false);
});
