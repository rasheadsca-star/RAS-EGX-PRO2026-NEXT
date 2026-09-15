'use strict';

const crypto=require('crypto');
const {SPECS,executeStrategy}=require('../strategies/g08-final-overlay.cjs');

const VERSION=Object.freeze({
  pipeline:'ASTRA_G09_PIPELINE_1',
  eligibility:'ASTRA_G09_PRODUCTION_ELIGIBILITY_1',
  regime:'EGX_PRO_MARKET_REGIME_BREADTH_1.0',
  evidence:'ASTRA_G09_EVIDENCE_1',
  agreement:'ASTRA_G09_AGREEMENT_1',
  ranking:'ASTRA_G09_V16_9_SOURCE_ORDER_1',
  risk:'ASTRA_G09_V16_9_RISK_1',
  basket:'V16_9_EQUAL_WEIGHT_BASKET_PILOT',
  snapshot:'ASTRA_G09_DECISION_SNAPSHOT_1'
});

const ACTIVE_STRATEGY='PORTFOLIO_BASKET_EQUAL_WEIGHT';
const EMBEDDED_SELECTION_MODEL='V16_TWO_STAGE_TOP_GAINER';
const QUANT_EDGE='QUANT_EDGE';
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const DIAGNOSTIC_CODES=Object.freeze([
  'DECISION_INPUT_INVALID','REGIME_EXECUTION_FAILED','STRATEGY_EXECUTION_FAILED',
  'STRATEGY_NOT_PRODUCTION_ELIGIBLE','INSUFFICIENT_INDEPENDENT_EVIDENCE',
  'EVIDENCE_CONTRADICTION','RANKING_INPUT_INVALID','RISK_PLAN_INVALID',
  'BASKET_CONSTRAINT_FAILED','VALID_ZERO_OPPORTUNITY_SESSION',
  'DECISION_SNAPSHOT_INCONSISTENT','TEMPORAL_LEAKAGE_GUARD_FAILED',
  'INVALID_UNRESOLVED_DATA_QUARANTINED','QUANT_EDGE_LIVE_INFLUENCE_FORBIDDEN',
  'ALL_PRODUCTION_STRATEGIES_FAILED','BASKET_SELECTION_MODEL_INELIGIBLE'
]);

const CONFIG=Object.freeze({
  schemaVersion:'astra-g09-config-1',
  versions:VERSION,
  productionStrategyApproval:Object.freeze({
    strategyId:ACTIVE_STRATEGY,
    sourceEngine:'V16_9_EQUAL_WEIGHT_BASKET',
    approvedStrategyVersion:'2351b2ec2bbcf3e36e992021e26b36845e879ab0',
    requiredLifecycleStatus:'active',
    requiredProductionEligible:true,
    allowedBasketSizes:Object.freeze([3,4,5]),
    maxTotalExposurePct:50,
    failedWeightPolicy:'KEEP_CASH',
    selectionComponent:Object.freeze({
      strategyId:EMBEDDED_SELECTION_MODEL,
      role:'EMBEDDED_SOURCE_PINNED_SELECTION_MODEL_NOT_INDEPENDENT_VOTER',
      sourceEvidence:'scripts/research/v16-v169-basket-engine.py',
      rationale:'The certified V16.9 basket source ranks candidates with the existing out-of-sample top-gainer probability model, then equal-weights the selected basket.'
    })
  }),
  regimeSource:Object.freeze({
    path:'scripts/stable/v16-market-regime-engine.cjs',
    methodology:'EGX_PRO_MARKET_REGIME_BREADTH_1.0'
  }),
  rankingSource:Object.freeze({
    path:'scripts/research/v16-v169-basket-engine.py',
    rule:'Preserve source selection order/score; no new weighted decision-score formula is introduced in G09.'
  }),
  riskSource:Object.freeze({
    path:'scripts/research/v16-v169-basket-engine.py',
    entryAtrLow:-0.08,entryAtrHigh:0.08,stopAtr:-0.90,targetAtr:1.20,
    portfolioAllocationPct:50,unfilledMemberPolicy:'KEEP_CASH'
  }),
  evidenceFamilies:Object.freeze({
    MODEL_SELECTION:'selection model and basket membership are correlated; count once',
    LIQUIDITY:'source-model liquidity gate/input',
    REGIME:'market-regime context; not a second strategy vote',
    STRUCTURE:'entry/stop/target structural plan where present'
  }),
  tieBreak:Object.freeze(['sourceSelectionScore DESC','ticker ASC'])
});

