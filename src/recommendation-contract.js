import { DECISION } from './contracts.js';

export const RECOMMENDATION_REQUIRED_FIELDS = Object.freeze([
  'recommendationId','ticker','companyName','signalSession','createdAt','snapshotId','snapshotHash',
  'engineVersion','featureVersion','modelVersion','configVersion','configHash','commitHash','decision',
  'finalRankScore','confidence','entryLow','entryHigh','entryCondition','entryExpiry','stop','target1','target2',
  'expectedHoldingWindow','maximumHoldingSessions','grossRiskReward','netRiskReward','transactionCostAssumption',
  'slippageAssumption','liquidityStatus','dataQuality','marketRegime','whySelected','whyNotBuyNow','riskFactors',
  'invalidationConditions','evidenceType','status'
]);

export function validateRecommendationContract(record) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_RECOMMENDATION_RECORD');
  for (const key of RECOMMENDATION_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record,key)) throw new Error(`RECOMMENDATION_MISSING:${key}`);
  }
  if (!Object.values(DECISION).includes(record.decision)) throw new Error(`INVALID_DECISION:${record.decision}`);
  if (!record.recommendationId || !record.ticker || !record.signalSession || !record.createdAt || !record.snapshotHash)
    throw new Error('RECOMMENDATION_IDENTITY_INCOMPLETE');
  if (!Number.isFinite(record.finalRankScore)) throw new Error('INVALID_FINAL_RANK_SCORE');
  if (record.maximumHoldingSessions !== null && (!Number.isInteger(record.maximumHoldingSessions) || record.maximumHoldingSessions < 0))
    throw new Error('INVALID_MAXIMUM_HOLDING_SESSIONS');
  if (!Array.isArray(record.riskFactors) || !Array.isArray(record.invalidationConditions))
    throw new Error('INVALID_RECOMMENDATION_REASON_ARRAYS');
  return true;
}
