'use strict';
// Explicit market-to-market provenance. This does not manufacture a missing close.
function inspectMarks(positions,sessionIndex,{hypotheticalStaleHaircutPct=5}={}){
 if(!(hypotheticalStaleHaircutPct>=0&&hypotheticalStaleHaircutPct<=100))throw Error('Invalid stress haircut');
 const stale=positions.filter(p=>!Number.isInteger(p.lastMarkIndex)||p.lastMarkIndex<sessionIndex);
 const exposed=stale.reduce((v,p)=>v+p.qty*p.lastClose,0);
 const maxAge=stale.length?Math.max(...stale.map(p=>Number.isInteger(p.lastMarkIndex)?sessionIndex-p.lastMarkIndex:sessionIndex+1)):0;
 return {stalePositionCount:stale.length,stalePositionNotionalEgp:exposed,maxStaleAgeSessions:maxAge,stressUnrealizedLossEgp:exposed*hypotheticalStaleHaircutPct/100,
  staleTickers:stale.map(p=>p.ticker).sort()};
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