function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
function stableHash(v){return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}
function finite(v,d=null){const n=Number(v);return Number.isFinite(n)?n:d}
function round(v,d=6){const n=finite(v);return n===null?null:Number(n.toFixed(d))}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function median(a){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function deepFreeze(o){if(!o||typeof o!=='object'||Object.isFrozen(o))return o;Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);return o}
function diagnostic(code,severity='ERROR',context={}){if(!DIAGNOSTIC_CODES.includes(code))throw new Error(`Unknown G09 diagnostic ${code}`);return{code,severity,context}}
function asDate(row){return String(row?.sessionDate||row?.date||'').slice(0,10)}
function after(a,b){return DATE_RE.test(a)&&DATE_RE.test(b)&&a>b}
function migrationBad(v){return['INVALID','UNRESOLVED','QUARANTINED'].includes(String(v||'').toUpperCase())}
function assertFiniteUnit(value,name,{positive=false,nonNegative=false}={}){const n=Number(value);if(!Number.isFinite(n))throw Object.assign(new Error(`${name} must be finite`),{code:'DECISION_INPUT_INVALID'});if(positive&&!(n>0))throw Object.assign(new Error(`${name} must be > 0`),{code:'DECISION_INPUT_INVALID'});if(nonNegative&&n<0)throw Object.assign(new Error(`${name} must be >= 0`),{code:'DECISION_INPUT_INVALID'});return n}

function productionEligibility(strategyId,context,regime){
  if(strategyId===QUANT_EDGE)return{internallyExecutable:false,productionEligible:false,reason:'QUANT_EDGE_HISTORICAL_OUTPUT_ONLY'};
  const spec=SPECS[strategyId];
  if(!spec)return{internallyExecutable:false,productionEligible:false,reason:'UNKNOWN_STRATEGY'};
  const approved=context?.approvedStrategyVersions?.[strategyId]||CONFIG.productionStrategyApproval.approvedStrategyVersion;
  const versionApproved=strategyId===ACTIVE_STRATEGY&&approved===spec.sourceCommit;
  const internallyExecutable=spec.canExecuteInternally===true;
  const lifecycleApproved=spec.lifecycleStatus===CONFIG.productionStrategyApproval.requiredLifecycleStatus;
  const evidenceApproved=['RECONSTRUCTED','EXPERIMENTAL_RECONSTRUCTED','RETIRED_RECONSTRUCTED'].includes(spec.reconstructionStatus);
  const directlyProductionEligible=spec.productionEligible===true;
  const regimeCompatible=Boolean(regime&&regime.regime);
  const requiredConfig=Number.isInteger(context?.approvedConfig?.basketSize)&&CONFIG.productionStrategyApproval.allowedBasketSizes.includes(context.approvedConfig.basketSize);
  const productionEligible=Boolean(strategyId===ACTIVE_STRATEGY&&internallyExecutable&&lifecycleApproved&&evidenceApproved&&directlyProductionEligible&&versionApproved&&regimeCompatible&&requiredConfig);
  const reason=productionEligible?'PRODUCTION_ELIGIBLE':!internallyExecutable?'NOT_INTERNALLY_EXECUTABLE':!lifecycleApproved?'LIFECYCLE_NOT_APPROVED':!directlyProductionEligible?'G08_PRODUCTION_ELIGIBILITY_FALSE':!versionApproved?'STRATEGY_VERSION_NOT_APPROVED':!requiredConfig?'APPROVED_CONFIG_MISSING_OR_INVALID':'REGIME_NOT_AVAILABLE';
  return{internallyExecutable,productionEligible,reason,lifecycleStatus:spec.lifecycleStatus,evidenceStatus:spec.reconstructionStatus,versionApproved,regimeCompatible,requiredConfig};
}

