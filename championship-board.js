(function(global){
'use strict';

const CONTRACT=Object.freeze({
  module:'EGX_ONE_CHAMPIONSHIP_BOARD',
  authorityMode:'RESEARCH',
  researchOnly:true,
  productionAuthority:false,
  scoringImpact:'NONE',
  recommendationMutationAllowed:false,
  executionAllowed:false,
  automaticOrders:false
});

const TARGET_STATES=new Set(['TARGET1','TARGET2']);
const STOP_STATES=new Set(['STOP']);
const TIMEOUT_STATES=new Set(['TIMEOUT']);
const EDGE_GROUPS=Object.freeze([
  Object.freeze({id:'EARLY_1_4',label:'#1–4',min:1,max:4}),
  Object.freeze({id:'MIDDLE_5_8',label:'#5–8',min:5,max:8}),
  Object.freeze({id:'LATE_9_12',label:'#9–12',min:9,max:12})
]);

function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=2){const n=num(v);if(n===null)return null;const p=10**d;return Math.round(n*p)/p}
function pct(n,d){return d>0?round((n/d)*100,2):null}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(v,suffix=''){const n=num(v);return n===null?'—':`${n.toFixed(2)}${suffix}`}
function signed(v,suffix=''){const n=num(v);return n===null?'—':`${n>0?'+':''}${n.toFixed(2)}${suffix}`}

function outcomeOf(r){
  const raw=r?.outcome?.state??r?.outcomeState??r?.result?.state??r?.result??r?.terminalOutcome??r?.status??r?.resolution?.outcome?.state??r?.resolution?.outcome??'';
  return String(raw||'').toUpperCase();
}
function signalSessionOf(r){return r?.signalSession||r?.session||r?.plan?.signalSession||r?.recommendation?.signalSession||null}
function netReturnOf(r){
  const candidates=[r?.netReturnPct,r?.outcome?.netReturnPct,r?.netPct,r?.returnPct,r?.outcomeNetReturnPct,r?.resolution?.netReturnPct,r?.resultMetrics?.netReturnPct];
  for(const v of candidates){const n=num(v);if(n!==null)return n}
  return null;
}
function groupFor(n){return EDGE_GROUPS.find(g=>n>=g.min&&n<=g.max)||null}

function finalizeFallbackBucket(b,contextSessions,baseline){
  const sessions=b._sessions?.size||0;
  const hit=b.resolved?pct(b.targetHits,b.resolved):null;
  const out={recommendationNumber:b.recommendationNumber,groupId:b.groupId,label:b.label,min:b.min,max:b.max,sample:b.sample,resolved:b.resolved,targetHits:b.targetHits,stops:b.stops,timeouts:b.timeouts,other:b.other,sessions,appearanceRatePct:contextSessions?pct(sessions,contextSessions):null,targetHitRatePct:hit,baselineTargetHitRatePct:baseline,targetHitRateLiftPctPoints:hit===null||baseline===null?null:round(hit-baseline,2)};
  return out;
}

function currentRecommendationNumberStats(sim,dates){
  const allowed=new Set(dates||[]),positionBySession=new Map(),buckets=new Map(),groups=new Map(EDGE_GROUPS.map(g=>[g.id,{...g,sample:0,resolved:0,targetHits:0,stops:0,timeouts:0,other:0,_sessions:new Set()}]));
  let totalResolved=0,totalTargets=0,totalStops=0,totalTimeouts=0,totalOther=0,totalSample=0;
  const touch=(b,o,session)=>{b.sample++;b._sessions.add(session);if(TARGET_STATES.has(o)){b.targetHits++;b.resolved++}else if(STOP_STATES.has(o)){b.stops++;b.resolved++}else if(TIMEOUT_STATES.has(o)){b.timeouts++;b.resolved++}else b.other++};
  for(const r of (Array.isArray(sim?.records)?sim.records:[])){
    const session=String(signalSessionOf(r)||'');if(!allowed.has(session))continue;
    const recommendationNumber=(positionBySession.get(session)||0)+1;positionBySession.set(session,recommendationNumber);
    if(!buckets.has(recommendationNumber))buckets.set(recommendationNumber,{recommendationNumber,sample:0,resolved:0,targetHits:0,stops:0,timeouts:0,other:0,_sessions:new Set()});
    const o=outcomeOf(r),b=buckets.get(recommendationNumber);touch(b,o,session);totalSample++;
    if(TARGET_STATES.has(o)){totalTargets++;totalResolved++}else if(STOP_STATES.has(o)){totalStops++;totalResolved++}else if(TIMEOUT_STATES.has(o))totalTimeouts++;else totalOther++;
    const g=groupFor(recommendationNumber);if(g)touch(groups.get(g.id),o,session);
  }
  const contextSessions=allowed.size,baseline=totalResolved?pct(totalTargets,totalResolved):null;
  const byNumber=[...buckets.values()].sort((a,b)=>a.recommendationNumber-b.recommendationNumber).map(b=>finalizeFallbackBucket(b,contextSessions,baseline));
  const byGroup=[...groups.values()].map(b=>finalizeFallbackBucket(b,contextSessions,baseline));
  const candidates=byNumber.filter(x=>x.resolved>0);
  const mostTargets=candidates.slice().sort((a,b)=>b.targetHits-a.targetHits||(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]||null;
  const highestHitRate=candidates.slice().sort((a,b)=>(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.targetHits-a.targetHits||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]||null;
  const bestGroup=byGroup.filter(x=>x.resolved>0).slice().sort((a,b)=>(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.targetHits-a.targetHits||b.resolved-a.resolved||a.min-b.min)[0]||null;
  const early=byGroup.find(x=>x.groupId==='EARLY_1_4'),late=byGroup.find(x=>x.groupId==='LATE_9_12');
  const lateLift=early?.targetHitRatePct===null||late?.targetHitRatePct===null?null:round(late.targetHitRatePct-early.targetHitRatePct,2);
  return {
    numbering:'ONE_BASED_SESSION_ORDER',selectionRule:'MOST_TARGET_HITS_THEN_HIT_RATE_THEN_RESOLVED_THEN_LOWER_NUMBER',contextSessions,
    baseline:{sample:totalSample,resolved:totalResolved,targetHits:totalTargets,stops:totalStops,timeouts:totalTimeouts,other:totalOther,targetHitRatePct:baseline},
    byNumber,byGroup,mostTargets,highestHitRate,bestGroupByHitRate:bestGroup,
    positionEdge:{bestNumber:highestHitRate?{...highestHitRate,gate:{status:'DISCOVERY_ONLY',candidateForForwardValidation:false,positionAdjustmentEligible:false,reasons:['PERSISTED_GATE_EVIDENCE_REQUIRED'],rule:'NO_RANKING_ADJUSTMENT_WITHOUT_SEPARATE_FORWARD_VALIDATION'}}:null,bestGroup:bestGroup?{...bestGroup,gate:{status:'DISCOVERY_ONLY',candidateForForwardValidation:false,positionAdjustmentEligible:false,reasons:['PERSISTED_GATE_EVIDENCE_REQUIRED']}}:null,lateVsEarlyTargetHitRateLiftPctPoints:lateLift,laterPositionSelectionBias:'LATER_POSITIONS_EXIST_ONLY_IN_SESSIONS_WITH_ENOUGH_RECOMMENDATIONS; appearanceRatePct must be reviewed before inference.',rankingAdjustment:{eligible:false,status:'LOCKED_PENDING_FORWARD_VALIDATION'}},
    evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY',definition:'Rank after the frozen daily candidate sort, before outcomes are known.'
  };
}

function currentOnCommonDates(sim){
  const lc=sim?.legacyComparison||{};
  const dates=Array.isArray(lc.commonDates)?lc.commonDates.filter(Boolean):[];
  const allowed=new Set(dates),records=Array.isArray(sim?.records)?sim.records:[];
  let targets=0,stops=0,timeouts=0;const returns=[];
  for(const r of records){
    if(!allowed.has(signalSessionOf(r)))continue;
    const o=outcomeOf(r);
    if(TARGET_STATES.has(o))targets++;else if(STOP_STATES.has(o))stops++;else if(TIMEOUT_STATES.has(o))timeouts++;else continue;
    const nr=netReturnOf(r);if(nr!==null)returns.push(nr);
  }
  const resolved=targets+stops,triggered=resolved+timeouts,pos=returns.filter(v=>v>0).reduce((a,b)=>a+b,0),neg=Math.abs(returns.filter(v=>v<0).reduce((a,b)=>a+b,0));
  const persistedStats=lc?.newTechnique?.onV16ExactSignalDates?.recommendationNumberStats||null;
  return {engine:'EGX_ONE',evidenceGrade:lc?.newTechnique?.evidenceGrade||'POINT_IN_TIME_HISTORICAL_REPLAY',commonSignalDates:dates.length,commonDates:dates,resolvedMembers:resolved,triggeredMembers:triggered,targetHits:targets,stopHits:stops,timeouts,targetHitRatePct:pct(targets,resolved),stopRatePct:pct(stops,resolved),averageNetReturnPct:returns.length?round(returns.reduce((a,b)=>a+b,0)/returns.length,4):null,netReturnProfitFactor:neg>0?round(pos/neg,3):null,netReturnSamples:returns.length,recommendationNumberStats:persistedStats||currentRecommendationNumberStats(sim,dates)};
}

function buildComparison(sim,forward){
  const lc=sim?.legacyComparison||{},rules=lc?.comparisonRules||{},current=currentOnCommonDates(sim||{}),legacy=lc?.v16_9||null;
  const v16=legacy?{engine:'V16.9 EGX PRO',evidenceGrade:legacy.evidenceGrade||'UNKNOWN',commonSignalDates:num(legacy.commonSignalDates)??num(legacy.signalSessions),resolvedMembers:num(legacy.resolvedMembers),targetHits:num(legacy.targetHits),stopHits:num(legacy.stopHits),targetHitRatePct:num(legacy.targetHitRatePct),stopRatePct:num(legacy.stopRatePct),averageNetReturnPct:num(legacy.averageNetReturnPct),netReturnProfitFactor:num(legacy.netReturnProfitFactor),estimatedRoundTripCostPct:num(legacy.estimatedRoundTripCostPct),recommendationNumberStats:legacy.recommendationNumberStats||null}:null;
  const currentCost=num(rules.newTechniqueRoundTripCostPct),sameDateScope=!!(v16&&current.commonSignalDates>0&&v16.commonSignalDates===current.commonSignalDates),exactLegacy=!!(v16&&v16.evidenceGrade==='EXACT_LOGGED_LEDGER'),policyAllows=String(rules.v16Comparison||'').includes('DATE_ALIGNED_POLICY_COMPARISON'),outcomeComparable=sameDateScope&&exactLegacy&&policyAllows&&current.targetHitRatePct!==null&&v16.targetHitRatePct!==null;
  let currentScore=0,v16Score=0,outcomeWinner='N/A';
  if(outcomeComparable){if(current.targetHitRatePct>v16.targetHitRatePct){currentScore++;outcomeWinner='EGX ONE'}else if(current.targetHitRatePct<v16.targetHitRatePct){v16Score++;outcomeWinner='V16.9 EGX PRO'}else outcomeWinner='TIE'}
  const costComparable=!!(v16&&currentCost!==null&&v16.estimatedRoundTripCostPct!==null&&Math.abs(currentCost-v16.estimatedRoundTripCostPct)<1e-9),leader=currentScore>v16Score?'EGX ONE':v16Score>currentScore?'V16.9 EGX PRO':(currentScore+v16Score>0?'TIE':'N/A'),forwardRes=Array.isArray(forward?.resolutions)?forward.resolutions:[],forwardStatus=forwardRes.length>0?'FORWARD_SHADOW_REALIZED':'FORWARD_SHADOW_PENDING';
  return {contract:CONTRACT,scope:'DATE_ALIGNED_POLICY_COMPARISON',sameDateScope,policyAllows,exactLegacy,currentCostPct:currentCost,v16CostPct:v16?.estimatedRoundTripCostPct??null,costComparable,current,v16,recommendationNumberDefinition:rules.recommendationNumberDefinition||'ONE_BASED_SESSION_ORDER_PRE_OUTCOME',positionEdgePolicy:rules.positionEdgePolicy||'INFO_ONLY_NO_RANKING_MUTATION_PENDING_FORWARD_VALIDATION',score:{current:currentScore,v16:v16Score,leader,qualifiedMetrics:outcomeComparable?1:0},metrics:[{id:'target',label:'Target Hit %',current:current.targetHitRatePct,v16:v16?.targetHitRatePct??null,unit:'%',qualified:outcomeComparable,winner:outcomeWinner,rule:'HIGHER_BETTER'},{id:'failure',label:'Failure / Stop %',current:current.stopRatePct,v16:v16?.stopRatePct??null,unit:'%',qualified:false,winner:'INFO_ONLY',rule:'LOWER_BETTER_SAME_OUTCOME_FAMILY'},{id:'avgNet',label:'Avg Net Return %',current:current.averageNetReturnPct,v16:v16?.averageNetReturnPct??null,unit:'%',qualified:false,winner:'N/A',rule:costComparable?'INFO_ONLY':'N/A_COST_MISMATCH'},{id:'pf',label:'Net Return Profit Factor',current:current.netReturnProfitFactor,v16:v16?.netReturnProfitFactor??null,unit:'',qualified:false,winner:'N/A',rule:costComparable?'INFO_ONLY':'N/A_COST_MISMATCH'}],forwardStatus,forwardResolutions:forwardRes.length,caveat:rules.v16Comparison||'DATE_ALIGNED_POLICY_COMPARISON; execution horizons and costs may differ'};
}

function styles(){
  if(typeof document==='undefined'||document.getElementById('egxChampionshipStyles'))return;
  const s=document.createElement('style');s.id='egxChampionshipStyles';s.textContent=`
  .egx-champ{direction:rtl;border:1px solid #243147;border-radius:20px;background:linear-gradient(145deg,#0d1422,#111c30);padding:18px;box-shadow:0 14px 42px rgba(0,0,0,.22);color:#eef4ff}.egx-champ *{box-sizing:border-box}
  .egx-champ-head{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}.egx-champ-title{font-size:clamp(20px,3vw,30px);font-weight:900;letter-spacing:.2px}.egx-champ-sub{color:#9eb0c9;font-size:12px;margin-top:5px}.egx-champ-leader{padding:10px 14px;border-radius:999px;background:#17263d;border:1px solid #34527b;font-weight:900}.egx-champ-leader b{color:#7ee7b5}
  .egx-score{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch;margin:14px 0}.egx-fighter{border:1px solid #2a3952;border-radius:16px;padding:14px;background:#0b1220;text-align:center}.egx-fighter strong{display:block;font-size:18px}.egx-fighter .pts{font-size:36px;font-weight:950;margin-top:5px}.egx-vs{align-self:center;font-weight:950;color:#f5c96a;font-size:18px}
  .egx-best-rec{margin-top:10px;padding:9px;border-radius:11px;background:#101d30;border:1px solid #30435f;color:#b9cae1;font-size:11px}.egx-best-rec b{display:inline;color:#7ee7b5;font-size:15px}.egx-best-rec .egx-rec-number{font-size:20px;color:#f5c96a;font-weight:950}.egx-section-title{margin:17px 2px 8px;display:flex;justify-content:space-between;gap:10px;align-items:end}.egx-section-title b{font-size:15px}.egx-section-title span{font-size:10px;color:#91a4bd}
  .egx-champ-table-wrap{overflow:auto;border:1px solid #27354b;border-radius:14px}.egx-champ table{width:100%;border-collapse:collapse;min-width:680px}.egx-champ th,.egx-champ td{padding:11px 10px;border-bottom:1px solid #223047;text-align:center;font-size:13px}.egx-champ th{background:#121e31;color:#c7d7ee}.egx-champ td:first-child,.egx-champ th:first-child{text-align:right}.egx-win{color:#7ee7b5;font-weight:900}.egx-na{color:#9aa9bd}.egx-rec-no{font-size:16px;font-weight:950;color:#f5c96a;direction:ltr}
  .egx-edge-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.egx-edge-card{border:1px solid #2f4260;background:#0b1424;border-radius:15px;padding:13px}.egx-edge-card-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px}.egx-edge-card-head strong{font-size:14px}.egx-edge-badge{font-size:10px;padding:5px 8px;border-radius:999px;border:1px solid #68582f;background:#261f11;color:#f0d58a}.egx-edge-best{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.egx-edge-num{font-size:30px;color:#f5c96a;font-weight:950;direction:ltr}.egx-edge-stat{font-size:12px;color:#b9cae1}.egx-edge-stat b{font-size:17px;color:#7ee7b5}.egx-edge-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.egx-edge-mini{background:#101d30;border-radius:10px;padding:8px;text-align:center;font-size:10px;color:#9fb1c8}.egx-edge-mini b{display:block;color:#e8f0fb;font-size:13px;margin-top:3px}.egx-edge-group{margin-top:10px}.egx-edge-group table{min-width:0}.egx-edge-group th,.egx-edge-group td{font-size:11px;padding:8px 6px}.egx-edge-lock{margin-top:10px;padding:9px;border-radius:10px;background:#201b10;border:1px solid #5a4a27;color:#e9cf8b;font-size:11px;line-height:1.6}
  .egx-evidence{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.egx-pill{border:1px solid #30435f;border-radius:999px;padding:6px 9px;font-size:11px;color:#b9cae1;background:#101b2c}.egx-warn{margin-top:12px;padding:10px 12px;border:1px solid #5a4a27;background:#231e12;color:#e9cf8b;border-radius:12px;font-size:12px;line-height:1.7}.egx-lock{margin-top:9px;color:#91a4bd;font-size:11px}
  @media(max-width:760px){.egx-edge-grid{grid-template-columns:1fr}}@media(max-width:620px){.egx-score{grid-template-columns:1fr 1fr}.egx-vs{display:none}.egx-champ{padding:13px}.egx-section-title{align-items:flex-start;flex-direction:column}.egx-edge-meta{grid-template-columns:1fr 1fr}}
  `;document.head.appendChild(s);
}

function recommendationRows(c){
  const a=c.current?.recommendationNumberStats?.byNumber||[],b=c.v16?.recommendationNumberStats?.byNumber||[],am=new Map(a.map(x=>[Number(x.recommendationNumber),x])),bm=new Map(b.map(x=>[Number(x.recommendationNumber),x])),numbers=[...new Set([...am.keys(),...bm.keys()])].filter(Number.isFinite).sort((x,y)=>x-y);
  if(!numbers.length)return '<tr><td colspan="7" class="egx-na">Recommendation-number evidence is pending.</td></tr>';
  return numbers.map(n=>{const x=am.get(n),y=bm.get(n),xt=num(x?.targetHits),yt=num(y?.targetHits);let lead='—',cls='egx-na';if(xt!==null&&yt!==null){if(xt>yt){lead='EGX ONE';cls='egx-win'}else if(yt>xt){lead='V16.9';cls='egx-win'}else lead='TIE'}return `<tr><td class="egx-rec-no">#${n}</td><td>${x?.resolved??'—'}</td><td class="${xt!==null&&yt!==null&&xt>yt?'egx-win':''}">${xt??'—'}</td><td>${fmt(x?.targetHitRatePct,'%')}</td><td>${y?.resolved??'—'}</td><td class="${xt!==null&&yt!==null&&yt>xt?'egx-win':''}">${yt??'—'}</td><td>${fmt(y?.targetHitRatePct,'%')} <span class="${cls}">· ${lead}</span></td></tr>`}).join('');
}

function bestRecommendationHTML(stats){const x=stats?.mostTargets;if(!x)return '<div class="egx-best-rec">MOST TARGETS: <b>N/A</b><br><small>evidence pending</small></div>';return `<div class="egx-best-rec">MOST TARGETS · Recommendation <span class="egx-rec-number">#${x.recommendationNumber}</span><br><b>${x.targetHits}</b> Target Hits · ${fmt(x.targetHitRatePct,'%')} · resolved ${x.resolved}</div>`}

function edgeGroupRows(stats){
  const groups=stats?.byGroup||[];if(!groups.length)return '<tr><td colspan="6" class="egx-na">Group evidence pending.</td></tr>';
  return groups.map(g=>`<tr><td class="egx-rec-no">${esc(g.label||'—')}</td><td>${g.resolved??'—'}</td><td>${g.targetHits??'—'}</td><td>${fmt(g.targetHitRatePct,'%')}</td><td>${signed(g.targetHitRateLiftPctPoints,'pp')}</td><td>${fmt(g.appearanceRatePct,'%')}</td></tr>`).join('');
}

function positionEdgeHTML(stats,engine){
  const edge=stats?.positionEdge||{},best=edge?.bestNumber||stats?.highestHitRate||null,gate=best?.gate||{},status=gate?.status||'DISCOVERY_ONLY',eligible=edge?.rankingAdjustment?.eligible===true,baseline=stats?.baseline?.targetHitRatePct,selectionBias=edge?.laterPositionSelectionBias||'Later positions appear only when a session contains enough recommendations.';
  const label=best?.recommendationNumber?`#${best.recommendationNumber}`:'—';
  return `<div class="egx-edge-card">
    <div class="egx-edge-card-head"><strong>${esc(engine)}</strong><span class="egx-edge-badge">${esc(status)}</span></div>
    <div class="egx-edge-best"><span class="egx-edge-num">${label}</span><span class="egx-edge-stat">Best observed position<br><b>${fmt(best?.targetHitRatePct,'%')}</b> · ${best?.targetHits??'—'}/${best?.resolved??'—'} targets/resolved</span></div>
    <div class="egx-edge-meta"><div class="egx-edge-mini">Lift vs baseline<b>${signed(best?.targetHitRateLiftPctPoints,'pp')}</b></div><div class="egx-edge-mini">Sessions<b>${best?.sessions??'—'}</b></div><div class="egx-edge-mini">Appearance<b>${fmt(best?.appearanceRatePct,'%')}</b></div><div class="egx-edge-mini">Baseline hit rate<b>${fmt(baseline,'%')}</b></div><div class="egx-edge-mini">Avg net return<b>${fmt(best?.averageNetReturnPct,'%')}</b></div><div class="egx-edge-mini">Profit factor<b>${fmt(best?.netReturnProfitFactor,'')}</b></div></div>
    <div class="egx-edge-group"><table><thead><tr><th>Position group</th><th>Resolved</th><th>Targets</th><th>Hit %</th><th>Lift</th><th>Appearance</th></tr></thead><tbody>${edgeGroupRows(stats)}</tbody></table></div>
    <div class="egx-edge-lock">Late #9–12 vs early #1–4 lift: <b>${signed(edge?.lateVsEarlyTargetHitRateLiftPctPoints,'pp')}</b><br>${esc(selectionBias)}<br><b>Ranking adjustment: ${eligible?'ELIGIBLE':'LOCKED'}</b> · separate forward validation required.</div>
  </div>`;
}

function renderHTML(c){
  const v=c.v16,metricRows=c.metrics.map(m=>{const curWin=m.qualified&&m.winner==='EGX ONE',oldWin=m.qualified&&m.winner==='V16.9 EGX PRO',note=m.qualified?'POINT':(m.id==='failure'?'INFO · same outcome family':(m.rule==='N/A_COST_MISMATCH'?'N/A · cost mismatch':'INFO'));return `<tr><td>${esc(m.label)}</td><td class="${curWin?'egx-win':''}">${fmt(m.current,m.unit)}</td><td class="${oldWin?'egx-win':''}">${fmt(m.v16,m.unit)}</td><td class="${m.qualified?'egx-win':'egx-na'}">${esc(note)}</td></tr>`}).join(''),dates=c.current.commonDates||[],leaderLabel=c.score.leader==='N/A'?'N/A — evidence not qualified':c.score.leader;
  return `<div class="egx-champ">
    <div class="egx-champ-head"><div><div class="egx-champ-title">EGX ONE 🆚 V16.9 EGX PRO</div><div class="egx-champ-sub">Championship Board · Evidence-first · same-date scope</div></div><div class="egx-champ-leader">LEADER: <b>${esc(leaderLabel)}</b></div></div>
    <div class="egx-score"><div class="egx-fighter"><strong>EGX ONE</strong><div class="pts">${c.score.current}</div><small>${esc(c.current.evidenceGrade)}</small>${bestRecommendationHTML(c.current.recommendationNumberStats)}</div><div class="egx-vs">VS</div><div class="egx-fighter"><strong>V16.9 EGX PRO</strong><div class="pts">${c.score.v16}</div><small>${esc(v?.evidenceGrade||'N/A')}</small>${bestRecommendationHTML(v?.recommendationNumberStats)}</div></div>
    <div class="egx-champ-table-wrap"><table><thead><tr><th>Metric</th><th>EGX ONE</th><th>V16.9</th><th>Scoring status</th></tr></thead><tbody>${metricRows}<tr><td>Resolved sample</td><td>${c.current.resolvedMembers??'—'}</td><td>${v?.resolvedMembers??'—'}</td><td class="egx-na">INFO</td></tr></tbody></table></div>
    <div class="egx-section-title"><b>Recommendation # Performance</b><span>ترتيب التوصية داخل جلسة الإصدار · الإحصاء لا يضيف Championship points</span></div>
    <div class="egx-champ-table-wrap"><table><thead><tr><th>Recommendation #</th><th>EGX Resolved</th><th>EGX Targets</th><th>EGX Target %</th><th>V16.9 Resolved</th><th>V16.9 Targets</th><th>V16.9 Target % · Most targets</th></tr></thead><tbody>${recommendationRows(c)}</tbody></table></div>
    <div class="egx-section-title"><b>POSITION EDGE · INFO ONLY</b><span>هل رقم التوصية يحمل ميزة متكررة أم مجرد عينة صغيرة؟ · لا تغيير للترتيب قبل Forward Validation</span></div>
    <div class="egx-edge-grid">${positionEdgeHTML(c.current.recommendationNumberStats,'EGX ONE')}${positionEdgeHTML(v?.recommendationNumberStats,'V16.9 EGX PRO')}</div>
    <div class="egx-evidence"><span class="egx-pill">Position-edge policy: ${esc(c.positionEdgePolicy)}</span><span class="egx-pill">Recommendation #: ${esc(c.recommendationNumberDefinition)}</span><span class="egx-pill">Common dates: ${dates.length}</span><span class="egx-pill">${esc(dates.join(' · ')||'N/A')}</span><span class="egx-pill">EGX ONE cost: ${fmt(c.currentCostPct,'%')}</span><span class="egx-pill">V16.9 cost: ${fmt(c.v16CostPct,'%')}</span><span class="egx-pill">Forward: ${esc(c.forwardStatus)} (${c.forwardResolutions})</span></div>
    <div class="egx-warn">${esc(c.caveat)}. POSITION EDGE is discovery evidence only. التوصيات المتأخرة لا تظهر إلا في الجلسات التي أنتجت عددًا كافيًا من التوصيات، لذلك Appearance Rate وحجم العينة جزء أساسي من الحكم. لا يوجد Position Bonus أو إعادة ترتيب أو Championship point بسبب #10 أو #12 قبل اجتياز عينة كافية ثم Forward Validation مستقل.</div>
    <div class="egx-lock">RESEARCH ONLY · PRODUCTION AUTHORITY: OFF · RECOMMENDATION MUTATION: DISABLED · POSITION ADJUSTMENT: LOCKED · AUTOMATIC ORDERS: DISABLED</div>
  </div>`;
}

function render(container,comparison){if(typeof document==='undefined')return false;const el=typeof container==='string'?document.querySelector(container):container;if(!el)return false;styles();el.innerHTML=renderHTML(comparison);return true}
function mount(root,comparison){if(!root)return false;let host=document.getElementById('championshipBoardHost');if(!host||host.parentElement!==root){host=document.createElement('div');host.id='championshipBoardHost';host.className='section';root.prepend(host)}render(host,comparison);return true}
async function fetchJSON(url){const r=await fetch(`${url}${url.includes('?')?'&':'?'}cb=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP_${r.status}:${url}`);return r.json()}
async function init(){if(typeof document==='undefined')return null;try{const [sim,forward]=await Promise.all([fetchJSON('/data/research/simulator/latest.json'),fetchJSON('/data/research/shadow-ledger/latest.json').catch(()=>null)]),c=buildComparison(sim,forward),root=document.getElementById('compareArea')||document.querySelector('#compare .grid')||document.getElementById('compare');mount(root,c);if(root&&!root.__egxChampionshipObserver&&typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>{if(!document.getElementById('championshipBoardHost'))mount(root,c)});observer.observe(root,{childList:true});root.__egxChampionshipObserver=observer}return c}catch(err){console.error('CHAMPIONSHIP_BOARD_BLOCKED',err);return null}}

const API={CONTRACT,outcomeOf,signalSessionOf,netReturnOf,currentRecommendationNumberStats,currentOnCommonDates,buildComparison,recommendationRows,bestRecommendationHTML,edgeGroupRows,positionEdgeHTML,renderHTML,render,mount,init};
global.EGXOneChampionshipBoard=API;
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(),{once:true});else init()}
})(typeof window!=='undefined'?window:globalThis);
