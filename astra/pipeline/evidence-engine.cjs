'use strict';
const {VERSION,stableHash,finite}=require('./g09-shared.cjs');
const {buildTechnicalEvidence}=require('../analysis/technical-analysis.cjs');
const {buildSupportResistanceEvidence}=require('../analysis/support-resistance.cjs');
const {buildRelativeStrengthEvidence}=require('../analysis/relative-strength.cjs');
const {buildVcpEvidence}=require('../analysis/vcp.cjs');
const {buildLiquidityEvidence}=require('../analysis/liquidity.cjs');

function buildEvidence(signal,row,regime,decisionInputSnapshotId){
  const technical=row?buildTechnicalEvidence(row,[],row.sessionDate):{sourceRef:signal.ticker};
  let liquidity=null;
  if(row){
    const sr=buildSupportResistanceEvidence(row,[],row.sessionDate);
    const rs=buildRelativeStrengthEvidence(row,[],row.sessionDate,[row]);
    const vcp=buildVcpEvidence(row,[],row.sessionDate,[row]);
    liquidity=buildLiquidityEvidence(row,[],row.sessionDate,signal.sourceCandidate||{});
    if([sr,rs,vcp,liquidity].some(x=>x.sourceRef!==technical.sourceRef))throw Object.assign(new Error('Analysis evidence source identity mismatch'),{code:'DECISION_INPUT_INVALID'});
  }
  const base=`${signal.ticker}|${signal.strategyExecutionId}|${decisionInputSnapshotId}`;
  const items=[
    evidence(base,'MODEL_SELECTION','STRATEGY_SELECTION',signal.strategyExecutionId,{score:signal.rawScore},'STRATEGY',[]),
    evidence(base,'MODEL_SELECTION','BASKET_MEMBERSHIP',signal.strategyExecutionId,{member:true},'STRATEGY',['STRATEGY_SELECTION']),
    evidence(base,'LIQUIDITY','TURNOVER20',technical.sourceRef,{turnover20Egp:liquidity?liquidity.turnover20Egp:finite(signal.sourceCandidate.turnover20,0),passed:liquidity?liquidity.readiness.passed:finite(signal.sourceCandidate.turnover20,0)>=1e6},'MARKET_DATA',[]),
    evidence(base,'REGIME','MARKET_REGIME',regime.regimeId,{regime:regime.regime,score:regime.score},'MARKET_DATA',[]),
    evidence(base,'STRUCTURE','ENTRY_STOP_TARGET',signal.strategyExecutionId,{entry:signal.entry,stopLoss:signal.stopLoss,targets:signal.targets},'STRATEGY',[])
  ];
  return dedupeEvidence(items);
}

function evidence(base,family,type,sourceRef,value,sourceKind,correlatedWith){const id=`EV-${stableHash({base,family,type,sourceRef,value}).slice(0,22)}`;return{evidenceId:id,evidenceFamily:family,evidenceType:type,sourceKind,sourceRef,value,correlatedWith,provenance:{pipelineVersion:VERSION.pipeline,evidenceVersion:VERSION.evidence}}}

function dedupeEvidence(items){const first=new Map();return items.map(item=>{const key=item.evidenceFamily;if(!first.has(key)){first.set(key,item.evidenceId);return{...item,independent:true,duplicateOf:null}}return{...item,independent:false,duplicateOf:first.get(key)}})}

module.exports={buildEvidence,evidence,dedupeEvidence};