function validateContext(context){
  const errors=[];const temporal=[];const quarantined=[];
  if(!context||!DATE_RE.test(String(context.sessionDate||'')))errors.push('SESSION_DATE_INVALID');
  const session=String(context?.sessionDate||'');
  const snap=context?.canonicalSnapshot;
  if(!snap||!snap.snapshotId||snap.sessionDate!==session||!Array.isArray(snap.rows)||!snap.rows.length)errors.push('CANONICAL_SNAPSHOT_INVALID');
  const rows=Array.isArray(snap?.rows)?snap.rows:[];
  for(const row of rows){
    const ticker=String(row?.ticker||'');
    if(!ticker||row.sessionDate!==session)errors.push(`ROW_SESSION_OR_TICKER_INVALID:${ticker||'UNKNOWN'}`);
    if(row.validationStatus!=='VALID'||migrationBad(row.migrationValidationStatus)){quarantined.push(ticker||'UNKNOWN');continue}
    const srDate=String(row?.supportResistanceInputs?.asOfSessionDate||row?.supportResistanceInputs?.sessionDate||'');
    if(srDate&&after(srDate,session))temporal.push(`${ticker}:SUPPORT_RESISTANCE:${srDate}`);
    const regimeDate=String(row?.technicalInputs?.regimeSessionDate||'');if(regimeDate&&after(regimeDate,session))temporal.push(`${ticker}:REGIME:${regimeDate}`);
  }
  for(const [ticker,history] of Object.entries(context?.historyByTicker||{}))for(const row of history||[]){
    const d=asDate(row);if(d&&after(d,session))temporal.push(`${ticker}:HISTORY:${d}`);
    if(row.validationStatus!=='VALID'||migrationBad(row.migrationValidationStatus))quarantined.push(`${ticker}:HISTORY`);
  }
  for(const row of context?.modelGuardHistory||[]){const d=asDate(row);if(d&&after(d,session))temporal.push(`MODEL_GUARD_HISTORY:${d}`);if(row.validationStatus!=='VALID'||migrationBad(row.migrationValidationStatus))quarantined.push('MODEL_GUARD_HISTORY')}
  for(let s=0;s<(context?.modelTrainingSessions||[]).length;s++)for(const row of context.modelTrainingSessions[s]||[]){
    const d=asDate(row);if(d&&after(d,session))temporal.push(`${row.ticker||'UNKNOWN'}:TRAINING:${d}`);
    if(row.validationStatus&&row.validationStatus!=='VALID')quarantined.push(`${row.ticker||'UNKNOWN'}:TRAINING`);
    if(migrationBad(row.migrationValidationStatus))quarantined.push(`${row.ticker||'UNKNOWN'}:TRAINING`);
    if(row.forwardOutcome||row.laterRecommendationOutcome)temporal.push(`${row.ticker||'UNKNOWN'}:FUTURE_OUTCOME_FIELD`);
  }
  for(const row of context?.modelCurrentRows||[]){const d=asDate(row);if(d&&d!==session)temporal.push(`${row.ticker||'UNKNOWN'}:CURRENT_MODEL_ROW:${d}`);if(row.forwardOutcome||row.laterRecommendationOutcome)temporal.push(`${row.ticker||'UNKNOWN'}:FUTURE_OUTCOME_FIELD`)}
  if(quarantined.length)return{ok:false,code:'INVALID_UNRESOLVED_DATA_QUARANTINED',details:[...new Set(quarantined)]};
  if(temporal.length)return{ok:false,code:'TEMPORAL_LEAKAGE_GUARD_FAILED',details:[...new Set(temporal)]};
  if(errors.length)return{ok:false,code:'DECISION_INPUT_INVALID',details:errors};
  const capital=finite(context?.capitalEgp);if(!(capital>0))return{ok:false,code:'DECISION_INPUT_INVALID',details:['CAPITAL_EGP_MUST_BE_POSITIVE']};
  return{ok:true,universeCount:rows.length};
}

function computeRegime(context){
  const rows=context.canonicalSnapshot.rows;const metricsRows=rows.map(row=>row.technicalInputs||{});
  const advances=metricsRows.filter(x=>finite(x.return1Pct,0)>.05).length;
  const declines=metricsRows.filter(x=>finite(x.return1Pct,0)<-.05).length;
  const unchanged=rows.length-advances-declines;
  const sma50Known=metricsRows.filter(x=>typeof x.aboveSma50==='boolean');
  const volKnown=metricsRows.map(x=>finite(x.volatility20AnnualizedPct)).filter(Number.isFinite);
  const metrics={
    sessionDate:context.sessionDate,universeCount:rows.length,analyzedCount:rows.length,participationPct:100,
    advances,declines,unchanged,advancePct:round(advances/Math.max(1,advances+declines)*100,1),
    advanceDeclineRatio:round(advances/Math.max(1,declines),2),
    aboveSma20Pct:round(metricsRows.filter(x=>x.aboveSma20===true).length/Math.max(1,rows.length)*100,1),
    aboveSma50Pct:round(sma50Known.filter(x=>x.aboveSma50===true).length/Math.max(1,sma50Known.length)*100,1),
    medianReturn1Pct:round(median(metricsRows.map(x=>finite(x.return1Pct))),2),
    medianReturn5Pct:round(median(metricsRows.map(x=>finite(x.return5Pct))),2),
    medianReturn20Pct:round(median(metricsRows.map(x=>finite(x.return20Pct))),2),
    volatility20AnnualizedPct:round(median(volKnown),2),
    highVolumeParticipationPct:round(metricsRows.filter(x=>finite(x.relativeVolume20)>=1.2).length/Math.max(1,metricsRows.filter(x=>Number.isFinite(finite(x.relativeVolume20))).length)*100,1)
  };
  for(const k of ['advancePct','aboveSma20Pct','aboveSma50Pct','medianReturn20Pct','medianReturn5Pct','volatility20AnnualizedPct'])if(!Number.isFinite(metrics[k]))throw Object.assign(new Error(`Regime metric missing: ${k}`),{code:'REGIME_EXECUTION_FAILED'});
  let score=50;
  if(metrics.advancePct>=60)score+=14;else if(metrics.advancePct<40)score-=16;
  if(metrics.aboveSma20Pct>=60)score+=16;else if(metrics.aboveSma20Pct<40)score-=18;
  if(metrics.aboveSma50Pct>=55)score+=14;else if(metrics.aboveSma50Pct<35)score-=16;
  if(metrics.medianReturn20Pct>=4)score+=12;else if(metrics.medianReturn20Pct<-4)score-=14;
  if(metrics.medianReturn5Pct>=1.5)score+=6;else if(metrics.medianReturn5Pct<-2)score-=8;
  if(metrics.volatility20AnnualizedPct>=55)score-=18;else if(metrics.volatility20AnnualizedPct<=30)score+=6;
  score=Math.max(0,Math.min(100,Math.round(score)));
  let regime='NEUTRAL';if(metrics.volatility20AnnualizedPct>=65)regime='HIGH_VOLATILITY';else if(score>=68)regime='RISK_ON';else if(score<=35)regime='RISK_OFF';
  const policy={RISK_ON:{riskMultiplier:1,maxOpenRiskPct:2,maxTradeRiskPct:.25},NEUTRAL:{riskMultiplier:.65,maxOpenRiskPct:1.3,maxTradeRiskPct:.16},RISK_OFF:{riskMultiplier:.35,maxOpenRiskPct:.7,maxTradeRiskPct:.09},HIGH_VOLATILITY:{riskMultiplier:.2,maxOpenRiskPct:.4,maxTradeRiskPct:.05}}[regime];
  const semantic={regime,score,metrics,version:VERSION.regime,source:CONFIG.regimeSource};
  return deepFreeze({regimeId:`REGIME-${stableHash(semantic).slice(0,20)}`,regime,score,version:VERSION.regime,metrics,evidenceReasons:regimeReasons(metrics,score,regime),eligibleStrategyFamilies:['V16_CHAMPION_LINEAGE'],...policy,semanticHash:stableHash(semantic)});
}
function regimeReasons(m,score,regime){return[{code:'BREADTH_ADVANCE_PCT',value:m.advancePct},{code:'ABOVE_SMA20_PCT',value:m.aboveSma20Pct},{code:'ABOVE_SMA50_PCT',value:m.aboveSma50Pct},{code:'MEDIAN_RETURN20_PCT',value:m.medianReturn20Pct},{code:'MEDIAN_RETURN5_PCT',value:m.medianReturn5Pct},{code:'VOLATILITY20_ANNUALIZED_PCT',value:m.volatility20AnnualizedPct},{code:'REGIME_SCORE',value:score},{code:'REGIME_CLASS',value:regime}]}

