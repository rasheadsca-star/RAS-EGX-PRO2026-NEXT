const finite=(v)=>Number.isFinite(Number(v));
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,Number(v)||0));
const round=(v,d=2)=>finite(v)?Number(Number(v).toFixed(d)):null;

function entryBounds(row){
  const z=row?.entry_zone;
  if(Array.isArray(z)){
    const vals=z.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(vals.length)return {low:vals[0],high:vals.at(-1)};
  }
  if(z&&typeof z==='object'){
    const low=Number(z.low??z.from??z.min),high=Number(z.high??z.to??z.max);
    if(Number.isFinite(low)||Number.isFinite(high))return {low:Number.isFinite(low)?low:high,high:Number.isFinite(high)?high:low};
  }
  const p=Number(row?.pivot),last=Number(row?.last_price);
  const ref=Number.isFinite(p)?p:last;
  return Number.isFinite(ref)?{low:ref,high:ref}:null;
}

export function buildTargetPlan(row,cfg={}){
  const bounds=entryBounds(row),stop=Number(row?.stop_loss);
  if(!bounds||!Number.isFinite(stop))return {valid:false,reason:'TARGET_PLAN_INPUT_MISSING'};
  const entry=Number(bounds.high);
  const risk=entry-stop;
  if(!(entry>0&&risk>0))return {valid:false,reason:'TARGET_PLAN_INVALID_RISK'};
  const multiples=Array.isArray(cfg?.targetRMultiples)&&cfg.targetRMultiples.length?cfg.targetRMultiples:[2,3,4];
  const targets=multiples.map((r,i)=>({
    id:`T${i+1}`,
    r:Number(r),
    price:round(entry+Number(r)*risk,4),
    gainPct:round(Number(r)*risk/entry*100,2),
  }));
  return {
    valid:true,
    entryLow:round(bounds.low,4),
    entryHigh:round(bounds.high,4),
    referenceEntry:round(entry,4),
    stopLoss:round(stop,4),
    riskPerShare:round(risk,4),
    riskPct:round(risk/entry*100,2),
    targets,
    primaryTarget:targets[0]||null,
    secondaryTarget:targets[1]||null,
    stretchTarget:targets[2]||null,
  };
}

export function concentrationScore(row){
  const status=String(row?.status||'');
  const statusScore=({'READY NOW':100,'BREAKOUT CONFIRMED':98,'NEAR PIVOT':82})[status]??0;
  const rr=finite(row?.reward_risk)?clamp(Number(row.reward_risk)/4*100):0;
  const vcp=finite(row?.vcp?.quality)?clamp(row.vcp.quality):0;
  const score=
    .34*clamp(row?.final_score)+
    .20*clamp(row?.confidence_score)+
    .14*clamp(row?.rs_percentile)+
    .12*statusScore+
    .10*vcp+
    .10*rr;
  return round(score,1);
}

function hardCandidate(row,cfg){
  if(!row)return false;
  if(!['READY NOW','BREAKOUT CONFIRMED','NEAR PIVOT'].includes(row.status))return false;
  if(String(row.action||'').includes('WAIT')||row?.audit_stages?.entry?.raw?.do_not_chase===true)return false;
  if(!finite(row.final_score)||Number(row.final_score)<cfg.minFinalScore)return false;
  if(!finite(row.confidence_score)||Number(row.confidence_score)<cfg.minConfidenceScore)return false;
  if(!finite(row.reward_risk)||Number(row.reward_risk)<cfg.minRewardRisk)return false;
  return buildTargetPlan(row,cfg).valid;
}

export function selectConcentratedRecommendations(rows=[],cfg={}){
  const policy={
    baseCount:3,
    maxCount:5,
    minFinalScore:74,
    minConfidenceScore:65,
    minRewardRisk:2,
    expansionMinFinalScore:80,
    expansionMinConfidenceScore:72,
    expansionMinRewardRisk:2.25,
    expansionMaxConvictionGap:6,
    targetRMultiples:[2,3,4],
    ...cfg,
  };
  const ranked=(rows||[])
    .filter(x=>hardCandidate(x,policy))
    .map(x=>({...x,concentration_score:concentrationScore(x),target_plan:buildTargetPlan(x,policy)}))
    .sort((a,b)=>(b.concentration_score??-1)-(a.concentration_score??-1)||(b.final_score??-1)-(a.final_score??-1)||(b.confidence_score??-1)-(a.confidence_score??-1)||a.symbol.localeCompare(b.symbol));

  if(ranked.length<=policy.baseCount)return ranked.slice(0,policy.baseCount).map((x,i)=>({...x,conviction_rank:i+1}));
  const base=ranked.slice(0,policy.baseCount);
  const anchor=base.at(-1)?.concentration_score??0;
  const extras=ranked.slice(policy.baseCount,policy.maxCount).filter(x=>
    Number(x.final_score)>=policy.expansionMinFinalScore&&
    Number(x.confidence_score)>=policy.expansionMinConfidenceScore&&
    Number(x.reward_risk)>=policy.expansionMinRewardRisk&&
    ['READY NOW','BREAKOUT CONFIRMED'].includes(x.status)&&
    anchor-Number(x.concentration_score)<=policy.expansionMaxConvictionGap
  );
  // Keep the output concentrated: 3 by default; expand to 5 only when two extra names pass.
  const selected=extras.length>=2?[...base,...extras.slice(0,2)]:base;
  return selected.map((x,i)=>({...x,conviction_rank:i+1}));
}
