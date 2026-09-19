'use strict';

const {
  stableHash,
  assertValidEntity,
  assertRecommendationImmutable
}=require('../contracts/canonical-contracts.cjs');

const VERSION='ASTRA_FORWARD_LEDGER_1.0';

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);
  for(const child of Object.values(value))deepFreeze(child);
  return value;
}
function recommendationFromDecisionSnapshot(snapshot,opportunity,issuedAt=snapshot?.generatedAt){
  if(!snapshot?.decisionSnapshotId)throw new Error('decisionSnapshotId required');
  if(!opportunity?.ticker||!opportunity?.securityId)throw new Error('opportunity identity required');
  const strategyExecutionRefs=Array.isArray(opportunity?.trace?.strategyExecutionRefs)
    ? opportunity.trace.strategyExecutionRefs.slice()
    : opportunity.strategyExecutionRef?[opportunity.strategyExecutionRef]:[];
  const evidenceRefs=Array.isArray(opportunity?.evidence)
    ? opportunity.evidence.map(x=>x?.evidenceId).filter(Boolean)
    : Array.isArray(opportunity?.trace?.evidenceRefs)?opportunity.trace.evidenceRefs.slice():[];
  const regimeRef=snapshot.marketRegimeRef||snapshot?.regime?.regimeId;
  const identity={
    decisionSnapshotId:snapshot.decisionSnapshotId,
    securityId:opportunity.securityId,
    ticker:String(opportunity.ticker),
    sessionDate:snapshot.sessionDate,
    rank:Number(opportunity.rank),
    strategyExecutionRefs,
    evidenceRefs,
    regimeRef,
    entryPlan:opportunity.entryPlan||{},
    stopLoss:opportunity.stopLoss??null,
    targets:Array.isArray(opportunity.targets)?opportunity.targets.slice():[]
  };
  const record={
    recommendationId:`REC-${stableHash(identity).slice(0,24)}`,
    ...identity,
    issuedAt,
    schemaVersion:VERSION
  };
  assertValidEntity('RecommendationRecord',record);
  return deepFreeze(record);
}
function assertIssuedRecommendation(record){
  assertValidEntity('RecommendationRecord',record);
  return true;
}
function emptyLedger(){
  return deepFreeze({version:VERSION,recommendations:[],confirmations:[],outcomes:[]});
}
function appendRecommendation(ledger,record){
  assertIssuedRecommendation(record);
  const current=ledger||emptyLedger();
  const existing=current.recommendations.find(x=>x.recommendationId===record.recommendationId);
  if(existing){
    assertRecommendationImmutable(existing,record);
    return current;
  }
  return deepFreeze({...current,recommendations:[...current.recommendations,record]});
}
function appendConfirmation(ledger,record){
  assertValidEntity('MorningConfirmationRecord',record);
  const current=ledger||emptyLedger();
  if(!current.recommendations.some(x=>x.recommendationId===record.recommendationId))throw new Error('CONFIRMATION_RECOMMENDATION_NOT_ISSUED');
  const existing=current.confirmations.find(x=>x.confirmationId===record.confirmationId);
  if(existing){
    if(stableHash(existing)!==stableHash(record))throw new Error('CONFIRMATION_APPEND_ONLY_VIOLATION');
    return current;
  }
  return deepFreeze({...current,confirmations:[...current.confirmations,record]});
}
function buildForwardOutcome({recommendationId,evaluationSessionDate,evaluatedAt,status='OPEN',outcome={},metrics={},version=VERSION}){
  const semantic={recommendationId,evaluationSessionDate,status,outcome,metrics,version};
  const record={
    forwardOutcomeId:`FWD-${stableHash(semantic).slice(0,24)}`,
    recommendationId,
    evaluationSessionDate,
    evaluatedAt,
    status,
    outcome,
    metrics,
    version
  };
  assertValidEntity('ForwardOutcome',record);
  return deepFreeze(record);
}
function appendOutcome(ledger,record){
  assertValidEntity('ForwardOutcome',record);
  const current=ledger||emptyLedger();
  if(!current.recommendations.some(x=>x.recommendationId===record.recommendationId))throw new Error('OUTCOME_RECOMMENDATION_NOT_ISSUED');
  const existing=current.outcomes.find(x=>x.forwardOutcomeId===record.forwardOutcomeId);
  if(existing){
    if(stableHash(existing)!==stableHash(record))throw new Error('FORWARD_OUTCOME_APPEND_ONLY_VIOLATION');
    return current;
  }
  return deepFreeze({...current,outcomes:[...current.outcomes,record]});
}

module.exports=Object.freeze({
  VERSION,
  recommendationFromDecisionSnapshot,
  assertIssuedRecommendation,
  emptyLedger,
  appendRecommendation,
  appendConfirmation,
  buildForwardOutcome,
  appendOutcome
});