function decisionInputIdentity(context,regime){
  return stableHash({sessionDate:context.sessionDate,canonicalSnapshotId:context.canonicalSnapshot.snapshotId,rowSnapshotIds:context.canonicalSnapshot.rows.map(r=>r.snapshotId||`${r.ticker}:${r.sessionDate}`).sort(),historyIdentities:context.historyIdentities||{},modelGuardHistoryHash:stableHash(context.modelGuardHistory||[]),trainingHash:stableHash(context.modelTrainingSessions||[]),currentRowsHash:stableHash(context.modelCurrentRows||[]),approvedStrategyVersions:context.approvedStrategyVersions||{},approvedConfig:context.approvedConfig||{},regimeHash:regime.semanticHash});
}

function runProductionStrategy(context,regime,inputIdentity){
  const eligibility=productionEligibility(ACTIVE_STRATEGY,context,regime);
  if(!eligibility.productionEligible)return{ok:false,executions:[],diagnostics:[diagnostic('STRATEGY_NOT_PRODUCTION_ELIGIBLE','ERROR',{strategyId:ACTIVE_STRATEGY,eligibility})]};
  const embeddedSpec=SPECS[EMBEDDED_SELECTION_MODEL];
  if(!embeddedSpec?.canExecuteInternally)return{ok:false,executions:[],diagnostics:[diagnostic('BASKET_SELECTION_MODEL_INELIGIBLE','ERROR',{strategyId:EMBEDDED_SELECTION_MODEL})]};
  let embedded;
  try{
    embedded=executeStrategy(EMBEDDED_SELECTION_MODEL,{
      snapshot:{snapshotId:context.canonicalSnapshot.snapshotId,ticker:'__MARKET__',sessionDate:context.sessionDate,validationStatus:'VALID',migrationValidationStatus:'VALID'},
      history:context.modelGuardHistory||[],trainingSessions:context.modelTrainingSessions,currentRows:context.modelCurrentRows
    },context.approvedConfig||{});
  }catch(error){return{ok:false,executions:[],diagnostics:[diagnostic('STRATEGY_EXECUTION_FAILED','ERROR',{strategyId:EMBEDDED_SELECTION_MODEL,message:error.message})]}}
  if(embedded.eligibility!=='ELIGIBLE'){
    const validNoOpportunity=embedded.eligibilityReason==='NO_EXECUTION_ELIGIBLE_CANDIDATE';
    return{ok:validNoOpportunity,executions:[marketExecution([],embedded,eligibility,context,regime,inputIdentity)],diagnostics:[diagnostic('BASKET_SELECTION_MODEL_INELIGIBLE',validNoOpportunity?'INFO':'ERROR',{reason:embedded.eligibilityReason})]};
  }
  const size=context.approvedConfig.basketSize;
  const currentByTicker=new Map((context.modelCurrentRows||[]).map(r=>[String(r.ticker||''),r]));
  const ranked=(embedded.evidenceItems||[]).map(item=>{
    const row=currentByTicker.get(String(item.ticker||''));if(!row)return null;
    const close=finite(row.close),atr=finite(row.atr14);if(!(close>0&&atr>0))return null;
    return{ticker:String(item.ticker),sourceSelectionScore:finite(item.executionScore),close,atr14:atr,turnover20:finite(row.turnover20,0),entryLow:round(close+CONFIG.riskSource.entryAtrLow*atr,4),entryHigh:round(close+CONFIG.riskSource.entryAtrHigh*atr,4),stopLoss:round(close+CONFIG.riskSource.stopAtr*atr,4),target1:round(close+CONFIG.riskSource.targetAtr*atr,4),sourceCurrentRowHash:stableHash(row)};
  }).filter(Boolean).sort((a,b)=>(finite(b.sourceSelectionScore,-Infinity)-finite(a.sourceSelectionScore,-Infinity))||a.ticker.localeCompare(b.ticker));
  const candidates=ranked.slice(0,size);
  return{ok:true,executions:[marketExecution(candidates,embedded,eligibility,context,regime,inputIdentity)],diagnostics:[]};
}

