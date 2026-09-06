(function(global){
'use strict';
const CONTRACT=Object.freeze({module:'TECHNICAL_V2_BUNDLE_LOADER',authorityMode:'RESEARCH',scoringImpact:'NONE',recommendationMutationAllowed:false,executionAllowed:false,automaticOrders:false});
const DECISION_LAB_CONTRACT=Object.freeze({module:'EGX_ONE_DECISION_LAB_EMBED',authorityMode:'RESEARCH',scoringImpact:'NONE',recommendationMutationAllowed:false,executionAllowed:false,automaticOrders:false,freshnessMode:'FAIL_CLOSED_SAME_SESSION'});
const CORE='/technical-chart-v2-core.js?v=20260901-v2-core';
const ALIGN='/technical-chart-v21-alignment.js?v=20260901-v21-align1';
const KPI='/realized-kpi.js?v=20260901-kpi1';
const BOARD='/championship-board.js?v=20260901-champ1';
function loadScript(src,id){
  if(typeof document==='undefined')return Promise.resolve(false);
  if(id&&document.getElementById(id))return Promise.resolve(true);
  return new Promise((resolve,reject)=>{const s=document.createElement('script');if(id)s.id=id;s.src=src;s.async=false;s.onload=()=>resolve(true);s.onerror=()=>reject(new Error(`SCRIPT_LOAD_FAILED:${src}`));document.head.appendChild(s)});
}
function labSafe(value){return String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function labNum(value,digits=4){return Number.isFinite(Number(value))?Number(value).toLocaleString('en-GB',{maximumFractionDigits:digits}):'—';}
function nextEgxSession(session){
  const m=String(session||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),12));
  for(let i=0;i<7;i+=1){d.setUTCDate(d.getUTCDate()+1);const w=d.getUTCDay();if(w!==5&&w!==6)return d.toISOString().slice(0,10);}
  return null;
}
function installDecisionLab(){
  if(typeof document==='undefined'||document.getElementById('decisionlab'))return false;
  const tabs=document.getElementById('tabs'),main=document.querySelector('main');
  if(!tabs||!main)return false;
  const tab=document.createElement('button');
  tab.className='tab';tab.dataset.view='decisionlab';tab.textContent='Decision Lab';tab.id='decisionLabTab';tabs.appendChild(tab);
  const section=document.createElement('section');
  section.id='decisionlab';section.className='view';
  section.innerHTML=`
    <div class="hero"><div class="panel"><div class="ey">LIVE FRESHNESS-GATED DECISION LAB</div><h2>جلسة الإشارة منفصلة عن جلسة التنفيذ، ولا يتم عرض Snapshot قديم باعتباره «اليوم».</h2><p>هذه الطبقة تقرأ Published + UI مباشرة بدون Cache. إذا اختلف تاريخ الجلستين تُخفى الخطط فورًا ويظهر DATA NOT READY.</p><div class="toolbar"><button id="decisionLabRefresh" class="btn primary">تحديث Decision Lab</button></div></div><div class="panel"><div class="ey">AUTHORITY BOUNDARY</div><div class="big goodtxt">RESEARCH ONLY</div><div class="big badtxt" style="font-size:18px">NO AUTO ORDERS</div><div class="small">Decision Lab لا يغيّر Scoring ولا Recommendation Set ولا يرسل أوامر تداول.</div></div></div>
    <div id="decisionLabStatus" class="notice section">جارٍ التحقق من جلسة المصدر الحي…</div>
    <div id="decisionLabBody" class="hidden">
      <div class="cards"><div class="card"><div class="k">Signal Session</div><div id="decisionLabSignal" class="v">—</div></div><div class="card"><div class="k">Next EGX Session</div><div id="decisionLabNext" class="v">—</div></div><div class="card"><div class="k">Published Plans</div><div id="decisionLabCount" class="v">—</div></div><div class="card"><div class="k">Coverage</div><div id="decisionLabCoverage" class="v">—</div></div><div class="card"><div class="k">Feature State</div><div id="decisionLabFeature" class="v">—</div></div><div class="card"><div class="k">Authority</div><div class="v goodtxt">RESEARCH</div></div></div>
      <div class="section"><div class="title"><h3>خطط الجلسة التالية</h3><span id="decisionLabHash">snapshot —</span></div><div id="decisionLabRecs" class="recs"></div></div>
      <div class="notice goodline">قواعد التنفيذ البحثية: لا تطارد Gap أعلى من Entry High، تحقق من السيولة والسبريد، واحترم Stop. Signal Session هو آخر بار يومي مكتمل؛ التنفيذ يبدأ في الجلسة التالية أو لاحقًا وفق شروط Entry.</div>
    </div>`;
  main.appendChild(section);

  const el=id=>document.getElementById(id);
  const fail=(message,detail='')=>{
    const status=el('decisionLabStatus');
    if(status){status.className='notice badline section';status.innerHTML=`<b>DATA NOT READY</b> — ${labSafe(message)}${detail?`<br><span class="mono">${labSafe(detail)}</span>`:''}`;}
    el('decisionLabBody')?.classList.add('hidden');
  };
  const getJson=async url=>{
    const sep=url.includes('?')?'&':'?';
    const r=await fetch(`${url}${sep}t=${Date.now()}`,{cache:'no-store',headers:{'cache-control':'no-cache'}});
    if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);
    return r.json();
  };
  const refresh=async()=>{
    const button=el('decisionLabRefresh');if(button)button.disabled=true;
    const status=el('decisionLabStatus');if(status){status.className='notice section';status.textContent='جارٍ التحقق من Published + UI بدون Cache…';}
    try{
      const [pub,ui]=await Promise.all([getJson('/data/research/published/latest.json'),getJson('/data/research/ui/latest.json')]);
      const ps=String(pub?.signalSession||''),us=String(ui?.session||'');
      if(pub?.authorityMode!=='RESEARCH'||pub?.productionAuthority!==false||pub?.automaticOrders!==false)throw new Error('PUBLICATION_AUTHORITY_BOUNDARY_FAILED');
      if(ui?.authorityMode!=='RESEARCH'||ui?.productionAuthority!==false)throw new Error('UI_AUTHORITY_BOUNDARY_FAILED');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(ps)||!/^\d{4}-\d{2}-\d{2}$/.test(us))return fail('جلسة المصدر غير صالحة.',`published=${ps||'missing'} ui=${us||'missing'}`);
      if(ps!==us)return fail('تم منع عرض توصيات بسبب عدم تطابق الجلسة.',`published=${ps} ui=${us}`);
      const rows=Array.isArray(pub?.recommendations)?pub.recommendations:[];
      const next=nextEgxSession(ps);
      el('decisionLabSignal').textContent=ps;
      el('decisionLabNext').textContent=next||'—';
      el('decisionLabCount').textContent=String(rows.length);
      el('decisionLabCoverage').textContent=Number.isFinite(Number(ui?.counts?.currentSessionCoveragePct))?`${labNum(ui.counts.currentSessionCoveragePct,2)}%`:'—';
      el('decisionLabFeature').textContent=String(ui?.featureReadiness||'—');
      el('decisionLabHash').textContent=`snapshot ${String(pub?.publicationHash||'—').slice(0,14)}…`;
      el('decisionLabRecs').innerHTML=rows.length?rows.map((r,i)=>`<article class="rec ${r.decision==='WAIT_FOR_ENTRY'?'wait':''}"><div class="rh"><div><div class="ticker">#${i+1} ${labSafe(r.ticker)}</div><div class="name">${labSafe(r.companyNameAr||r.companyNameEn||'')}</div></div><span class="decision ${r.decision==='WAIT_FOR_ENTRY'?'warntxt':'goodtxt'}">${labSafe(r.decision)}</span></div><div class="plan"><div class="cell"><span>ENTRY LOW</span><b>${labNum(r.entryLow)}</b></div><div class="cell"><span>ENTRY HIGH</span><b>${labNum(r.entryHigh)}</b></div><div class="cell"><span>STOP</span><b class="badtxt">${labNum(r.stop)}</b></div><div class="cell"><span>TARGET 1</span><b class="goodtxt">${labNum(r.target1)}</b></div><div class="cell"><span>TARGET 2</span><b class="goodtxt">${labNum(r.target2)}</b></div></div><div class="chips"><span class="chip">Q ${labNum(r.qualityScore,0)}</span><span class="chip">RR ${labNum(r.netRiskReward,2)}</span><span class="chip">Expiry ${labNum(r.entryExpirySessions,0)} sessions</span></div></article>`).join(''):'<div class="empty">الجلسة محدثة لكن لا توجد خطط اجتازت البوابات.</div>';
      el('decisionLabBody').classList.remove('hidden');
      status.className='notice goodline section';
      status.innerHTML=`<b>FRESHNESS PASS</b> — published = ${labSafe(ps)} · ui = ${labSafe(us)} · التنفيذ البحثي من ${labSafe(next||'الجلسة التالية')} أو لاحقًا حسب Entry.`;
    }catch(error){fail('فشل تحميل أو تحقق Decision Lab الحي.',error?.message||String(error));}
    finally{if(button)button.disabled=false;}
  };
  el('decisionLabRefresh')?.addEventListener('click',refresh);
  tabs.addEventListener('click',event=>{
    const pressed=event.target.closest('.tab');if(!pressed)return;
    if(pressed===tab){if(location.hash!=='#decision-lab')history.replaceState(null,'',`${location.pathname}${location.search}#decision-lab`);refresh();}
    else if(location.hash==='#decision-lab')history.replaceState(null,'',`${location.pathname}${location.search}`);
  });
  const activateFromHash=()=>{if(location.hash==='#decision-lab'){setTimeout(()=>tab.click(),0);}};
  global.addEventListener('hashchange',activateFromHash);
  activateFromHash();
  refresh();
  return true;
}
async function boot(){
  if(typeof document==='undefined')return false;
  if(!global.EGXOneTechnicalV2)await loadScript(CORE,'egxTechnicalV2Core');
  if(!global.EGXOneTechnicalV21)await loadScript(ALIGN,'egxTechnicalV21Alignment');
  if(!global.EGXOneRealizedKPI)await loadScript(KPI,'egxRealizedKpiModule');
  if(!global.EGXOneChampionshipBoard)await loadScript(BOARD,'egxChampionshipBoardModule');
  installDecisionLab();
  return !!(global.EGXOneTechnicalV2&&global.EGXOneTechnicalV21&&global.EGXOneRealizedKPI&&global.EGXOneChampionshipBoard);
}
global.EGXOneTechnicalV2Loader={CONTRACT,DECISION_LAB_CONTRACT,CORE,ALIGN,KPI,BOARD,loadScript,installDecisionLab,boot};
if(typeof document!=='undefined')boot().catch(e=>console.error('TECHNICAL_V2_BUNDLE_BLOCKED',e));
})(typeof window!=='undefined'?window:globalThis);
