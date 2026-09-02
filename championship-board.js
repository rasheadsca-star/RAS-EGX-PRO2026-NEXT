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

function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=2){const n=num(v);if(n===null)return null;const p=10**d;return Math.round(n*p)/p}
function pct(n,d){return d>0?round((n/d)*100,2):null}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(v,suffix=''){const n=num(v);return n===null?'N/A':`${n.toFixed(2)}${suffix}`}

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

function currentRecommendationNumberStats(sim,dates){
  const allowed=new Set(dates||[]),positionBySession=new Map(),buckets=new Map();
  for(const r of (Array.isArray(sim?.records)?sim.records:[])){
    const session=String(signalSessionOf(r)||'');if(!allowed.has(session))continue;
    const recommendationNumber=(positionBySession.get(session)||0)+1;positionBySession.set(session,recommendationNumber);
    if(!buckets.has(recommendationNumber))buckets.set(recommendationNumber,{recommendationNumber,sample:0,resolved:0,targetHits:0,stops:0,timeouts:0,other:0});
    const b=buckets.get(recommendationNumber),o=outcomeOf(r);b.sample++;
    if(TARGET_STATES.has(o)){b.targetHits++;b.resolved++}
    else if(STOP_STATES.has(o)){b.stops++;b.resolved++}
    else if(TIMEOUT_STATES.has(o)){b.timeouts++;b.resolved++}
    else b.other++;
  }
  const byNumber=[...buckets.values()].sort((a,b)=>a.recommendationNumber-b.recommendationNumber).map(b=>({...b,targetHitRatePct:b.resolved?pct(b.targetHits,b.resolved):null}));
  const mostTargets=byNumber.filter(x=>x.resolved>0).slice().sort((a,b)=>b.targetHits-a.targetHits||(Number(b.targetHitRatePct)||0)-(Number(a.targetHitRatePct)||0)||b.resolved-a.resolved||a.recommendationNumber-b.recommendationNumber)[0]||null;
  return {numbering:'ONE_BASED_SESSION_ORDER',selectionRule:'MOST_TARGET_HITS_THEN_HIT_RATE_THEN_RESOLVED_THEN_LOWER_NUMBER',byNumber,mostTargets,evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY',definition:'Rank after the frozen daily candidate sort, before outcomes are known.'};
}

function currentOnCommonDates(sim){
  const lc=sim?.legacyComparison||{};
  const dates=Array.isArray(lc.commonDates)?lc.commonDates.filter(Boolean):[];
  const allowed=new Set(dates);
  const records=Array.isArray(sim?.records)?sim.records:[];
  let targets=0,stops=0,timeouts=0;
  const returns=[];
  for(const r of records){
    if(!allowed.has(signalSessionOf(r)))continue;
    const o=outcomeOf(r);
    if(TARGET_STATES.has(o))targets++;
    else if(STOP_STATES.has(o))stops++;
    else if(TIMEOUT_STATES.has(o))timeouts++;
    else continue;
    const nr=netReturnOf(r);if(nr!==null)returns.push(nr);
  }
  const resolved=targets+stops;
  const triggered=resolved+timeouts;
  const pos=returns.filter(v=>v>0).reduce((a,b)=>a+b,0);
  const neg=Math.abs(returns.filter(v=>v<0).reduce((a,b)=>a+b,0));
  const persistedStats=lc?.newTechnique?.onV16ExactSignalDates?.recommendationNumberStats||null;
  return {
    engine:'EGX_ONE',
    evidenceGrade:lc?.newTechnique?.evidenceGrade||'POINT_IN_TIME_HISTORICAL_REPLAY',
    commonSignalDates:dates.length,
    commonDates:dates,
    resolvedMembers:resolved,
    triggeredMembers:triggered,
    targetHits:targets,
    stopHits:stops,
    timeouts,
    targetHitRatePct:pct(targets,resolved),
    stopRatePct:pct(stops,resolved),
    averageNetReturnPct:returns.length?round(returns.reduce((a,b)=>a+b,0)/returns.length,4):null,
    netReturnProfitFactor:neg>0?round(pos/neg,3):null,
    netReturnSamples:returns.length,
    recommendationNumberStats:persistedStats||currentRecommendationNumberStats(sim,dates)
  };
}

function buildComparison(sim,forward){
  const lc=sim?.legacyComparison||{};
  const rules=lc?.comparisonRules||{};
  const current=currentOnCommonDates(sim||{});
  const legacy=lc?.v16_9||null;
  const v16=legacy?{
    engine:'V16.9 EGX PRO',
    evidenceGrade:legacy.evidenceGrade||'UNKNOWN',
    commonSignalDates:num(legacy.commonSignalDates)??num(legacy.signalSessions),
    resolvedMembers:num(legacy.resolvedMembers),
    targetHits:num(legacy.targetHits),
    stopHits:num(legacy.stopHits),
    targetHitRatePct:num(legacy.targetHitRatePct),
    stopRatePct:num(legacy.stopRatePct),
    averageNetReturnPct:num(legacy.averageNetReturnPct),
    netReturnProfitFactor:num(legacy.netReturnProfitFactor),
    estimatedRoundTripCostPct:num(legacy.estimatedRoundTripCostPct),
    recommendationNumberStats:legacy.recommendationNumberStats||null
  }:null;
  const currentCost=num(rules.newTechniqueRoundTripCostPct);
  const sameDateScope=!!(v16&&current.commonSignalDates>0&&v16.commonSignalDates===current.commonSignalDates);
  const exactLegacy=!!(v16&&v16.evidenceGrade==='EXACT_LOGGED_LEDGER');
  const policyAllows=String(rules.v16Comparison||'').includes('DATE_ALIGNED_POLICY_COMPARISON');
  const outcomeComparable=sameDateScope&&exactLegacy&&policyAllows&&current.targetHitRatePct!==null&&v16.targetHitRatePct!==null;
  let currentScore=0,v16Score=0;
  let outcomeWinner='N/A';
  if(outcomeComparable){
    if(current.targetHitRatePct>v16.targetHitRatePct){currentScore++;outcomeWinner='EGX ONE'}
    else if(current.targetHitRatePct<v16.targetHitRatePct){v16Score++;outcomeWinner='V16.9 EGX PRO'}
    else outcomeWinner='TIE';
  }
  const costComparable=!!(v16&&currentCost!==null&&v16.estimatedRoundTripCostPct!==null&&Math.abs(currentCost-v16.estimatedRoundTripCostPct)<1e-9);
  const leader=currentScore>v16Score?'EGX ONE':v16Score>currentScore?'V16.9 EGX PRO':(currentScore+v16Score>0?'TIE':'N/A');
  const forwardRes=Array.isArray(forward?.resolutions)?forward.resolutions:[];
  const forwardStatus=forwardRes.length>0?'FORWARD_SHADOW_REALIZED':'FORWARD_SHADOW_PENDING';
  return {
    contract:CONTRACT,
    scope:'DATE_ALIGNED_POLICY_COMPARISON',
    sameDateScope,
    policyAllows,
    exactLegacy,
    currentCostPct:currentCost,
    v16CostPct:v16?.estimatedRoundTripCostPct??null,
    costComparable,
    current,v16,
    recommendationNumberDefinition:rules.recommendationNumberDefinition||'ONE_BASED_SESSION_ORDER_PRE_OUTCOME',
    score:{current:currentScore,v16:v16Score,leader,qualifiedMetrics:outcomeComparable?1:0},
    metrics:[
      {id:'target',label:'Target Hit %',current:current.targetHitRatePct,v16:v16?.targetHitRatePct??null,unit:'%',qualified:outcomeComparable,winner:outcomeWinner,rule:'HIGHER_BETTER'},
      {id:'failure',label:'Failure / Stop %',current:current.stopRatePct,v16:v16?.stopRatePct??null,unit:'%',qualified:false,winner:'INFO_ONLY',rule:'LOWER_BETTER_SAME_OUTCOME_FAMILY'},
      {id:'avgNet',label:'Avg Net Return %',current:current.averageNetReturnPct,v16:v16?.averageNetReturnPct??null,unit:'%',qualified:false,winner:'N/A',rule:costComparable?'INFO_ONLY':'N/A_COST_MISMATCH'},
      {id:'pf',label:'Net Return Profit Factor',current:current.netReturnProfitFactor,v16:v16?.netReturnProfitFactor??null,unit:'',qualified:false,winner:'N/A',rule:costComparable?'INFO_ONLY':'N/A_COST_MISMATCH'}
    ],
    forwardStatus,
    forwardResolutions:forwardRes.length,
    caveat:rules.v16Comparison||'DATE_ALIGNED_POLICY_COMPARISON; execution horizons and costs may differ'
  };
}

function styles(){
  if(typeof document==='undefined'||document.getElementById('egxChampionshipStyles'))return;
  const s=document.createElement('style');s.id='egxChampionshipStyles';s.textContent=`
  .egx-champ{direction:rtl;border:1px solid #243147;border-radius:20px;background:linear-gradient(145deg,#0d1422,#111c30);padding:18px;box-shadow:0 14px 42px rgba(0,0,0,.22);color:#eef4ff}
  .egx-champ *{box-sizing:border-box}.egx-champ-head{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
  .egx-champ-title{font-size:clamp(20px,3vw,30px);font-weight:900;letter-spacing:.2px}.egx-champ-sub{color:#9eb0c9;font-size:12px;margin-top:5px}
  .egx-champ-leader{padding:10px 14px;border-radius:999px;background:#17263d;border:1px solid #34527b;font-weight:900}.egx-champ-leader b{color:#7ee7b5}
  .egx-score{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch;margin:14px 0}.egx-fighter{border:1px solid #2a3952;border-radius:16px;padding:14px;background:#0b1220;text-align:center}.egx-fighter strong{display:block;font-size:18px}.egx-fighter .pts{font-size:36px;font-weight:950;margin-top:5px}.egx-vs{align-self:center;font-weight:950;color:#f5c96a;font-size:18px}
  .egx-best-rec{margin-top:10px;padding:9px;border-radius:11px;background:#101d30;border:1px solid #30435f;color:#b9cae1;font-size:11px}.egx-best-rec b{display:inline;color:#7ee7b5;font-size:15px}.egx-best-rec .egx-rec-number{font-size:20px;color:#f5c96a;font-weight:950}
  .egx-section-title{margin:17px 2px 8px;display:flex;justify-content:space-between;gap:10px;align-items:end}.egx-section-title b{font-size:15px}.egx-section-title span{font-size:10px;color:#91a4bd}
  .egx-champ-table-wrap{overflow:auto;border:1px solid #27354b;border-radius:14px}.egx-champ table{width:100%;border-collapse:collapse;min-width:680px}.egx-champ th,.egx-champ td{padding:11px 10px;border-bottom:1px solid #223047;text-align:center;font-size:13px}.egx-champ th{background:#121e31;color:#c7d7ee}.egx-champ td:first-child,.egx-champ th:first-child{text-align:right}.egx-win{color:#7ee7b5;font-weight:900}.egx-na{color:#9aa9bd}.egx-rec-no{font-size:16px;font-weight:950;color:#f5c96a;direction:ltr}.egx-evidence{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.egx-pill{border:1px solid #30435f;border-radius:999px;padding:6px 9px;font-size:11px;color:#b9cae1;background:#101b2c}.egx-warn{margin-top:12px;padding:10px 12px;border:1px solid #5a4a27;background:#231e12;color:#e9cf8b;border-radius:12px;font-size:12px;line-height:1.7}.egx-lock{margin-top:9px;color:#91a4bd;font-size:11px}
  @media(max-width:620px){.egx-score{grid-template-columns:1fr 1fr}.egx-vs{display:none}.egx-champ{padding:13px}.egx-section-title{align-items:flex-start;flex-direction:column}}
  `;document.head.appendChild(s);
}

function recommendationRows(c){
  const a=c.current?.recommendationNumberStats?.byNumber||[],b=c.v16?.recommendationNumberStats?.byNumber||[];
  const am=new Map(a.map(x=>[Number(x.recommendationNumber),x])),bm=new Map(b.map(x=>[Number(x.recommendationNumber),x]));
  const numbers=[...new Set([...am.keys(),...bm.keys()])].filter(Number.isFinite).sort((x,y)=>x-y);
  if(!numbers.length)return '<tr><td colspan="7" class="egx-na">Recommendation-number evidence is pending.</td></tr>';
  return numbers.map(n=>{
    const x=am.get(n),y=bm.get(n),xt=num(x?.targetHits),yt=num(y?.targetHits);let lead='—',cls='egx-na';
    if(xt!==null&&yt!==null){if(xt>yt){lead='EGX ONE';cls='egx-win'}else if(yt>xt){lead='V16.9';cls='egx-win'}else lead='TIE'}
    return `<tr><td class="egx-rec-no">#${n}</td><td>${x?.resolved??'N/A'}</td><td class="${xt!==null&&yt!==null&&xt>yt?'egx-win':''}">${xt??'N/A'}</td><td>${fmt(x?.targetHitRatePct,'%')}</td><td>${y?.resolved??'N/A'}</td><td class="${xt!==null&&yt!==null&&yt>xt?'egx-win':''}">${yt??'N/A'}</td><td>${fmt(y?.targetHitRatePct,'%')} <span class="${cls}">· ${lead}</span></td></tr>`;
  }).join('');
}

function bestRecommendationHTML(stats){
  const x=stats?.mostTargets;if(!x)return '<div class="egx-best-rec">MOST TARGETS: <b>N/A</b><br><small>evidence pending</small></div>';
  return `<div class="egx-best-rec">MOST TARGETS · Recommendation <span class="egx-rec-number">#${x.recommendationNumber}</span><br><b>${x.targetHits}</b> Target Hits · ${fmt(x.targetHitRatePct,'%')} · resolved ${x.resolved}</div>`;
}

function renderHTML(c){
  const v=c.v16;
  const metricRows=c.metrics.map(m=>{
    const curWin=m.qualified&&m.winner==='EGX ONE'; const oldWin=m.qualified&&m.winner==='V16.9 EGX PRO';
    const note=m.qualified?'POINT':(m.id==='failure'?'INFO · same outcome family':(m.rule==='N/A_COST_MISMATCH'?'N/A · cost mismatch':'INFO'));
    return `<tr><td>${esc(m.label)}</td><td class="${curWin?'egx-win':''}">${fmt(m.current,m.unit)}</td><td class="${oldWin?'egx-win':''}">${fmt(m.v16,m.unit)}</td><td class="${m.qualified?'egx-win':'egx-na'}">${esc(note)}</td></tr>`;
  }).join('');
  const dates=c.current.commonDates||[];
  const leaderLabel=c.score.leader==='N/A'?'N/A — evidence not qualified':c.score.leader;
  return `<div class="egx-champ">
    <div class="egx-champ-head"><div><div class="egx-champ-title">EGX ONE 🆚 V16.9 EGX PRO</div><div class="egx-champ-sub">Championship Board · Evidence-first · same-date scope</div></div><div class="egx-champ-leader">LEADER: <b>${esc(leaderLabel)}</b></div></div>
    <div class="egx-score"><div class="egx-fighter"><strong>EGX ONE</strong><div class="pts">${c.score.current}</div><small>${esc(c.current.evidenceGrade)}</small>${bestRecommendationHTML(c.current.recommendationNumberStats)}</div><div class="egx-vs">VS</div><div class="egx-fighter"><strong>V16.9 EGX PRO</strong><div class="pts">${c.score.v16}</div><small>${esc(v?.evidenceGrade||'N/A')}</small>${bestRecommendationHTML(v?.recommendationNumberStats)}</div></div>
    <div class="egx-champ-table-wrap"><table><thead><tr><th>Metric</th><th>EGX ONE</th><th>V16.9</th><th>Scoring status</th></tr></thead><tbody>${metricRows}<tr><td>Resolved sample</td><td>${c.current.resolvedMembers??'N/A'}</td><td>${v?.resolvedMembers??'N/A'}</td><td class="egx-na">INFO</td></tr></tbody></table></div>
    <div class="egx-section-title"><b>Recommendation # Performance</b><span>ترتيب التوصية داخل جلسة الإصدار · الإحصاء لا يضيف Championship points</span></div>
    <div class="egx-champ-table-wrap"><table><thead><tr><th>Recommendation #</th><th>EGX Resolved</th><th>EGX Targets</th><th>EGX Target %</th><th>V16.9 Resolved</th><th>V16.9 Targets</th><th>V16.9 Target % · Most targets</th></tr></thead><tbody>${recommendationRows(c)}</tbody></table></div>
    <div class="egx-evidence"><span class="egx-pill">Recommendation #: ${esc(c.recommendationNumberDefinition)}</span><span class="egx-pill">Common dates: ${dates.length}</span><span class="egx-pill">${esc(dates.join(' · ')||'N/A')}</span><span class="egx-pill">EGX ONE cost: ${fmt(c.currentCostPct,'%')}</span><span class="egx-pill">V16.9 cost: ${fmt(c.v16CostPct,'%')}</span><span class="egx-pill">Forward: ${esc(c.forwardStatus)} (${c.forwardResolutions})</span></div>
    <div class="egx-warn">${esc(c.caveat)}. Recommendation-number statistics are INFO ONLY: يتم اختيار “MOST TARGETS” بأكبر عدد Target Hits، ثم Target Hit Rate، ثم حجم resolved، ثم الرقم الأقل عند التعادل. لا تمنح هذه الإحصائية نقطة إضافية للبطولة. Net-return metrics لا تمنح نقاطًا عندما تختلف التكلفة، وFailure لا تُحسب كنقطة ثانية لأنها الوجه العكسي لنفس outcome family.</div>
    <div class="egx-lock">RESEARCH ONLY · PRODUCTION AUTHORITY: OFF · SCORING IMPACT ON RECOMMENDATIONS: NONE · AUTOMATIC ORDERS: DISABLED</div>
  </div>`;
}

function render(container,comparison){
  if(typeof document==='undefined')return false;
  const el=typeof container==='string'?document.querySelector(container):container;
  if(!el)return false;styles();el.innerHTML=renderHTML(comparison);return true;
}

function mount(root,comparison){
  if(!root)return false;let host=document.getElementById('championshipBoardHost');
  if(!host||host.parentElement!==root){host=document.createElement('div');host.id='championshipBoardHost';host.className='section';root.prepend(host)}
  render(host,comparison);return true;
}

async function fetchJSON(url){const r=await fetch(`${url}${url.includes('?')?'&':'?'}cb=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP_${r.status}:${url}`);return r.json()}
async function init(){
  if(typeof document==='undefined')return null;
  try{
    const [sim,forward]=await Promise.all([
      fetchJSON('/data/research/simulator/latest.json'),
      fetchJSON('/data/research/shadow-ledger/latest.json').catch(()=>null)
    ]);
    const c=buildComparison(sim,forward);
    const root=document.getElementById('compareArea')||document.querySelector('#compare .grid')||document.getElementById('compare');
    mount(root,c);
    if(root&&!root.__egxChampionshipObserver&&typeof MutationObserver!=='undefined'){
      const observer=new MutationObserver(()=>{if(!document.getElementById('championshipBoardHost'))mount(root,c)});observer.observe(root,{childList:true});root.__egxChampionshipObserver=observer;
    }
    return c;
  }catch(err){console.error('CHAMPIONSHIP_BOARD_BLOCKED',err);return null}
}

const API={CONTRACT,outcomeOf,signalSessionOf,netReturnOf,currentRecommendationNumberStats,currentOnCommonDates,buildComparison,recommendationRows,bestRecommendationHTML,renderHTML,render,mount,init};
global.EGXOneChampionshipBoard=API;
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init(),{once:true});else init();
}
})(typeof window!=='undefined'?window:globalThis);