function marketExecution(candidates,embedded,eligibility,context,regime,inputIdentity){
  const rawOutput={rawSignal:candidates.length?'BASKET':'NO_SIGNAL',normalizedSignal:candidates.length?'BUY':'NO_SIGNAL',candidates,embeddedSelectionExecution:embedded,eligibility};
  const semantic={strategyId:ACTIVE_STRATEGY,strategyVersion:SPECS[ACTIVE_STRATEGY].sourceCommit,inputIdentity,regimeId:regime.regimeId,approvedConfig:context.approvedConfig,rawOutput};
  const h=stableHash(semantic);
  return deepFreeze({strategyExecutionId:`G09-SE-${h.slice(0,24)}`,strategyId:ACTIVE_STRATEGY,strategyVersion:SPECS[ACTIVE_STRATEGY].sourceCommit,eligibility:'ELIGIBLE',eligibilityReason:'PRODUCTION_ELIGIBLE',rawOutput,normalizedOutput:{signal:rawOutput.normalizedSignal,candidateCount:candidates.length},diagnostics:[],executionHash:h,provenance:{sourceEngine:SPECS[ACTIVE_STRATEGY].sourceEngine,sourceCommit:SPECS[ACTIVE_STRATEGY].sourceCommit,sourcePaths:SPECS[ACTIVE_STRATEGY].sourcePaths,embeddedSelectionModel:{strategyId:EMBEDDED_SELECTION_MODEL,executionHash:embedded.executionHash,role:CONFIG.productionStrategyApproval.selectionComponent.role}}});
}

function runStrategyFarm(context,regime,inputIdentity){
  const requested=context.requestedStrategyIds||Object.keys(SPECS);
  const eligibility=requested.map(id=>({strategyId:id,...productionEligibility(id,context,regime)}));
  const production=eligibility.filter(x=>x.productionEligible).map(x=>x.strategyId);
  if(production.includes(QUANT_EDGE))throw Object.assign(new Error('QUANT_EDGE cannot enter live strategy farm'),{code:'QUANT_EDGE_LIVE_INFLUENCE_FORBIDDEN'});
  const active=runProductionStrategy(context,regime,inputIdentity);
  const researchExcluded=eligibility.filter(x=>!x.productionEligible);
  return{farmExecuted:true,productionStrategyIds:production,executions:active.executions,diagnostics:active.diagnostics,researchExcluded,allProductionFailed:!active.ok};
}

function normalizeCandidateSignals(execution){
  return(execution?.rawOutput?.candidates||[]).map(c=>({ticker:c.ticker,strategyExecutionId:execution.strategyExecutionId,strategyId:execution.strategyId,strategyVersion:execution.strategyVersion,rawSignal:'V16_9_BASKET_MEMBER',normalizedSignal:'BUY',rawScore:c.sourceSelectionScore,entry:{low:c.entryLow,high:c.entryHigh},stopLoss:c.stopLoss,targets:[c.target1],originalDiagnostics:execution.diagnostics,sourceCandidate:c}));
}

