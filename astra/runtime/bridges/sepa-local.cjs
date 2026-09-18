'use strict';

const {getStrategyDescriptor}=require('../../strategies/strategy-registry.cjs');
const {executeStrategy}=require('../../strategies/strategy-runner.cjs');

const STRATEGY_ID='SEPA_QVUA_NEAR_FIRST_THEN_FORMING';

function normalizeTicker(row){
  return String(row?.ticker||row?.symbol||row?.code||'').trim().toUpperCase();
}
function classify(rows){
  const near=[],forming=[],extended=[];
  for(const row of rows||[]){
    const status=String(row?.status||'').toUpperCase();
    if(status==='NEAR PIVOT')near.push(row);
    else if(status==='FORMING')forming.push(row);
    else if(status.includes('EXTENDED'))extended.push(row);
  }
  return{near,forming,extended};
}
function executeLocalSepa(input={}){
  const snapshot=input.snapshot||{};
  const history=Array.isArray(input.history)?input.history:[];
  const candidates=Array.isArray(input.candidates)?input.candidates:[];
  const result=executeStrategy(STRATEGY_ID,{snapshot,history,candidates,regimeContext:input.regimeContext||null});
  return result;
}
function materializeMirror(input={}){
  const result=executeLocalSepa(input);
  if(result.eligibility!=='ELIGIBLE'){
    return{
      schemaVersion:'gann-fusion-x-sepa-local-v2',
      generatedAt:input.generatedAt||new Date().toISOString(),
      sessionDate:input.snapshot?.sessionDate||null,
      meta:{
        source:'ASTRA_INTERNAL_SEPA_QVUA',
        mode:'INTERNAL_LOCAL_FAIL_CLOSED',
        strategyId:STRATEGY_ID,
        strategyVersion:result.strategyVersion,
        sourceCommit:getStrategyDescriptor(STRATEGY_ID).sourceCommit,
        selectionPolicy:getStrategyDescriptor(STRATEGY_ID).parameters.selectionPolicy,
        eligibilityReason:result.eligibilityReason
      },
      rows:[],views:{near:[],forming:[],extended:[],top:[]},verified:{records:[]}
    };
  }
  const selected=(result.evidenceItems||[]).map(row=>({...row,symbol:normalizeTicker(row)||row.symbol}));
  const groups=classify(input.candidates||[]);
  return{
    schemaVersion:'gann-fusion-x-sepa-local-v2',
    generatedAt:input.generatedAt||new Date().toISOString(),
    sessionDate:input.snapshot?.sessionDate||null,
    meta:{
      source:'ASTRA_INTERNAL_SEPA_QVUA',
      mode:'INTERNAL_LOCAL',
      strategyId:STRATEGY_ID,
      strategyVersion:result.strategyVersion,
      sourceCommit:getStrategyDescriptor(STRATEGY_ID).sourceCommit,
      selectionPolicy:getStrategyDescriptor(STRATEGY_ID).parameters.selectionPolicy,
      executionHash:result.executionHash
    },
    rows:selected,
    views:{near:groups.near,forming:groups.forming,extended:groups.extended,top:selected},
    verified:{records:[]}
  };
}
module.exports={STRATEGY_ID,executeLocalSepa,materializeMirror};
