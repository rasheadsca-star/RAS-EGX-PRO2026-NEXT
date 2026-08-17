(()=>{
  'use strict';
  if(window.__MAIN_APP_GOVERNANCE_OVERLAY__)return;
  window.__MAIN_APP_GOVERNANCE_OVERLAY__=true;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d}):'—';
  const url=()=>new URL('../../data/stable/v16-main-app-current.json',location.href).href;
  const json=async u=>{const r=await fetch(`${u}${u.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};

  const style=document.createElement('style');
  style.textContent=`
    .main-app-governance{margin:12px 0 14px;padding:12px;border:1px solid #315970;border-radius:14px;background:#0a1f2e;text-align:right;display:grid;gap:10px}
    .main-app-governance.state-HEALTHY{border-color:#2d8b67;background:linear-gradient(135deg,#0b2a22,#0a1f2e)}
    .main-app-governance.state-DEGRADED{border-color:#a2742d;background:linear-gradient(135deg,#34280f,#0a1f2e)}
    .main-app-governance.state-RESEARCH_ONLY{border-color:#9b6b2d;background:linear-gradient(135deg,#302513,#0a1f2e)}
    .main-app-governance.state-BLOCKED{border-color:#9a4650;background:linear-gradient(135deg,#35181e,#0a1f2e)}
    .main-app-governance-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
    .main-app-governance-head strong{font-size:13px}.main-app-state-pill{font-size:11px;font-weight:800;padding:5px 9px;border-radius:999px;background:#17384b;color:#e8f8ff;direction:ltr}
    .main-app-governance-grid{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:8px}
    .main-app-governance-grid>div{padding:9px;border:1px solid #24485c;border-radius:10px;background:#071923}
    .main-app-governance-grid small{display:block;color:#8daaba;font-size:10px;margin-bottom:4px}.main-app-governance-grid b{font-size:12px;color:#f0fbff}
    .main-app-governance-note{font-size:11px;line-height:1.7;color:#a9c7d7}
    @media(max-width:800px){.main-app-governance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:520px){.main-app-governance-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const stateAr={HEALTHY:'سليم',DEGRADED:'يعمل بتحفظ',RESEARCH_ONLY:'بحث/متابعة فقط',BLOCKED:'محجوب'};
  let snapshot=null,observer=null,timer=null;

  function apply(){
    if(!snapshot)return;
    const panel=document.getElementById('v169BasketPanel');
    if(!panel)return;
    const state=String(snapshot.systemState||snapshot.state||'BLOCKED');
    const truth=snapshot.dataTruth||{};
    const policy=snapshot.portfolioPolicy||{};
    let box=document.getElementById('mainAppGovernanceBox');
    if(!box){box=document.createElement('div');box.id='mainAppGovernanceBox';const head=panel.querySelector('.v169-head');if(head)head.insertAdjacentElement('afterend',box);else panel.insertAdjacentElement('afterbegin',box);}
    box.className=`main-app-governance state-${state}`;
    const execution=snapshot.executionAllowed===true;
    const marketScan=truth.marketScanAtCairo||truth.marketScanAt||'—';
    const decisionBuilt=truth.decisionBuiltAtCairo||truth.decisionBuiltAt||'—';
    box.innerHTML=`<div class="main-app-governance-head"><strong>حالة MAIN APP الموثقة</strong><span class="main-app-state-pill">${esc(state)} · ${esc(stateAr[state]||state)}</span></div><div class="main-app-governance-grid"><div><small>جلسة السوق / القرار</small><b>${esc(truth.marketSession||'—')} / ${esc(truth.decisionSession||'—')}</b></div><div><small>آخر مسح سوق</small><b>${esc(marketScan)}</b></div><div><small>بناء القرار</small><b>${esc(decisionBuilt)}</b></div><div><small>تغطية إثبات المصدر</small><b>${fmt(truth.sourceSessionEvidenceCoveragePct,1)}%</b></div><div><small>Execution Grade</small><b>${truth.executionGrade===true?'مفتوح':'مغلق'}</b></div><div><small>التنفيذ من MAIN APP</small><b>${execution?'مسموح وفق البوابات':'0% — غير مسموح'}</b></div><div><small>التعرض المخطط</small><b>${fmt(policy.plannedAllocationPct,4)}%</b></div><div><small>النقد</small><b>${fmt(policy.cashReservePct,4)}%</b></div></div><div class="main-app-governance-note">المحرك المثبت: V16.9 Equal-Weight Basket. المقارنة بالمحركات الأخرى لا تغيّر الاختيار أو الترتيب أو صلاحية التنفيذ. أي تضارب أو نقص جلسة يُعامل تحفظيًا ويغلق التنفيذ.</div>`;

    panel.dataset.governanceState=state;
    panel.dataset.executionAllowed=String(execution);
    panel.classList.toggle('execution-blocked',!execution);
    if(!execution){
      panel.querySelectorAll('.v169-weight').forEach(el=>{if(!el.dataset.governanceOriginal)el.dataset.governanceOriginal=el.textContent||'';el.textContent='0% تنفيذ — الخطة محفوظة';});
    }
  }

  function schedule(){clearTimeout(timer);timer=setTimeout(apply,30);}
  async function init(){
    try{
      snapshot=await json(url());
      apply();
      if(!observer){observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});}
      document.dispatchEvent(new CustomEvent('main-app:governance-ready',{detail:{state:snapshot.systemState,executionAllowed:snapshot.executionAllowed,sessionDate:snapshot.sessionDate}}));
    }catch(e){console.warn('MAIN APP governance overlay unavailable:',e.message||e);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
