'use strict';

const {validatedHistoryRows}=require('../core/historical-store.cjs');
const {executeRegisteredStrategy}=require('../strategies/strategy-runner.cjs');
const {rankCandidates}=require('../pipeline/ranking-engine.cjs');
const {prepareRisk}=require('../pipeline/risk-engine.cjs');
const {isTrading}=require('../core/market-calendar.cjs');

const EVIDENCE_CLASS='WALK_FORWARD_EVALUATION';

function dateOf(row){return String(row?.sessionDate||row?.date||'').slice(0,10)}
function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);
  for(const child of Object.values(value))deepFreeze(child);
  return value;
}
function normalizeSessions(sessions,marketPolicy=null){
  const ordered=[...new Set((sessions||[]).map(x=>String(x).slice(0,10)).filter(Boolean))].sort();
  if(marketPolicy)return ordered.filter(s=>isTrading(s,marketPolicy));
  return ordered;
}
function buildWalkForwardWindows(sessions,{
  trainSessions,testSessions,stepSessions=testSessions,embargoSessions=0,marketPolicy=null
}={}){
  const ordered=normalizeSessions(sessions,marketPolicy);
  const train=Number(trainSessions),test=Number(testSessions),step=Number(stepSessions),embargo=Number(embargoSessions);
  if(![train,test,step].every(x=>Number.isInteger(x)&&x>0)||!(Number.isInteger(embargo)&&embargo>=0))throw new Error('WALK_FORWARD_WINDOW_CONFIG_INVALID');
  const windows=[];
  for(let start=0;;start+=step){
    const trainEnd=start+train-1;
    const testStart=trainEnd+1+embargo;
    const testEnd=testStart+test-1;
    if(testEnd>=ordered.length)break;
    const trainDates=ordered.slice(start,trainEnd+1);
    const testDates=ordered.slice(testStart,testEnd+1);
    windows.push(deepFreeze({
      windowId:`WF-${String(windows.length+1).padStart(3,'0')}`,
      trainDates,testDates,
      trainStart:trainDates[0],trainEnd:trainDates.at(-1),
      testStart:testDates[0],testEnd:testDates.at(-1),
      embargoSessions:embargo
    }));
  }
  assertNoLeakage(windows);
  return deepFreeze(windows);
}
function assertNoLeakage(windows){
  for(const w of windows||[]){
    if(!w.trainDates?.length||!w.testDates?.length)throw new Error('WALK_FORWARD_EMPTY_WINDOW');
    if(w.trainEnd>=w.testStart)throw new Error('WALK_FORWARD_TRAIN_TEST_LEAKAGE');
    const trainSet=new Set(w.trainDates);
    if(w.testDates.some(d=>trainSet.has(d)))throw new Error('WALK_FORWARD_WINDOW_OVERLAP');
    if([...w.trainDates,...w.testDates].some((d,i,a)=>i>0&&d<a[i-1]))throw new Error('WALK_FORWARD_NON_CHRONOLOGICAL_WINDOW');
  }
  return true;
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
  if(!check.ok)throw Object.assign(new Error('WALK_FORWARD_HISTORY_NOT_POINT_IN_TIME'),{code:'WALK_FORWARD_HISTORY_NOT_POINT_IN_TIME',details:check});
  return deepFreeze(out);
}
function rankAndPrepareRisk(candidateRecords,{capitalEgp,regime,basketSize}){
  const ranked=rankCandidates(candidateRecords||[]);
  const risk=ranked.map(candidate=>({ticker:candidate.ticker,result:prepareRisk(candidate,capitalEgp,regime,basketSize)}));
  return deepFreeze({ranked,risk});
}
function runWalkForward({
  strategyId,historyByTicker={},windows=[],
  buildInput,evaluateOutcome,frozenStrategyVersion=null
}={}){
  if(!strategyId)throw new Error('WALK_FORWARD_STRATEGY_ID_REQUIRED');
  if(typeof buildInput!=='function')throw new Error('WALK_FORWARD_BUILD_INPUT_REQUIRED');
  if(typeof evaluateOutcome!=='function')throw new Error('WALK_FORWARD_OUTCOME_EVALUATOR_REQUIRED');
  assertNoLeakage(windows);
  const results=[];
  for(const window of windows){
    const trainCutoff=window.trainEnd;
    const frozenTrainingHistory=historyThrough(historyByTicker,trainCutoff);
    const tests=[];
    for(const sessionDate of window.testDates){
      const pointInTimeHistory=historyThrough(historyByTicker,sessionDate);
      const input=buildInput({
        sessionDate,
        trainCutoff,
        trainingHistory:frozenTrainingHistory,
        historyByTicker:pointInTimeHistory,
        window
      });
      if(input?.forwardOutcome||input?.laterRecommendationOutcome)throw new Error('WALK_FORWARD_FUTURE_OUTCOME_INPUT_FORBIDDEN');
      const execution=executeRegisteredStrategy(strategyId,input);
      const outcome=evaluateOutcome({sessionDate,execution,historyByTicker,window});
      tests.push(deepFreeze({sessionDate,execution,outcome:outcome??null}));
    }
    results.push(deepFreeze({windowId:window.windowId,trainStart:window.trainStart,trainEnd:window.trainEnd,testStart:window.testStart,testEnd:window.testEnd,tests}));
  }
  return deepFreeze({
    schemaVersion:'astra-walk-forward-evidence-1',
    evidenceClass:EVIDENCE_CLASS,
    strategyId,
    frozenStrategyVersion:frozenStrategyVersion||null,
    windows:results,
    forwardEvidenceInfluence:0,
    productionCutover:false
  });
}

module.exports=Object.freeze({
  EVIDENCE_CLASS,normalizeSessions,buildWalkForwardWindows,assertNoLeakage,historyThrough,rankAndPrepareRisk,runWalkForward
});
