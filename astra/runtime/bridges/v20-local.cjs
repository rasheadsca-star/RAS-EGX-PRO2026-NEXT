'use strict';
const {SPECS,executeStrategy}=require('../../strategies/g08-final-overlay.cjs');
const STRATEGY_ID='V20_NATIVE_MULTI_COMPONENT_COMPOSITE';
const ENGINE_ID='V20_FULL_MARKET_NATIVE_SELECTION_V1';

function capability(){
  const spec=SPECS[STRATEGY_ID];
  if(!spec)throw new Error('V20_INTERNAL_SPEC_MISSING');
  return{
    engineId:ENGINE_ID,
    strategyId:STRATEGY_ID,
    runtimeMode:'LOCAL_G08_CONTRACT',
    sourceCommit:spec.sourceCommit,
    sourcePaths:spec.sourcePaths,
    canExecuteInternally:spec.canExecuteInternally===true,
    productionEligible:spec.productionEligible===true,
    weightsPct:spec.parameters.weightsPct
  };
}
function executeV20(input){
  const out=executeStrategy(STRATEGY_ID,input||{});
  return{
    engineId:ENGINE_ID,
    status:'SHADOW_RESEARCH_ONLY',
    runtimeMode:'LOCAL_G08_CONTRACT',
    executionAllowed:false,
    sessionDate:input?.snapshot?.sessionDate||null,
    publishedCandidates:out.eligibility==='ELIGIBLE'&&input?.snapshot?.ticker?[{ticker:input.snapshot.ticker,score:out.rawScore}]:[],
    strategyExecution:out
  };
}
function pendingState(){
  return{
    engineId:ENGINE_ID,
    status:'LOCAL_INTERNAL_INPUT_PENDING',
    runtimeMode:'LOCAL_G08_CONTRACT',
    executionAllowed:false,
    sessionDate:null,
    publishedCandidates:[],
    capability:capability()
  };
}
module.exports={STRATEGY_ID,ENGINE_ID,capability,executeV20,pendingState};
