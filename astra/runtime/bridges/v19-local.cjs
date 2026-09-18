'use strict';
const {getStrategyDescriptor}=require('../../strategies/strategy-registry.cjs');
const {executeStrategy}=require('../../strategies/strategy-runner.cjs');
const STRATEGY_ID='V19_TOP10_PROBABILITY_INV_VOL_3';
const ENGINE_ID='V19_CHAT_GPT_NATIVE_CHALLENGER_V6';

function capability(){
  const spec=getStrategyDescriptor(STRATEGY_ID);
  if(!spec)throw new Error('V19_INTERNAL_SPEC_MISSING');
  return{
    engineId:ENGINE_ID,
    strategyId:STRATEGY_ID,
    runtimeMode:'LOCAL_G08_CONTRACT',
    sourceCommit:spec.sourceCommit,
    sourcePaths:spec.sourcePaths,
    canExecuteInternally:spec.canExecuteInternally===true,
    productionEligible:spec.productionEligible===true
  };
}
function executeV19(input){
  const out=executeStrategy(STRATEGY_ID,input||{});
  const selected=(out.evidenceItems||[]).map(x=>String(x.ticker||'').trim().toUpperCase()).filter(Boolean);
  return{
    engineId:ENGINE_ID,
    status:'SHADOW_RESEARCH_ONLY',
    runtimeMode:'LOCAL_G08_CONTRACT',
    executionAllowed:false,
    current:{
      signalDate:input?.snapshot?.sessionDate||null,
      selectedTickers:selected,
      candidates:out.evidenceItems||[]
    },
    strategyExecution:out
  };
}
function pendingState(){
  const cap=capability();
  return{
    engineId:ENGINE_ID,
    status:'LOCAL_INTERNAL_INPUT_PENDING',
    runtimeMode:cap.runtimeMode,
    executionAllowed:false,
    current:{signalDate:null,selectedTickers:[],candidates:[]},
    capability:cap
  };
}
module.exports={STRATEGY_ID,ENGINE_ID,capability,executeV19,pendingState};
