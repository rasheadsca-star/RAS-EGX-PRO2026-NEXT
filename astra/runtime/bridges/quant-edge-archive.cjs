'use strict';
const ENGINE_ID='QUANT_EDGE';
function state(){
  return{
    engineId:ENGINE_ID,
    disposition:'HISTORICAL_OUTPUT_ONLY',
    runtimeMode:'HISTORICAL_OUTPUT_ONLY_NO_LIVE_CALL',
    algorithmicallyReproduced:false,
    liveDecisionInfluence:0,
    liveStrategyAvailable:false,
    blocked:true,
    blockReason:'ORIGINAL_ALGORITHM_UNAVAILABLE_LIVE_CALL_REMOVED_BY_G12',
    freshness:{isFresh:false},
    recommendations:[],
    asOf:null,
    sessionDate:null,
    provenance:{
      capabilityCoverage:'docs/astra/ENGINE_CAPABILITY_COVERAGE.json',
      migrationReconciliation:'docs/astra/MIGRATION_RECONCILIATION.json',
      parityEvidence:'docs/astra/G10_PARITY_RESULTS.json#QEDGE-OUTPUT-INTEGRITY',
      rawArchive:'GitHub Actions artifact astra-g07-migration-evidence-35019349149'
    }
  };
}
module.exports={ENGINE_ID,state};
