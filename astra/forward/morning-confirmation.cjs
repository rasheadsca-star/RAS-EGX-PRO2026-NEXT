'use strict';

const {stableHash,assertValidEntity}=require('../contracts/canonical-contracts.cjs');
const {validateCanonicalSnapshot}=require('../core/canonical-data.cjs');
const forwardLedger=require('./forward-ledger.cjs');

const VERSION='ASTRA_MORNING_CONFIRMATION_1.0';
const GAP_TOLERANCE=0.005;

function finite(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function entryBounds(recommendation){
  const plan=recommendation?.entryPlan||{};
  const low=finite(plan.low??plan.entryLow??recommendation?.entryLow);
  const high=finite(plan.high??plan.entryHigh??recommendation?.entryHigh);
  return{low,high};
}
function buildMorningConfirmation({recommendation,sessionDate,evaluatedAt,openingRow=null}){
  forwardLedger.assertIssuedRecommendation(recommendation);
  const session=String(sessionDate||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(session)||session<=recommendation.sessionDate)throw new Error('MORNING_CONFIRMATION_REQUIRES_LATER_SESSION');
  const {low:entryLow,high:entryHigh}=entryBounds(recommendation);
  const stopLoss=finite(recommendation.stopLoss);
  if(!(entryLow>0&&entryHigh>=entryLow&&stopLoss>0))throw new Error('MORNING_CONFIRMATION_PLAN_INVALID');

  let status='PENDING';
  let reasonCode='OPENING_OBSERVATION_PENDING';
  let open=null;
  let sourceRef=null;

  if(openingRow){
    const snapshot={snapshotId:openingRow.snapshotId||`MORNING-${recommendation.ticker}-${session}`,sessionDate:session,rows:[openingRow]};
    const check=validateCanonicalSnapshot(snapshot,session);
    if(check.errors.length||check.temporal.length||check.quarantined.length){
      throw Object.assign(new Error('MORNING_CONFIRMATION_CANONICAL_INPUT_INVALID'),{details:check});
    }
    open=finite(openingRow?.ohlc?.open??openingRow?.open);
    if(!(open>0))throw new Error('MORNING_CONFIRMATION_OPEN_INVALID');
    sourceRef=openingRow.snapshotId||snapshot.snapshotId;
    if(open>entryHigh*(1+GAP_TOLERANCE)){status='CANCELLED';reasonCode='CANCELLED_GAP_UP'}
    else if(open<stopLoss){status='CANCELLED';reasonCode='CANCELLED_GAP_DOWN'}
    else{status='CONFIRMED';reasonCode='OPENING_GAP_RULES_PASSED'}
  }

  const observations=Object.freeze({
    ticker:recommendation.ticker,
    openingPrice:open,
    entryLow,
    entryHigh,
    stopLoss,
    gapTolerance:GAP_TOLERANCE,
    reasonCode,
    sourceRef,
    immutableRecommendation:true
  });
  const record={
    confirmationId:`MC-${stableHash({recommendationId:recommendation.recommendationId,sessionDate:session,observations,version:VERSION}).slice(0,24)}`,
    recommendationId:recommendation.recommendationId,
    sessionDate:session,
    evaluatedAt,
    status,
    observations,
    version:VERSION
  };
  assertValidEntity('MorningConfirmationRecord',record);
  return Object.freeze(record);
}
function appendMorningConfirmation(ledger,args){
  const record=buildMorningConfirmation(args);
  return forwardLedger.appendConfirmation(ledger,record);
}

module.exports=Object.freeze({VERSION,GAP_TOLERANCE,entryBounds,buildMorningConfirmation,appendMorningConfirmation});
