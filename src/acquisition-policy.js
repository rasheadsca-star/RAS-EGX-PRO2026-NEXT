export const SOURCE_CLASSES=Object.freeze({
  OFFICIAL_EXCHANGE:'OFFICIAL_EXCHANGE',
  LICENSED_EOD:'LICENSED_EOD',
  PUBLIC_MARKET:'PUBLIC_MARKET',
  HISTORY_ONLY:'HISTORY_ONLY',
  REFERENCE_ONLY:'REFERENCE_ONLY'
});

export const DEFAULT_SOURCE_POLICY=Object.freeze({
  OFFICIAL_EGX:{sourceClass:'OFFICIAL_EXCHANGE',priority:100,mayBePrimaryCurrent:true,mayCrossCheck:true},
  LICENSED_EOD:{sourceClass:'LICENSED_EOD',priority:95,mayBePrimaryCurrent:true,mayCrossCheck:true},
  MUBASHER:{sourceClass:'PUBLIC_MARKET',priority:70,mayBePrimaryCurrent:false,mayCrossCheck:true},
  YAHOO:{sourceClass:'HISTORY_ONLY',priority:40,mayBePrimaryCurrent:false,mayCrossCheck:false},
  TRADINGVIEW:{sourceClass:'REFERENCE_ONLY',priority:20,mayBePrimaryCurrent:false,mayCrossCheck:true}
});

export function validateDailyObservationTiming(observation,calendarEntry){
  const reasons=[];
  if(!observation?.capturedAt) reasons.push('MISSING_CAPTURE_TIME');
  if(!calendarEntry?.session||!calendarEntry?.closeAt) reasons.push('MISSING_SESSION_CALENDAR');
  if(reasons.length) return {state:'BLOCKED',reasons};
  if(observation.session!==calendarEntry.session) reasons.push(`SESSION_MISMATCH:${observation.session}:${calendarEntry.session}`);
  const capture=Date.parse(observation.capturedAt), close=Date.parse(calendarEntry.closeAt);
  if(!Number.isFinite(capture)||!Number.isFinite(close)) reasons.push('INVALID_TIMESTAMP');
  else if(capture<close) reasons.push('PRE_CLOSE_DAILY_BAR');
  return {state:reasons.length?'BLOCKED':'READY',reasons};
}

export function buildAcquisitionPlan(ticker,session,{availableSources=[],sourcePolicy=DEFAULT_SOURCE_POLICY,requireIndependentCrossCheck=true}={}){
  const available=availableSources.map(id=>({id,policy:sourcePolicy[id]})).filter(x=>x.policy).sort((a,b)=>b.policy.priority-a.policy.priority||a.id.localeCompare(b.id));
  const primaries=available.filter(x=>x.policy.mayBePrimaryCurrent);
  if(!primaries.length) return {state:'SOURCE_UNAVAILABLE',ticker,session,reasons:['NO_AUTHORITATIVE_CURRENT_SOURCE'],primary:null,crossChecks:[]};
  const primary=primaries[0];
  const crossChecks=available.filter(x=>x.id!==primary.id&&x.policy.mayCrossCheck);
  if(requireIndependentCrossCheck&&!crossChecks.length) return {state:'SOURCE_UNAVAILABLE',ticker,session,reasons:['NO_INDEPENDENT_CROSS_CHECK'],primary:primary.id,crossChecks:[]};
  return {state:'READY',ticker,session,reasons:[],primary:primary.id,crossChecks:crossChecks.map(x=>x.id),sourceClasses:{primary:primary.policy.sourceClass,crossChecks:crossChecks.map(x=>x.policy.sourceClass)}};
}
