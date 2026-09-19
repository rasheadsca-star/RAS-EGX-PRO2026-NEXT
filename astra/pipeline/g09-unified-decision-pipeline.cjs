'use strict';

const {listStrategyIds,getStrategyDescriptor}=require('../strategies/strategy-registry.cjs');
const {executeStrategy}=require('../strategies/strategy-runner.cjs');
const SPECS=Object.freeze(Object.fromEntries(listStrategyIds().map(id=>[id,getStrategyDescriptor(id)])));

const {
  VERSION,ACTIVE_STRATEGY,EMBEDDED_SELECTION_MODEL,QUANT_EDGE,DATE_RE,DIAGNOSTIC_CODES,CONFIG,
  stableHash,finite,round,deepFreeze,diagnostic,asDate,after,migrationBad
}=require('./g09-shared.cjs');
const {computeRegime}=require('./market-regime.cjs');
const {normalizeCandidateSignals}=require('./signal-normalizer.cjs');
const {buildEvidence,dedupeEvidence}=require('./evidence-engine.cjs');
const {agreementFor}=require('./agreement-engine.cjs');
const {rankCandidates}=require('./ranking-engine.cjs');
const {riskPlan}=require('./position-sizing.cjs');
const {basketPlan}=require('./basket-engine.cjs');
const {marketStates,failedRun}=require('./diagnostics.cjs');

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

module.exports={VERSION,CONFIG,DIAGNOSTIC_CODES,stableHash,productionEligibility,validateContext,computeRegime,decisionInputIdentity,runStrategyFarm,normalizeCandidateSignals,dedupeEvidence,agreementFor,rankCandidates,riskPlan,basketPlan,runUnifiedDecisionPipeline};
