import { DECISION, EVIDENCE } from './contracts.js';

export const RECOMMENDATION_REQUIRED_FIELDS = Object.freeze([
  'recommendationId','ticker','companyName','signalSession','createdAt','snapshotId','snapshotHash',
  'engineVersion','featureVersion','modelVersion','configVersion','configHash','commitHash','decision',
  'finalRankScore','confidence','entryLow','entryHigh','entryCondition','entryExpiry','stop','target1','target2',
  'expectedHoldingWindow','maximumHoldingSessions','grossRiskReward','netRiskReward','transactionCostAssumption',
  'slippageAssumption','liquidityStatus','dataQuality','marketRegime','whySelected','whyNotBuyNow','riskFactors',
  'invalidationConditions','evidenceType','status'
]);

const EXECUTABLE_DECISIONS=new Set([DECISION.BUY_CANDIDATE,DECISION.WAIT_FOR_ENTRY]);

export function validateRecommendationContract(record) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_RECOMMENDATION_RECORD');
  for (const key of RECOMMENDATION_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record,key)) throw new Error(`RECOMMENDATION_MISSING:${key}`);
  }
  if (!Object.values(DECISION).includes(record.decision)) throw new Error(`INVALID_DECISION:${record.decision}`);
  if (!Object.values(EVIDENCE).includes(record.evidenceType)) throw new Error(`INVALID_RECOMMENDATION_EVIDENCE_TYPE:${record.evidenceType}`);
  if (!record.recommendationId || !record.ticker || !record.signalSession || !record.createdAt || !record.snapshotHash || !record.snapshotId)
    throw new Error('RECOMMENDATION_IDENTITY_INCOMPLETE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.signalSession)) throw new Error('INVALID_SIGNAL_SESSION');
  if (!Number.isFinite(Date.parse(record.createdAt))) throw new Error('INVALID_RECOMMENDATION_CREATED_AT');
  if (!Number.isFinite(record.finalRankScore)) throw new Error('INVALID_FINAL_RANK_SCORE');
  if (record.maximumHoldingSessions !== null && (!Number.isInteger(record.maximumHoldingSessions) || record.maximumHoldingSessions < 0))
    throw new Error('INVALID_MAXIMUM_HOLDING_SESSIONS');
  if (!Array.isArray(record.riskFactors) || !Array.isArray(record.invalidationConditions))
    throw new Error('INVALID_RECOMMENDATION_REASON_ARRAYS');
  for(const key of ['transactionCostAssumption','slippageAssumption']){
    if(!Number.isFinite(record[key])||record[key]<0) throw new Error(`INVALID_${key.toUpperCase()}`);
  }
  if(record.entryExpiry!==null&&!Number.isFinite(Date.parse(record.entryExpiry))) throw new Error('INVALID_ENTRY_EXPIRY');

  const geometryKeys=['entryLow','entryHigh','stop','target1'];
  const anyGeometry=geometryKeys.some(k=>record[k]!==null&&record[k]!==undefined)||record.target2!==null&&record.target2!==undefined;
  if(EXECUTABLE_DECISIONS.has(record.decision)&&!geometryKeys.every(k=>Number.isFinite(record[k]))) throw new Error('EXECUTABLE_DECISION_MISSING_GEOMETRY');
  if(EXECUTABLE_DECISIONS.has(record.decision)&&!record.entryExpiry) throw new Error('EXECUTABLE_DECISION_MISSING_ENTRY_EXPIRY');
  if(anyGeometry) validateLongGeometry(record);

  if(EXECUTABLE_DECISIONS.has(record.decision)){
    if(!Number.isFinite(record.grossRiskReward)||record.grossRiskReward<=0) throw new Error('INVALID_GROSS_RISK_REWARD');
    if(!Number.isFinite(record.netRiskReward)||record.netRiskReward<=0) throw new Error('INVALID_NET_RISK_REWARD');
    if(record.netRiskReward>record.grossRiskReward) throw new Error('NET_RISK_REWARD_EXCEEDS_GROSS');
  }
  return true;
}

function validateLongGeometry(record){
  for(const key of ['entryLow','entryHigh','stop','target1']) if(!Number.isFinite(record[key])||record[key]<=0) throw new Error(`INVALID_TRADE_GEOMETRY:${key}`);
  if(record.entryLow>record.entryHigh) throw new Error('INVALID_TRADE_GEOMETRY:entry_range');
  if(!(record.stop<record.entryLow)) throw new Error('INVALID_TRADE_GEOMETRY:stop_not_below_entry');
  if(!(record.target1>record.entryHigh)) throw new Error('INVALID_TRADE_GEOMETRY:target1_not_above_entry');
  if(record.target2!==null&&record.target2!==undefined){
    if(!Number.isFinite(record.target2)||record.target2<=record.target1) throw new Error('INVALID_TRADE_GEOMETRY:target2');
  }
}
