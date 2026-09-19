'use strict';

const {validatedHistoryRows}=require('../core/historical-store.cjs');
const {executeRegisteredStrategy}=require('../strategies/strategy-runner.cjs');
const {rankCandidates}=require('../pipeline/ranking-engine.cjs');
const {prepareRisk}=require('../pipeline/risk-engine.cjs');
const {isTrading}=require('../core/market-calendar.cjs');

const EVIDENCE_CLASS='RETROSPECTIVE_BACKTEST';

function dateOf(row){return String(row?.sessionDate||row?.date||'').slice(0,10)}
function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);
  for(const child of Object.values(value))deepFreeze(child);
  return value;
}
function historyThrough(historyByTicker,sessionDate){
  const out={};
  for(const [ticker,rows] of Object.entries(historyByTicker||{})){
    out[ticker]=(Array.isArray(rows)?rows:[])
      .filter(row=>{const d=dateOf(row);return d&&d<=sessionDate})
      .slice()
      .sort((a,b)=>dateOf(a).localeCompare(dateOf(b)));
  }
  const check=validatedHistoryRows(out,sessionDate);
  if(!check.ok)throw Object.assign(new Error('BACKTEST_HISTORY_NOT_POINT_IN_TIME'),{code:'BACKTEST_HISTORY_NOT_POINT_IN_TIME',details:check});
  return deepFreeze(out);
}
function normalizeSessions(sessions,marketPolicy=null){
  const ordered=[...new Set((sessions||[]).map(x=>String(x).slice(0,10)).filter(Boolean))].sort();
  if(marketPolicy)return ordered.filter(s=>isTrading(s,marketPolicy));
  return ordered;
}
function netReturnPct(entryPrice,exitPrice,costPct=0){
  const entry=Number(entryPrice),exit=Number(exitPrice),cost=Number(costPct);
  if(!(Number.isFinite(entry)&&entry>0&&Number.isFinite(exit)&&exit>0&&Number.isFinite(cost)&&cost>=0))return null;
  return (exit/entry-1)*100-cost;
}
function summarizeReturns(returns){
  const xs=(returns||[]).map(Number).filter(Number.isFinite);
  if(!xs.length)return{count:0,meanReturnPct:null,winRatePct:null,cumulativeSimpleReturnPct:null};
  const sum=xs.reduce((a,b)=>a+b,0);
  return{
    count:xs.length,
    meanReturnPct:sum/xs.length,
    winRatePct:xs.filter(x=>x>0).length/xs.length*100,
    cumulativeSimpleReturnPct:sum
  };
}
function rankAndPrepareRisk(candidateRecords,{capitalEgp,regime,basketSize}){
  const ranked=rankCandidates(candidateRecords||[]);
  const risk=ranked.map(candidate=>({ticker:candidate.ticker,result:prepareRisk(candidate,capitalEgp,regime,basketSize)}));
  return deepFreeze({ranked,risk});
}
function runBacktest({
  strategyId,historyByTicker={},sessions=[],
  buildInput,evaluateOutcome,costPct=0,marketPolicy=null,
  frozenStrategyVersion=null
}={}){
  if(!strategyId)throw new Error('BACKTEST_STRATEGY_ID_REQUIRED');
  if(typeof buildInput!=='function')throw new Error('BACKTEST_BUILD_INPUT_REQUIRED');
  if(typeof evaluateOutcome!=='function')throw new Error('BACKTEST_OUTCOME_EVALUATOR_REQUIRED');
  const ordered=normalizeSessions(sessions,marketPolicy);
  const observations=[];
  for(const sessionDate of ordered){
    const pointInTimeHistory=historyThrough(historyByTicker,sessionDate);
    const input=buildInput({sessionDate,historyByTicker:pointInTimeHistory});
    if(input?.forwardOutcome||input?.laterRecommendationOutcome)throw new Error('BACKTEST_FUTURE_OUTCOME_INPUT_FORBIDDEN');
    const execution=executeRegisteredStrategy(strategyId,input);
    const outcome=evaluateOutcome({sessionDate,execution,historyByTicker});
    observations.push(deepFreeze({
      sessionDate,
      strategyId,
      frozenStrategyVersion:frozenStrategyVersion||null,
      execution,
      outcome:outcome??null,
      evidenceClass:EVIDENCE_CLASS
    }));
  }
  const returns=observations.map(x=>Number(x?.outcome?.returnPct)).filter(Number.isFinite);
  return deepFreeze({
    schemaVersion:'astra-backtest-evidence-1',
    evidenceClass:EVIDENCE_CLASS,
    strategyId,
    frozenStrategyVersion:frozenStrategyVersion||null,
    costPct:Number(costPct)||0,
    sessionCount:ordered.length,
    observations,
    statistics:summarizeReturns(returns),
    forwardEvidenceInfluence:0,
    productionCutover:false
  });
}

module.exports=Object.freeze({
  EVIDENCE_CLASS,historyThrough,normalizeSessions,netReturnPct,summarizeReturns,rankAndPrepareRisk,runBacktest
});
