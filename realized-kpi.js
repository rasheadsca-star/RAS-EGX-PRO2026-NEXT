(function(global){
'use strict';

const CONTRACT=Object.freeze({
  module:'REALIZED_OUTCOMES_KPI_V1',
  authorityMode:'RESEARCH',
  scoringImpact:'NONE',
  recommendationMutationAllowed:false,
  executionAllowed:false,
  automaticOrders:false,
  mixesHistoricalAndForward:false
});
const RESOLVED_STATES=new Set(['TARGET1','TARGET2','STOP','TIMEOUT']);
const TARGET_STATES=new Set(['TARGET1','TARGET2']);

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(v,d=2){return Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—'}
function pct(n,d){return d>0?n/d*100:null}
function stateOf(r){return String(r?.outcome?.state??r?.resolution?.state??r?.resolutionState??r?.result??r?.state??r?.status??'').trim().toUpperCase()}
function dateOf(r){return String(r?.terminalSession??r?.resolutionSession??r?.resolvedSession??r?.outcomeSession??r?.date??r?.session??'').slice(0,10)}
function tickerOf(r){return String(r?.ticker??r?.symbol??r?.plan?.ticker??r?.entry?.ticker??'').trim().toUpperCase()}

function normalizeRecord(r){
  const state=stateOf(r),date=dateOf(r);
  if(!RESOLVED_STATES.has(state)||!date)return null;
  return {
    ticker:tickerOf(r),date,state,
    targetHit:TARGET_STATES.has(state),
    target2:state==='TARGET2',
    stop:state==='STOP',
    timeout:state==='TIMEOUT',
    netReturnPct:finite(r?.netReturnPct??r?.outcome?.netReturnPct??r?.returnPct),
    raw:r
  };
}

function summarizeRecords(records){
  const normalized=(Array.isArray(records)?records:[]).map(normalizeRecord).filter(Boolean);
  const total=normalized.length,targetHits=normalized.filter(x=>x.targetHit).length,target2=normalized.filter(x=>x.target2).length,stops=normalized.filter(x=>x.stop).length,timeouts=normalized.filter(x=>x.timeout).length;
  const returns=normalized.map(x=>x.netReturnPct).filter(Number.isFinite);
  return {total,targetHits,target2,stops,timeouts,targetHitRatePct:pct(targetHits,total),failureRatePct:pct(stops,total),timeoutRatePct:pct(timeouts,total),avgNetReturnPct:returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null,records:normalized};
}

function buildDaily(records){
  const groups=new Map();
  for(const row of (Array.isArray(records)?records:[]).map(normalizeRecord).filter(Boolean)){
    if(!groups.has(row.date))groups.set(row.date,[]);
    groups.get(row.date).push(row);
  }
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,rows])=>({date,...summarizeRecords(rows)}));
}

function rollingSummary(daily,count=10){
  const tail=(Array.isArray(daily)?daily:[]).slice(-Math.max(1,Number(count)||10));
  return summarizeRecords(tail.flatMap(x=>x.records||[]));
}

function selectEvidence(forward,historical){
  const forwardRows=Array.isArray(forward?.resolutions)?forward.resolutions:[];
  const forwardSummary=summarizeRecords(forwardRows);
  if(forwardSummary.total>0){
    return {mode:'FORWARD_SHADOW_REALIZED',evidenceGrade:'FORWARD_SHADOW_FROZEN',forward:true,records:forwardRows,startAfterSession:forward?.startAfterSession||null,ledgerHash:forward?.ledgerHash||null,message:'نتائج Forward Shadow مجمّدة بعد النشر؛ لا يتم خلطها مع Historical replay.'};
  }
  const historicalRows=Array.isArray(historical?.records)?historical.records:[];
  return {mode:'HISTORICAL_POINT_IN_TIME_REPLAY',evidenceGrade:'POINT_IN_TIME_HISTORICAL_REPLAY',forward:false,records:historicalRows,startAfterSession:forward?.startAfterSession||null,ledgerHash:forward?.ledgerHash||null,message:'لا توجد Forward outcomes محلولة بعد؛ الأرقام الحالية Historical point-in-time replay وليست Forward live evidence.'};
}

async function fetchJson(url,optional=false){
  try{const r=await fetch(url);if(!r.ok)throw new Error(`HTTP_${r.status}`);return await r.json()}catch(e){if(optional)return null;throw e}
}

function hostSnapshots(){
  let forward=null,historical=null;
  try{if(typeof SHADOW!=='undefined'&&SHADOW)forward=SHADOW}catch{}
  try{if(typeof SIM!=='undefined'&&SIM)historical=SIM}catch{}
  return {forward,historical};
}
async function resolveSnapshots(){
  for(let i=0;i<40;i++){const h=hostSnapshots();if(h.historical)return h;await new Promise(r=>setTimeout(r,100))}
  const h=hostSnapshots();
  const [forward,historical]=await Promise.all([h.forward?Promise.resolve(h.forward):fetchJson('/data/research/shadow-ledger/latest.json',true),h.historical?Promise.resolve(h.historical):fetchJson('/data/research/simulator/latest.json',true)]);
  return {forward,historical};
}

