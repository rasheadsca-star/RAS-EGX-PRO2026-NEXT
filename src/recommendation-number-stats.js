const TARGET_STATES=new Set(['TARGET1','TARGET2','TARGET_HIT']);
const STOP_STATES=new Set(['STOP','STOP_HIT']);
const TIMEOUT_STATES=new Set(['TIMEOUT','EXPIRED','TIME_EXIT']);

export const POSITION_EDGE_GATE=Object.freeze({
  minResolved:20,
  minSessions:12,
  minLiftPctPoints:8,
  minProfitFactor:1.15,
  requirePositiveAverageNetReturn:true,
  promotionMode:'FORWARD_VALIDATION_REQUIRED'
});

const POSITION_GROUPS=Object.freeze([
  Object.freeze({id:'EARLY_1_4',label:'#1–4',min:1,max:4}),
  Object.freeze({id:'MIDDLE_5_8',label:'#5–8',min:5,max:8}),
  Object.freeze({id:'LATE_9_12',label:'#9–12',min:9,max:12})
]);

function round(v,d=2){const n=Number(v);if(!Number.isFinite(n))return null;const p=10**d;return Math.round(n*p)/p}
function normalizeState(v){return String(v??'').trim().toUpperCase()}
function classify(state){const s=normalizeState(state);if(TARGET_STATES.has(s))return 'TARGET';if(STOP_STATES.has(s))return 'STOP';if(TIMEOUT_STATES.has(s))return 'TIMEOUT';return 'OTHER'}
function firstNumber(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n))return n}return null}
function netReturnOf(row){return firstNumber(row?.netReturnPct,row?.outcome?.netReturnPct,row?.netPct,row?.returnPct,row?.outcomeNetReturnPct,row?.resolution?.netReturnPct,row?.resultMetrics?.netReturnPct)}
function rMultipleOf(row){return firstNumber(row?.rMultiple,row?.outcome?.rMultiple,row?.resolution?.rMultiple,row?.resultMetrics?.rMultiple)}
function groupForNumber(n){return POSITION_GROUPS.find(g=>n>=g.min&&n<=g.max)??null}

function emptyBucket(extra={}){
  return {...extra,sample:0,resolved:0,targetHits:0,stops:0,timeouts:0,other:0,_sessions:new Set(),_netReturns:[],_rMultiples:[]};
}

function addRow(bucket,row){
  bucket.sample++;
  if(row?.session)bucket._sessions.add(String(row.session));
  const kind=classify(row?.state);
  if(kind==='TARGET'){bucket.targetHits++;bucket.resolved++}
  else if(kind==='STOP'){bucket.stops++;bucket.resolved++}
  else if(kind==='TIMEOUT'){bucket.timeouts++;bucket.resolved++}
  else bucket.other++;
  const net=netReturnOf(row);if(net!==null)bucket._netReturns.push(net);
  const r=rMultipleOf(row);if(r!==null)bucket._rMultiples.push(r);
}

function finalizeBucket(bucket,{contextSessions=0,baselineTargetHitRatePct=null}={}){
  const returns=bucket._netReturns??[],rMultiples=bucket._rMultiples??[],sessions=bucket._sessions?.size??0;
  const positive=returns.filter(v=>v>0).reduce((a,b)=>a+b,0);
  const negative=Math.abs(returns.filter(v=>v<0).reduce((a,b)=>a+b,0));
  const targetHitRatePct=bucket.resolved?round(bucket.targetHits/bucket.resolved*100,2):null;
  const targetHitRateLiftPctPoints=targetHitRatePct===null||baselineTargetHitRatePct===null?null:round(targetHitRatePct-baselineTargetHitRatePct,2);
  const out={...bucket};delete out._sessions;delete out._netReturns;delete out._rMultiples;
  return {
    ...out,
    sessions,
    appearanceRatePct:contextSessions?round(sessions/contextSessions*100,2):null,
    targetHitRatePct,
    stopRatePct:bucket.resolved?round(bucket.stops/bucket.resolved*100,2):null,
    timeoutRatePct:bucket.resolved?round(bucket.timeouts/bucket.resolved*100,2):null,
    baselineTargetHitRatePct,
    targetHitRateLiftPctPoints,
    averageNetReturnPct:returns.length?round(returns.reduce((a,b)=>a+b,0)/returns.length,4):null,
    netReturnProfitFactor:negative>0?round(positive/negative,3):null,
    netReturnSamples:returns.length,
    averageR:rMultiples.length?round(rMultiples.reduce((a,b)=>a+b,0)/rMultiples.length,4):null,
    rSamples:rMultiples.length
  };
}

