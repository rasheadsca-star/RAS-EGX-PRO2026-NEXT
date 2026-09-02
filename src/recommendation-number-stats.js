const TARGET_STATES=new Set(['TARGET1','TARGET2','TARGET_HIT']);
const STOP_STATES=new Set(['STOP','STOP_HIT']);
const TIMEOUT_STATES=new Set(['TIMEOUT','EXPIRED','TIME_EXIT']);

function round(v,d=2){const n=Number(v);if(!Number.isFinite(n))return null;const p=10**d;return Math.round(n*p)/p}
function normalizeState(v){return String(v??'').trim().toUpperCase()}
function classify(state){const s=normalizeState(state);if(TARGET_STATES.has(s))return 'TARGET';if(STOP_STATES.has(s))return 'STOP';if(TIMEOUT_STATES.has(s))return 'TIMEOUT';return 'OTHER'}

function summarizeRankedRows(rows=[]){
  const buckets=new Map();
  for(const row of rows){
    const recommendationNumber=Number(row?.recommendationNumber);
    if(!Number.isInteger(recommendationNumber)||recommendationNumber<1)continue;
    if(!buckets.has(recommendationNumber))buckets.set(recommendationNumber,{recommendationNumber,sample:0,resolved:0,targetHits:0,stops:0,timeouts:0,other:0});
    const b=buckets.get(recommendationNumber),kind=classify(row?.state);b.sample++;
    if(kind==='TARGET'){b.targetHits++;b.resolved++}
    else if(kind==='STOP'){b.stops++;b.resolved++}
    else if(kind==='TIMEOUT'){b.timeouts++;b.resolved++}
    else b.other++;
  }
  const byNumber=[...buckets.values()].sort((a,b)=>a.recommendationNumber-b.recommendationNumber).map(b=>({...b,targetHitRatePct:b.resolved?round(b.targetHits/b.resolved*100,2):null}));
  const candidates=byNumber.filter(x=>x.resolved>0);
  const mostTargets=candidates.slice().sort((a,b)=>b.targetHits-a.targetHits||(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]??null;
  const highestHitRate=candidates.slice().sort((a,b)=>(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.targetHits-a.targetHits||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]??null;
  return {numbering:'ONE_BASED_SESSION_ORDER',selectionRule:'MOST_TARGET_HITS_THEN_HIT_RATE_THEN_RESOLVED_THEN_LOWER_NUMBER',byNumber,mostTargets,highestHitRate};
}

export function summarizeEgxRecommendationNumbers(records=[],allowedDates=null){
  const allowed=allowedDates?new Set(allowedDates.map(String)):null,positionBySession=new Map(),rows=[];
  for(const r of records??[]){
    const session=String(r?.signalSession??'');if(!session||allowed&&!allowed.has(session))continue;
    const recommendationNumber=(positionBySession.get(session)??0)+1;positionBySession.set(session,recommendationNumber);
    rows.push({recommendationNumber,state:r?.outcome?.state??r?.outcomeState??r?.result});
  }
  return {...summarizeRankedRows(rows),engine:'EGX ONE',evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY',definition:'Rank after the frozen daily candidate sort, before outcomes are known.'};
}

export function summarizeV169RecommendationNumbers(ledger,allowedDates=null){
  const allowed=allowedDates?new Set(allowedDates.map(String)):null,rows=[];
  for(const s of ledger?.sessions??[]){
    const session=String(s?.signalDate??'');if(!session||allowed&&!allowed.has(session))continue;
    (s?.members??[]).forEach((m,index)=>rows.push({recommendationNumber:index+1,state:m?.memberStatus}));
  }
  return {...summarizeRankedRows(rows),engine:'V16.9 EGX PRO',evidenceGrade:'EXACT_LOGGED_LEDGER',definition:'1-based member order preserved inside each frozen V16.9 signal-date ledger entry.'};
}

export function enrichLegacyComparisonRecommendationNumbers({comparison,simulation,legacyV169}={}){
  if(!comparison)return comparison;
  const commonDates=Array.isArray(comparison.commonDates)?comparison.commonDates:[];
  const currentStats=summarizeEgxRecommendationNumbers(simulation?.records??[],commonDates);
  const v16Stats=legacyV169?summarizeV169RecommendationNumbers(legacyV169,commonDates):null;
  return {
    ...comparison,
    comparisonRules:{...(comparison.comparisonRules??{}),recommendationNumberDefinition:'ONE_BASED_SESSION_ORDER_PRE_OUTCOME'},
    newTechnique:{...(comparison.newTechnique??{}),onV16ExactSignalDates:{...(comparison.newTechnique?.onV16ExactSignalDates??{}),recommendationNumberStats:currentStats}},
    v16_9:comparison.v16_9?{...comparison.v16_9,recommendationNumberStats:v16Stats}:comparison.v16_9
  };
}

export const RECOMMENDATION_NUMBER_STATS_CONTRACT=Object.freeze({authorityMode:'RESEARCH',productionAuthority:false,scoringImpact:'NONE',automaticOrders:false});