function injectStyles(){
  if(typeof document==='undefined'||document.getElementById('egxRealizedKpiStyles'))return;
  const s=document.createElement('style');s.id='egxRealizedKpiStyles';s.textContent=`
.realized-kpi{margin:14px 0}.rk-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.rk-card{background:#071522;border:1px solid var(--line);border-radius:12px;padding:11px}.rk-card span{display:block;color:var(--m);font-size:8px}.rk-card b{display:block;direction:ltr;font-size:19px;margin-top:4px}.rk-meta{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0}.rk-table{max-height:330px;overflow:auto}.rk-target{color:var(--g)}.rk-fail{color:var(--r)}.rk-timeout{color:var(--w)}.rk-forward{border-color:#47d59a66}.rk-historical{border-color:#ffd16666}.rk-mini-note{font-size:9px;color:var(--m);line-height:1.7;margin-top:8px}@media(max-width:900px){.rk-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.rk-grid{grid-template-columns:1fr 1fr}}
`;document.head.appendChild(s);
}

function renderPanel(selection){
  if(typeof document==='undefined')return null;
  injectStyles();
  const today=document.getElementById('today');if(!today)return null;
  let panel=document.getElementById('realizedKpiPanel');
  if(!panel){panel=document.createElement('div');panel.id='realizedKpiPanel';panel.className='panel section realized-kpi';const anchor=today.querySelector('.cards');anchor?.insertAdjacentElement('afterend',panel);if(!anchor)today.prepend(panel)}
  const daily=buildDaily(selection.records),all=summarizeRecords(selection.records),latest=daily.at(-1)||null,roll=rollingSummary(daily,10);
  const sourceClass=selection.forward?'good':'warn';
  const latestLabel=latest?latest.date:'—';
  panel.innerHTML=`<div class="title"><h3>KPI تحقق الأهداف الحقيقية — يومًا بيوم</h3><span>${esc(selection.evidenceGrade)}</span></div>
  <div class="rk-meta"><span class="badge ${sourceClass}">${selection.forward?'FORWARD REALIZED':'HISTORICAL REPLAY'}</span><span class="badge info">STOP_FIRST</span><span class="badge info">NO LOOKAHEAD</span><span class="badge bad">ZERO EXECUTION AUTHORITY</span></div>
  <div class="rk-grid"><div class="rk-card"><span>Target Hit — إجمالي</span><b class="rk-target">${fmt(all.targetHitRatePct)}%</b></div><div class="rk-card"><span>Failure / Stop — إجمالي</span><b class="rk-fail">${fmt(all.failureRatePct)}%</b></div><div class="rk-card"><span>Timeout — إجمالي</span><b class="rk-timeout">${fmt(all.timeoutRatePct)}%</b></div><div class="rk-card"><span>آخر يوم تحقق ${esc(latestLabel)}</span><b>${latest?`${fmt(latest.targetHitRatePct)} / ${fmt(latest.failureRatePct)}%`:'—'}</b></div><div class="rk-card"><span>آخر 10 أيام نتائج</span><b>${fmt(roll.targetHitRatePct)} / ${fmt(roll.failureRatePct)}%</b></div></div>
  <div class="notice ${selection.forward?'goodline':''}" style="margin-top:9px">${esc(selection.message)} العينة الحالية: <b>${all.total}</b> نتيجة triggered/resolved؛ NOT_TRIGGERED مستبعد من المقام. Target% + Stop% قد لا يساوي 100% لأن Timeout معروض منفصلًا.</div>
  <div class="tablewrap rk-table"><table><thead><tr><th>يوم النتيجة</th><th>العينة</th><th>Target Hits</th><th>Target %</th><th>Stops</th><th>Failure %</th><th>Timeout</th><th>Timeout %</th></tr></thead><tbody>${daily.slice().reverse().slice(0,20).map(d=>`<tr><td class="mono">${esc(d.date)}</td><td>${d.total}</td><td class="rk-target">${d.targetHits}</td><td class="rk-target">${fmt(d.targetHitRatePct)}%</td><td class="rk-fail">${d.stops}</td><td class="rk-fail">${fmt(d.failureRatePct)}%</td><td class="rk-timeout">${d.timeouts}</td><td class="rk-timeout">${fmt(d.timeoutRatePct)}%</td></tr>`).join('')||'<tr><td colspan="8">لا توجد نتائج محلولة بعد.</td></tr>'}</tbody></table></div>
  <div class="rk-mini-note">القياس مجمّع حسب <b>terminalSession</b> — أي اليوم الذي تحقق فيه الهدف أو ضُرب الوقف أو انتهت المهلة فعليًا، وليس يوم إصدار الإشارة. Target Hit يشمل TARGET1 وTARGET2. Failure هو STOP فقط؛ Timeout منفصل لمنع تضخيم نسبة الإخفاق.</div>`;
  panel.dataset.evidenceGrade=selection.evidenceGrade;panel.dataset.forward=String(selection.forward);panel.dataset.total=String(all.total);
  return {daily,all,rolling10:roll,selection};
}

async function init(){
  if(typeof document==='undefined')return null;
  const {forward,historical}=await resolveSnapshots();
  const selection=selectEvidence(forward,historical);
  return renderPanel(selection);
}

const API={CONTRACT,normalizeRecord,summarizeRecords,buildDaily,rollingSummary,selectEvidence,hostSnapshots,resolveSnapshots,renderPanel,init};
global.EGXOneRealizedKPI=API;
if(typeof document!=='undefined'){
  const start=()=>init().catch(e=>console.error('REALIZED_KPI_BLOCKED',e));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else setTimeout(start,0);
}
})(typeof window!=='undefined'?window:globalThis);