function positionGate(row){
  if(!row)return {status:'NO_EVIDENCE',candidateForForwardValidation:false,positionAdjustmentEligible:false,reasons:['NO_EVIDENCE']};
  const reasons=[];
  if((row.resolved??0)<POSITION_EDGE_GATE.minResolved)reasons.push(`RESOLVED_LT_${POSITION_EDGE_GATE.minResolved}`);
  if((row.sessions??0)<POSITION_EDGE_GATE.minSessions)reasons.push(`SESSIONS_LT_${POSITION_EDGE_GATE.minSessions}`);
  if(row.targetHitRateLiftPctPoints===null||row.targetHitRateLiftPctPoints<POSITION_EDGE_GATE.minLiftPctPoints)reasons.push(`LIFT_LT_${POSITION_EDGE_GATE.minLiftPctPoints}PP`);
  if(POSITION_EDGE_GATE.requirePositiveAverageNetReturn&&(row.averageNetReturnPct===null||row.averageNetReturnPct<=0))reasons.push('AVG_NET_RETURN_NOT_POSITIVE');
  if(row.netReturnProfitFactor===null||row.netReturnProfitFactor<POSITION_EDGE_GATE.minProfitFactor)reasons.push(`PROFIT_FACTOR_LT_${POSITION_EDGE_GATE.minProfitFactor}`);
  const candidateForForwardValidation=reasons.length===0;
  return {
    status:candidateForForwardValidation?'CANDIDATE_FOR_FORWARD_VALIDATION':'DISCOVERY_ONLY',
    candidateForForwardValidation,
    positionAdjustmentEligible:false,
    reasons,
    rule:'NO_RANKING_ADJUSTMENT_WITHOUT_SEPARATE_FORWARD_VALIDATION'
  };
}

