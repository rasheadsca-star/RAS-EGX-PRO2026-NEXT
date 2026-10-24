'use strict';
// Stale quote exposure is a portfolio risk, never an invented execution price.
function inspectMarks(positions,sessionIndex,{hypotheticalStaleHaircutPct=5,maxHaircutPct=30}={}){
 if(!(hypotheticalStaleHaircutPct>=0&&hypotheticalStaleHaircutPct<=100))throw Error('Invalid stress haircut');
 if(!(maxHaircutPct>=0&&maxHaircutPct<=100))throw Error('Invalid max stress haircut');
 const stale=positions.filter(p=>!Number.isInteger(p.lastMarkIndex)||p.lastMarkIndex<sessionIndex);
 const notional=stale.reduce((v,p)=>v+p.qty*p.lastClose,0);
 let loss=0,maxAge=0;
 const staleDetails=[];
 for(const p of stale){
  const age=Number.isInteger(p.lastMarkIndex)?Math.max(0,sessionIndex-p.lastMarkIndex):sessionIndex+1;
  maxAge=Math.max(maxAge,age);
  const haircutPct=Math.min(maxHaircutPct,hypotheticalStaleHaircutPct*age);
  const stressedLoss=p.qty*p.lastClose*haircutPct/100;
  loss+=stressedLoss;
  staleDetails.push({ticker:p.ticker,ageSessions:age,notionalEgp:+(p.qty*p.lastClose).toFixed(2),hypotheticalHaircutPct:haircutPct,hypotheticalLossEgp:+stressedLoss.toFixed(2)});
 }
 return {stalePositionCount:stale.length,stalePositionNotionalEgp:notional,maxStaleAgeSessions:maxAge,
  stressUnrealizedLossEgp:loss,
  stressAssumption:'5_PERCENT_OF_LAST_MARK_PER_MISSED_MARKET_SESSION_CAPPED_AT_30_PERCENT_NOT_ACTUAL_CLOSE',
  staleTickers:stale.map(p=>p.ticker).sort(),staleDetails};
}
function eligibilityFromMarks({stalePositionSessions=0,staleDays=0,endStalePositions=0,maxStaleAgeSessions=0}={}){
 const reasons=[];
 if(stalePositionSessions>0)reasons.push('STALE_POSITION_MARK_IN_EQUITY_CURVE');
 if(endStalePositions>0)reasons.push('STALE_UNREALIZED_POSITION_AT_END');
 return {completeSessionMarks:reasons.length===0,capitalPerformanceCertified:false,reasons,
  status:reasons.length?'INCOMPLETE_MARK_TO_MARKET':'CLEAN_MARKS_ONLY_DATA_SOURCE_STILL_UNCERTIFIED',
  stalePositionSessions,staleDays,endStalePositions,maxStaleAgeSessions};
}
module.exports={inspectMarks,eligibilityFromMarks};
