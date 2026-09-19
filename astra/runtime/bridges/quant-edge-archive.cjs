'use strict';
const {QUANT_EDGE_PROVENANCE}=require('../contracts/quant-edge-provenance.cjs');
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
    provenance:QUANT_EDGE_PROVENANCE
  };
}
module.exports={ENGINE_ID,state};