function summarizeRankedRows(rows=[],contextSessionCount=null){
  const contextSessions=Number.isInteger(contextSessionCount)&&contextSessionCount>=0?contextSessionCount:new Set(rows.map(r=>String(r?.session??'')).filter(Boolean)).size;
  const numberBuckets=new Map(),groupBuckets=new Map(POSITION_GROUPS.map(g=>[g.id,emptyBucket({groupId:g.id,label:g.label,min:g.min,max:g.max})]));
  const overall=emptyBucket({scope:'ALL_POSITIONS'});
  for(const row of rows){
    const recommendationNumber=Number(row?.recommendationNumber);
    if(!Number.isInteger(recommendationNumber)||recommendationNumber<1)continue;
    if(!numberBuckets.has(recommendationNumber))numberBuckets.set(recommendationNumber,emptyBucket({recommendationNumber}));
    addRow(numberBuckets.get(recommendationNumber),row);addRow(overall,row);
    const group=groupForNumber(recommendationNumber);if(group)addRow(groupBuckets.get(group.id),row);
  }
  const baselineRaw=finalizeBucket(overall,{contextSessions,baselineTargetHitRatePct:null});
  const baselineTargetHitRatePct=baselineRaw.targetHitRatePct;
  const byNumber=[...numberBuckets.values()].sort((a,b)=>a.recommendationNumber-b.recommendationNumber).map(b=>finalizeBucket(b,{contextSessions,baselineTargetHitRatePct}));
  const byGroup=[...groupBuckets.values()].map(b=>finalizeBucket(b,{contextSessions,baselineTargetHitRatePct}));
  const candidates=byNumber.filter(x=>x.resolved>0);
  const mostTargets=candidates.slice().sort((a,b)=>b.targetHits-a.targetHits||(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]??null;
  const highestHitRate=candidates.slice().sort((a,b)=>(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.targetHits-a.targetHits||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]??null;
  const bestGroupByHitRate=byGroup.filter(x=>x.resolved>0).slice().sort((a,b)=>(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.targetHits-a.targetHits||b.resolved-a.resolved||a.min-b.min)[0]??null;
  const early=byGroup.find(x=>x.groupId==='EARLY_1_4')??null,late=byGroup.find(x=>x.groupId==='LATE_9_12')??null;
  const lateVsEarlyTargetHitRateLiftPctPoints=early?.targetHitRatePct===null||late?.targetHitRatePct===null?null:round(late.targetHitRatePct-early.targetHitRatePct,2);
  return {
    numbering:'ONE_BASED_SESSION_ORDER',
    selectionRule:'MOST_TARGET_HITS_THEN_HIT_RATE_THEN_RESOLVED_THEN_LOWER_NUMBER',
    positionEdgeRule:'DISCOVERY_ONLY_UNTIL_SAMPLE_AND_FORWARD_VALIDATION_GATES_PASS',
    contextSessions,
    baseline:{...baselineRaw,baselineTargetHitRatePct,targetHitRateLiftPctPoints:0},
    byNumber,
    byGroup,
    mostTargets,
    highestHitRate,
    bestGroupByHitRate,
    positionEdge:{
      bestNumber:highestHitRate?{...highestHitRate,gate:positionGate(highestHitRate)}:null,
      bestGroup:bestGroupByHitRate?{...bestGroupByHitRate,gate:positionGate(bestGroupByHitRate)}:null,
      lateVsEarlyTargetHitRateLiftPctPoints,
      laterPositionSelectionBias:'LATER_POSITIONS_EXIST_ONLY_IN_SESSIONS_WITH_ENOUGH_RECOMMENDATIONS; appearanceRatePct must be reviewed before inference.',
      rankingAdjustment:{eligible:false,status:'LOCKED_PENDING_FORWARD_VALIDATION'}
    }
  };
}

export function summarizeEgxRecommendationNumbers(records=[],allowedDates=null){
  const allowed=allowedDates?new Set(allowedDates.map(String)):null,positionBySession=new Map(),rows=[];
  for(const r of records??[]){
    const session=String(r?.signalSession??'');if(!session||allowed&&!allowed.has(session))continue;
    const recommendationNumber=(positionBySession.get(session)??0)+1;positionBySession.set(session,recommendationNumber);
    rows.push({recommendationNumber,session,state:r?.outcome?.state??r?.outcomeState??r?.result,netReturnPct:netReturnOf(r),rMultiple:rMultipleOf(r)});
  }
  return {...summarizeRankedRows(rows,allowed?allowed.size:null),engine:'EGX ONE',evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY',definition:'Rank after the frozen daily candidate sort, before outcomes are known.'};
}

export function summarizeV169RecommendationNumbers(ledger,allowedDates=null){
  const allowed=allowedDates?new Set(allowedDates.map(String)):null,rows=[];
  for(const s of ledger?.sessions??[]){
    const session=String(s?.signalDate??'');if(!session||allowed&&!allowed.has(session))continue;
    (s?.members??[]).forEach((m,index)=>rows.push({recommendationNumber:index+1,session,state:m?.memberStatus,netReturnPct:firstNumber(m?.netReturnPct,m?.returnPct,m?.netPct),rMultiple:firstNumber(m?.rMultiple)}));
  }
  return {...summarizeRankedRows(rows,allowed?allowed.size:null),engine:'V16.9 EGX PRO',evidenceGrade:'EXACT_LOGGED_LEDGER',definition:'1-based member order preserved inside each frozen V16.9 signal-date ledger entry.'};
}

export function enrichLegacyComparisonRecommendationNumbers({comparison,simulation,legacyV169}={}){
  if(!comparison)return comparison;
  const commonDates=Array.isArray(comparison.commonDates)?comparison.commonDates:[];
  const currentStats=summarizeEgxRecommendationNumbers(simulation?.records??[],commonDates);
  const v16Stats=legacyV169?summarizeV169RecommendationNumbers(legacyV169,commonDates):null;
  return {
    ...comparison,
    comparisonRules:{...(comparison.comparisonRules??{}),recommendationNumberDefinition:'ONE_BASED_SESSION_ORDER_PRE_OUTCOME',positionEdgePolicy:'INFO_ONLY_NO_RANKING_MUTATION_PENDING_FORWARD_VALIDATION'},
    newTechnique:{...(comparison.newTechnique??{}),onV16ExactSignalDates:{...(comparison.newTechnique?.onV16ExactSignalDates??{}),recommendationNumberStats:currentStats}},
    v16_9:comparison.v16_9?{...comparison.v16_9,recommendationNumberStats:v16Stats}:comparison.v16_9
  };
}

export const RECOMMENDATION_NUMBER_STATS_CONTRACT=Object.freeze({authorityMode:'RESEARCH',productionAuthority:false,scoringImpact:'NONE',recommendationMutationAllowed:false,automaticOrders:false});