function buildEvidence(signal,row,regime,decisionInputSnapshotId){
  const base=`${signal.ticker}|${signal.strategyExecutionId}|${decisionInputSnapshotId}`;
  const items=[
    evidence(base,'MODEL_SELECTION','STRATEGY_SELECTION',signal.strategyExecutionId,{score:signal.rawScore},'STRATEGY',[]),
    evidence(base,'MODEL_SELECTION','BASKET_MEMBERSHIP',signal.strategyExecutionId,{member:true},'STRATEGY',['STRATEGY_SELECTION']),
    evidence(base,'LIQUIDITY','TURNOVER20',row.snapshotId||signal.ticker,{turnover20Egp:finite(signal.sourceCandidate.turnover20,0),passed:finite(signal.sourceCandidate.turnover20,0)>=1e6},'MARKET_DATA',[]),
    evidence(base,'REGIME','MARKET_REGIME',regime.regimeId,{regime:regime.regime,score:regime.score},'MARKET_DATA',[]),
    evidence(base,'STRUCTURE','ENTRY_STOP_TARGET',signal.strategyExecutionId,{entry:signal.entry,stopLoss:signal.stopLoss,targets:signal.targets},'STRATEGY',[])
  ];
  return dedupeEvidence(items);
}
function evidence(base,family,type,sourceRef,value,sourceKind,correlatedWith){const id=`EV-${stableHash({base,family,type,sourceRef,value}).slice(0,22)}`;return{evidenceId:id,evidenceFamily:family,evidenceType:type,sourceKind,sourceRef,value,correlatedWith,provenance:{pipelineVersion:VERSION.pipeline,evidenceVersion:VERSION.evidence}}}
function dedupeEvidence(items){const first=new Map();return items.map(item=>{const key=item.evidenceFamily;if(!first.has(key)){first.set(key,item.evidenceId);return{...item,independent:true,duplicateOf:null}}return{...item,independent:false,duplicateOf:first.get(key)}})}

function agreementFor(signal,evidenceItems,farm,regime){
  const independent=evidenceItems.filter(x=>x.independent).length;
  const families=[...new Set(evidenceItems.map(x=>x.evidenceFamily))].sort();
  const contradictionFlags=[];
  const liquidity=evidenceItems.find(x=>x.evidenceType==='TURNOVER20');if(liquidity&&!liquidity.value.passed)contradictionFlags.push('LIQUIDITY_CONTRADICTION');
  if(['RISK_OFF','HIGH_VOLATILITY'].includes(regime.regime))contradictionFlags.push('REGIME_RISK_REDUCTION');
  if(independent<2)contradictionFlags.push('LOW_EVIDENCE_DIVERSITY');
  return{agreementVersion:VERSION.agreement,strategiesEvaluated:farm.productionStrategyIds.length,eligibleStrategies:1,positive:1,neutral:0,negativeRejecting:0,unavailableInsufficientData:0,agreementCount:1,disagreement:0,rawEvidenceCount:evidenceItems.length,independentEvidenceCount:independent,evidenceFamilies:families,contradictionFlags};
}

function rankCandidates(candidateRecords){
  for(const c of candidateRecords)if(!Number.isFinite(finite(c.signal.rawScore)))throw Object.assign(new Error(`Ranking score invalid for ${c.ticker}`),{code:'RANKING_INPUT_INVALID'});
  return candidateRecords.slice().sort((a,b)=>(finite(b.signal.rawScore)-finite(a.signal.rawScore))||a.ticker.localeCompare(b.ticker)).map((c,i)=>({...c,rank:i+1,ranking:{version:VERSION.ranking,score:c.signal.rawScore,meaning:'Source-pinned V16.9 selection ordering score; not a probability of success.',components:[{name:'V16_9_SOURCE_SELECTION_SCORE',value:c.signal.rawScore,weight:null,provenance:CONFIG.rankingSource}],tieBreak:CONFIG.tieBreak}}));
}

function riskPlan(candidate,capitalEgp,regime,basketSize){
  const entry=assertFiniteUnit(candidate.signal.entry.high,'entry',{positive:true}),stop=assertFiniteUnit(candidate.signal.stopLoss,'stopLoss',{positive:true});
  if(!(stop<entry))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'STOP_NOT_BELOW_ENTRY'})};
  const perShareRisk=entry-stop;if(!(perShareRisk>0))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'PER_SHARE_RISK_INVALID'})};
  const riskPct=regime.maxTradeRiskPct;if(!(riskPct>0))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'REGIME_RISK_PERCENT_INVALID'})};
  const memberExposureCapPct=CONFIG.productionStrategyApproval.maxTotalExposurePct/basketSize;
  const riskBudget=capitalEgp*riskPct/100;
  const byRisk=Math.floor(riskBudget/perShareRisk),byExposure=Math.floor((capitalEgp*memberExposureCapPct/100)/entry),quantity=Math.max(0,Math.min(byRisk,byExposure));
  if(!Number.isFinite(quantity)||quantity<=0)return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'NON_POSITIVE_QUANTITY'})};
  const maxLoss=round(quantity*perShareRisk,2),exposureEgp=round(quantity*entry,2),exposurePct=round(exposureEgp/capitalEgp*100,4);
  if(!(maxLoss>=0&&exposureEgp>=0&&exposurePct>=0&&exposurePct<=memberExposureCapPct+1e-9))return{ok:false,diagnostic:diagnostic('RISK_PLAN_INVALID','ERROR',{ticker:candidate.ticker,reason:'EXPOSURE_OR_LOSS_INVALID'})};
  return{ok:true,plan:{riskVersion:VERSION.risk,capitalEgp,riskPct,entry,stopLoss:stop,targets:candidate.signal.targets,perShareRisk:round(perShareRisk,4),quantity,maxLossEgp:maxLoss,exposureEgp,exposurePct,memberExposureCapPct,regimeRiskMultiplier:regime.riskMultiplier,units:{capital:'EGP',entry:'EGP_PER_SHARE',stopLoss:'EGP_PER_SHARE',perShareRisk:'EGP_PER_SHARE',maxLossEgp:'EGP',exposureEgp:'EGP',riskPct:'PERCENT',exposurePct:'PERCENT'}}};
}

