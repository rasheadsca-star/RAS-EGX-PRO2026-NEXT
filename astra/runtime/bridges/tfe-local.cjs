'use strict';

const {getStrategyDescriptor}=require('../../strategies/strategy-registry.cjs');
const {executeStrategy}=require('../../strategies/strategy-runner.cjs');

const STRATEGY_ID='TFE_EVIDENCE_AWARE_HARD_GATE_FUSION';

function evaluateTfe(input={}){
  const snapshot=input.snapshot||{};
  const history=Array.isArray(input.history)?input.history:[];
  const components=input.components||{};
  return executeStrategy(STRATEGY_ID,{snapshot,history,components});
}
function health(){
  const spec=getStrategyDescriptor(STRATEGY_ID);
  return{
    ok:true,
    engine:'TFE_V20_FUSION_RC2_INTERNAL',
    mode:'ASTRA_INTERNAL_LOCAL',
    strategyId:STRATEGY_ID,
    strategyVersion:spec.sourceCommit,
    productionCutover:false,
    legacyNetworkCalls:0
  };
}
module.exports={STRATEGY_ID,evaluateTfe,health};
