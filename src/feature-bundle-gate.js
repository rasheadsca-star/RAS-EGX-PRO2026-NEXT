import { sha256 } from './hash.js';

const BLOCKING_PRIORITY=['DATA_CONFLICT','CORPORATE_ACTION_REVIEW','SOURCE_UNAVAILABLE','STALE','BLOCKED'];

export function validateFeatureBundle(bundle,{signalSession,decisionCutoff,requiredGroups=['TECHNICAL','LIQUIDITY','CORPORATE_ACTIONS'],currentSessionGroups=['TECHNICAL','LIQUIDITY'],maxAgeDays={}}={}){
  if(!signalSession||!decisionCutoff) throw new Error('FEATURE_GATE_CONTEXT_REQUIRED');
  const cutoff=Date.parse(decisionCutoff); if(!Number.isFinite(cutoff)) throw new Error('INVALID_DECISION_CUTOFF');
  const reasons=[]; const normalized=[]; let state='READY';
  const byName=new Map((bundle?.groups??[]).map(g=>[String(g.name??'').toUpperCase(),g]));
  for(const nameRaw of requiredGroups){
    const name=String(nameRaw).toUpperCase(); const g=byName.get(name);
    if(!g){reasons.push(`${name}:MISSING`);state=pickState(state,'SOURCE_UNAVAILABLE');continue}
    const groupState=String(g.state??'BLOCKED').toUpperCase();
    if(groupState!=='READY'){reasons.push(`${name}:STATE:${groupState}`);state=pickState(state,BLOCKING_PRIORITY.includes(groupState)?groupState:'BLOCKED')}
    if(!g.sourceVersion){reasons.push(`${name}:MISSING_SOURCE_VERSION`);state=pickState(state,'BLOCKED')}
    if(!g.featureVersion){reasons.push(`${name}:MISSING_FEATURE_VERSION`);state=pickState(state,'BLOCKED')}
    const available=Date.parse(g.availableAt);if(!Number.isFinite(available)){reasons.push(`${name}:INVALID_AVAILABLE_AT`);state=pickState(state,'BLOCKED')}
    else if(available>cutoff){reasons.push(`${name}:LOOKAHEAD_AVAILABLE_AT:${g.availableAt}`);state=pickState(state,'BLOCKED')}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(g.asOfSession??''))){reasons.push(`${name}:INVALID_AS_OF_SESSION`);state=pickState(state,'BLOCKED')}
    else {
      if(g.asOfSession>signalSession){reasons.push(`${name}:LOOKAHEAD_SESSION:${g.asOfSession}`);state=pickState(state,'BLOCKED')}
      if(currentSessionGroups.map(x=>String(x).toUpperCase()).includes(name)&&g.asOfSession!==signalSession){reasons.push(`${name}:STALE_DEPENDENT_FEATURE:${g.asOfSession}`);state=pickState(state,'STALE')}
    }
    const max=maxAgeDays[name];
    if(Number.isFinite(max)&&max>=0&&Number.isFinite(available)){
      const signalEnd=Date.parse(`${signalSession}T23:59:59Z`);const age=(signalEnd-available)/86400000;
      if(age>max){reasons.push(`${name}:FEATURE_TOO_OLD_DAYS:${age.toFixed(1)}>${max}`);state=pickState(state,'STALE')}
    }
    normalized.push({name,state:groupState,asOfSession:g.asOfSession??null,availableAt:g.availableAt??null,sourceVersion:g.sourceVersion??null,featureVersion:g.featureVersion??null,payloadHash:g.payloadHash??null});
  }
  normalized.sort((a,b)=>a.name.localeCompare(b.name));
  const manifest={signalSession,decisionCutoff,groups:normalized};
  return Object.freeze({state,ready:state==='READY',reasons:[...new Set(reasons)].sort(),manifestHash:sha256(manifest),manifest});
}

function pickState(current,next){
  const rank={READY:0,STALE:1,SOURCE_UNAVAILABLE:2,CORPORATE_ACTION_REVIEW:3,DATA_CONFLICT:4,BLOCKED:5};
  return (rank[next]??5)>(rank[current]??0)?next:current;
}