function basketPlan(ranked,capitalEgp,regime,basketSize){
  const members=[];const diagnostics=[];
  for(const candidate of ranked){const risk=riskPlan(candidate,capitalEgp,regime,basketSize);if(risk.ok)members.push({...candidate,risk:risk.plan});else diagnostics.push(risk.diagnostic)}
  const totalExposurePct=round(members.reduce((s,m)=>s+m.risk.exposurePct,0),4);
  if(totalExposurePct>CONFIG.productionStrategyApproval.maxTotalExposurePct+1e-9)return{ok:false,members:[],diagnostics:[...diagnostics,diagnostic('BASKET_CONSTRAINT_FAILED','ERROR',{reason:'TOTAL_EXPOSURE_EXCEEDED',totalExposurePct})]};
  return{ok:true,members,diagnostics,basket:{version:VERSION.basket,basketSizeRequested:basketSize,memberCount:members.length,totalExposurePct,cashReservePct:round(100-totalExposurePct,4),maxTotalExposurePct:CONFIG.productionStrategyApproval.maxTotalExposurePct,failedWeightPolicy:CONFIG.productionStrategyApproval.failedWeightPolicy,regime:regime.regime}};
}

function marketStates(context,selectedTickers,modelCandidates,diagnostics){
  const selected=new Set(selectedTickers),candidateSet=new Set(modelCandidates.map(x=>x.ticker)),current=new Map((context.modelCurrentRows||[]).map(r=>[String(r.ticker||''),r]));
  return context.canonicalSnapshot.rows.map(row=>{
    const t=String(row.ticker);let state='STRATEGY_REJECTED',reasons=[];
    if(selected.has(t)){state='ELIGIBLE_OPPORTUNITY';reasons=['RANKED_AND_RISK_VALID']}
    else if(candidateSet.has(t)){state='NOT_SELECTED';reasons=['LOWER_RANKING_OR_RISK_REJECTED']}
    else if(!current.has(t)){state='INSUFFICIENT_DATA';reasons=['NO_CURRENT_MODEL_ROW']}
    else if(finite(current.get(t).turnover20,0)<1e6){state='LIQUIDITY_REJECTED';reasons=['LOW_TURNOVER']}
    else{state='STRATEGY_REJECTED';reasons=['NOT_SELECTED_BY_ACTIVE_V16_9_SOURCE_MODEL']}
    return{ticker:t,securityId:row.securityId||t,state,reasons,canonicalSnapshotRef:row.snapshotId||context.canonicalSnapshot.snapshotId,diagnosticRefs:diagnostics.filter(d=>d.context?.ticker===t).map(d=>d.code)};
  }).sort((a,b)=>a.ticker.localeCompare(b.ticker));
}

function runUnifiedDecisionPipeline(context){
  const started=process.hrtime.bigint();
  const check=validateContext(context);
  if(!check.ok)return failedRun(context,check.code,check.details,started);
  let regime;try{regime=computeRegime(context)}catch(error){return failedRun(context,error.code||'REGIME_EXECUTION_FAILED',[error.message],started)}
  const inputIdentity=decisionInputIdentity(context,regime);
  let farm;try{farm=runStrategyFarm(context,regime,inputIdentity)}catch(error){return failedRun(context,error.code||'STRATEGY_EXECUTION_FAILED',[error.message],started)}
  if(farm.allProductionFailed)return failedRun(context,'ALL_PRODUCTION_STRATEGIES_FAILED',farm.diagnostics,started);
  const execution=farm.executions.find(x=>x.strategyId===ACTIVE_STRATEGY);
  if(!execution)return failedRun(context,'ALL_PRODUCTION_STRATEGIES_FAILED',['ACTIVE_STRATEGY_EXECUTION_MISSING'],started);
  const signals=normalizeCandidateSignals(execution);
  const rows=new Map(context.canonicalSnapshot.rows.map(r=>[String(r.ticker),r]));
  const candidates=signals.map(signal=>{const row=rows.get(signal.ticker);const evidenceItems=buildEvidence(signal,row,regime,inputIdentity);return{ticker:signal.ticker,securityId:row?.securityId||signal.ticker,signal,evidenceItems,agreement:agreementFor(signal,evidenceItems,farm,regime)}});
  let ranked;try{ranked=rankCandidates(candidates)}catch(error){return failedRun(context,error.code||'RANKING_INPUT_INVALID',[error.message],started)}
  const basket=basketPlan(ranked,context.capitalEgp,regime,context.approvedConfig.basketSize);
  if(!basket.ok)return failedRun(context,'BASKET_CONSTRAINT_FAILED',basket.diagnostics,started);
  const selected=basket.members;
  const opportunityRecords=selected.slice(0,5).map((c,i)=>({ticker:c.ticker,securityId:c.securityId,rank:i+1,decisionScore:c.ranking.score,ranking:c.ranking,agreement:c.agreement,evidence:c.evidenceItems,risk:c.risk,entryPlan:c.signal.entry,stopLoss:c.signal.stopLoss,targets:c.signal.targets,strategyExecutionRef:c.signal.strategyExecutionId,trace:{candidate:c.ticker,rankingVersion:c.ranking.version,evidenceRefs:c.evidenceItems.map(e=>e.evidenceId),strategyExecutionRefs:[c.signal.strategyExecutionId],inputSnapshotRefs:[rows.get(c.ticker)?.snapshotId||context.canonicalSnapshot.snapshotId],decisionInputSnapshotId:inputIdentity}}));
  const allDiagnostics=[...farm.diagnostics,...basket.diagnostics];
  const zero=opportunityRecords.length===0;
  if(zero)allDiagnostics.push(diagnostic('VALID_ZERO_OPPORTUNITY_SESSION','INFO',{universeCount:check.universeCount,farmExecuted:farm.farmExecuted,regime:regime.regime}));
  const states=marketStates(context,opportunityRecords.map(x=>x.ticker),execution.rawOutput.candidates||[],allDiagnostics);
  const semantic={pipelineVersion:VERSION.pipeline,sessionDate:context.sessionDate,asOfSessionDate:context.sessionDate,decisionInputSnapshotId:inputIdentity,canonicalSnapshotIdentity:context.canonicalSnapshot.snapshotId,regime:{regimeId:regime.regimeId,version:regime.version,semanticHash:regime.semanticHash},strategyExecutions:farm.executions.map(e=>({id:e.strategyExecutionId,strategyId:e.strategyId,version:e.strategyVersion,hash:e.executionHash})),strategyVersions:Object.fromEntries(farm.executions.map(e=>[e.strategyId,e.strategyVersion])),evidenceVersion:VERSION.evidence,agreementVersion:VERSION.agreement,rankingVersion:VERSION.ranking,riskVersion:VERSION.risk,basketVersion:VERSION.basket,applicationVersion:context.applicationVersion||'ASTRA_SHADOW',codeVersion:context.codeVersion||VERSION.pipeline,opportunities:opportunityRecords,marketStates:states,basket:basket.basket,diagnostics:allDiagnostics};
  const semanticDecisionHash=stableHash(semantic),decisionSnapshotId=`G09-DS-${semanticDecisionHash.slice(0,24)}`;
  const generatedAt=context.generatedAt||new Date().toISOString();
  const snapshot=deepFreeze({...semantic,decisionSnapshotId,semanticDecisionHash,canonicalMarketSnapshotRef:context.canonicalSnapshot.snapshotId,marketRegimeRef:regime.regimeId,strategyExecutionRefs:farm.executions.map(e=>e.strategyExecutionId),agreementRef:`AGR-${semanticDecisionHash.slice(0,18)}`,evidenceRefs:opportunityRecords.flatMap(o=>o.evidence.map(e=>e.evidenceId)),generatedAt,schemaVersion:VERSION.snapshot,status:zero?'VALID_ZERO_OPPORTUNITY_SESSION':'DECISION_SNAPSHOT_READY',regime,productionEligibility:{internallyExecutable:Object.values(SPECS).filter(x=>x.canExecuteInternally).length,productionEligible:farm.productionStrategyIds.length,researchExcluded:farm.researchExcluded.length},top5:opportunityRecords,marketUniverseEvaluated:states.length,legacyNetworkCalls:0,quantEdgeLiveInfluence:0,shadowMode:true,productionCutover:false,durationMs:round(Number(process.hrtime.bigint()-started)/1e6,3)});
  return{ok:true,status:snapshot.status,decisionSnapshot:snapshot};
}

function failedRun(context,code,details,started){return{ok:false,status:'PIPELINE_FAILED',decisionSnapshot:null,diagnostics:[diagnostic(code,'ERROR',{details:Array.isArray(details)?details:[details]})],sessionDate:context?.sessionDate||null,legacyNetworkCalls:0,quantEdgeLiveInfluence:0,productionCutover:false,durationMs:round(Number(process.hrtime.bigint()-started)/1e6,3)}}

module.exports={VERSION,CONFIG,DIAGNOSTIC_CODES,stableHash,productionEligibility,validateContext,computeRegime,decisionInputIdentity,runStrategyFarm,normalizeCandidateSignals,dedupeEvidence,agreementFor,rankCandidates,riskPlan,basketPlan,runUnifiedDecisionPipeline};
