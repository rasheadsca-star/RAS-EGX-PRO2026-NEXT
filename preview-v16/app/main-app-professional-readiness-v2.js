(()=>{
  'use strict';
  if(window.__MAIN_APP_PROFESSIONAL_READINESS_V2__)return;
  window.__MAIN_APP_PROFESSIONAL_READINESS_V2__=true;

  const URL=new URL('../../data/stable/v16-main-app-professional-readiness.json',location.href).href;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
  const fmt=(v,d=0)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d}):'—';
  const state={data:null,timer:null,observer:null};

  const style=document.createElement('style');
  style.id='professionalReadinessV2Style';
  style.textContent=`
    #professionalReadinessV2Meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
    .prv2-kpi{padding:9px 10px;border:1px solid #31596d;border-radius:10px;background:#0a1e2b;text-align:right}
    .prv2-kpi small{display:block;color:#8eabb9;font-size:11px;margin-bottom:3px}.prv2-kpi b{font-size:16px;color:#f1fbff}
    .prv2-kpi.blocked{border-color:#8b4b48;background:#2d1719}.prv2-kpi.blocked b{color:#ffd1c6}
    .prv2-kpi.ok{border-color:#2e7359;background:#10271f}.prv2-kpi.ok b{color:#c9ffe7}
    #professionalReadinessV2Gaps{margin-top:10px;padding:11px;border:1px solid #5c4e2a;border-radius:12px;background:#2b2414;text-align:right}
    #professionalReadinessV2Gaps.good{border-color:#2e795d;background:#102820}
    .prv2-title{font-size:13px;font-weight:900;color:#fff;margin-bottom:7px}.prv2-list{display:grid;gap:6px}
    .prv2-gap{display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.6;color:#e6d7ad}
    .prv2-gap.hard{color:#ffd1b2}.prv2-gap .dot{font-weight:900;line-height:1.4}.prv2-note{font-size:11px;color:#9fb6c3;line-height:1.7;margin-top:8px;border-top:1px dashed #43505a;padding-top:7px}
    .prv2-breakdown-row{display:grid;grid-template-columns:minmax(120px,1fr) 2fr 38px;gap:8px;align-items:center}
    .prv2-breakdown-row span{font-size:12px}.prv2-breakdown-row .bar{height:7px;background:#17344a;border-radius:999px;overflow:hidden}.prv2-breakdown-row .bar i{display:block;height:100%;background:linear-gradient(90deg,#38b7dd,#42d5a6);border-radius:999px}.prv2-breakdown-row b{font-size:12px;text-align:left}
    .prv2-hard-gate{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;margin-inline-start:6px}.prv2-hard-gate.pass{background:#164d39;color:#c9ffe7}.prv2-hard-gate.block{background:#5a2d2a;color:#ffd5c6}
    @media(max-width:640px){#professionalReadinessV2Meta{grid-template-columns:1fr}.prv2-breakdown-row{grid-template-columns:minmax(100px,1fr) 1.4fr 34px}}
  `;
  document.head.appendChild(style);

  async function getJson(){
    const r=await fetch(`${URL}?t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    return r.json();
  }

  function stageClass(data){
    if(data.professionalClaimAllowed)return'good';
    if(Number(data.professionalReadinessScore)>=70)return'warn';
    return'bad';
  }

  function render(){
    const d=state.data;if(!d)return false;
    const gauge=document.getElementById('readinessGauge');
    const breakdown=document.getElementById('readinessBreakdown');
    const productStage=document.getElementById('productStage');
    const verdict=document.getElementById('professionalVerdict');
    if(!gauge||!breakdown||!productStage||!verdict)return false;

    const score=clamp(d.professionalReadinessScore);
    const cls=stageClass(d);
    const color=score>=90?'var(--green)':score>=70?'var(--amber)':'var(--red)';
    gauge.style.background=`conic-gradient(${color} ${score*3.6}deg,#17344a 0)`;
    gauge.innerHTML=`<strong>${fmt(score)}</strong><span>جاهزية مهنية V2</span>`;
    gauge.title=`جودة الأساس: ${fmt(d.foundationQualityScore,1)}/100`;

    const axes=Array.isArray(d.axes)?d.axes:[];
    breakdown.innerHTML=axes.map(a=>`<div class="prv2-breakdown-row"><span>${esc(a.labelAr)}</span><div class="bar"><i style="width:${clamp(a.scorePct)}%"></i></div><b>${fmt(a.scorePct)}</b></div>`).join('');

    productStage.textContent=d.stageAr||'Professional Readiness V2';
    productStage.className=`badge ${cls}`;
    const hardGatePass=Object.values(d.hardGates||{}).every(Boolean);
    verdict.className=`professional-verdict ${cls}`;
    verdict.innerHTML=`<b>${esc(d.stageAr||'')}</b><span class="prv2-hard-gate ${hardGatePass?'pass':'block'}">${hardGatePass?'Hard Gates PASS':'Hard Gate غير مكتمل'}</span><br>${d.professionalClaimAllowed?'اجتاز شروط الجاهزية المهنية المعرفة في V2.':'الأساس قد يكون قويًا، لكن لا يُسمح بادعاء الاعتماد المهني حتى اكتمال البوابات الإلزامية.'}`;

    let meta=document.getElementById('professionalReadinessV2Meta');
    if(!meta){meta=document.createElement('div');meta.id='professionalReadinessV2Meta';verdict.insertAdjacentElement('beforebegin',meta);}
    const liveAxis=axes.find(a=>a.id==='V169_LIVE_FORWARD');
    const dataAxis=axes.find(a=>a.id==='DATA_SESSION_INTEGRITY');
    const currentSourceOk=dataAxis?.details?.currentExecutionGrade===true;
    meta.innerHTML=`<div class="prv2-kpi"><small>جودة الأساس الهندسي/التحليلي</small><b>${fmt(d.foundationQualityScore,1)}/100</b></div><div class="prv2-kpi"><small>السجل الحي V16.9</small><b>${fmt(liveAxis?.details?.resolvedSessions)}/${fmt(liveAxis?.details?.minimumResolvedSessions)} جلسة</b></div><div class="prv2-kpi"><small>دليل القرار المنشور</small><b>${fmt(dataAxis?.details?.publishedDecisionEvidenceCoveragePct,1)}% · ${fmt(dataAxis?.details?.publishedEvidenceRows)} صف</b></div><div class="prv2-kpi ${currentSourceOk?'ok':'blocked'}"><small>المصدر اللحظي الآن</small><b>${currentSourceOk?'Execution Grade':'BLOCKED — لا تنفيذ'}</b></div><div class="prv2-kpi"><small>تأثير الدرجة على Ranking</small><b>لا تغيّر Alpha</b></div><div class="prv2-kpi"><small>جلسة القياس</small><b>${esc(d.sessionDate||'—')}</b></div>`;

    let gaps=document.getElementById('professionalReadinessV2Gaps');
    if(!gaps){gaps=document.createElement('div');gaps.id='professionalReadinessV2Gaps';verdict.insertAdjacentElement('afterend',gaps);}
    const req=Array.isArray(d.requirementsTo100)?d.requirementsTo100:[];
    gaps.className=req.length?'':'good';
    gaps.innerHTML=req.length
      ? `<div class="prv2-title">ما الذي ينقص للوصول إلى 100%؟</div><div class="prv2-list">${req.slice(0,8).map(x=>`<div class="prv2-gap ${x.hard?'hard':''}"><span class="dot">${x.hard?'●':'○'}</span><span>${esc(x.labelAr)}</span></div>`).join('')}</div><div class="prv2-note">● شرط إلزامي للاعتماد · ○ تحسين جودة. فشل المصدر الحالي يمنع التنفيذ، لكنه لا يمحو دليل القرار المنشور. والدرجة ليست احتمال نجاح التوصية القادمة.</div>`
      : `<div class="prv2-title">جميع متطلبات V2 الحالية مكتملة.</div><div class="prv2-note">هذا لا يعني ضمان نجاح التوصيات؛ بل يعني اكتمال معايير البيانات والأدلة والحوكمة المعرفة في النظام.</div>`;

    const oldTitle=[...document.querySelectorAll('h2,h3')].find(el=>/جاهزية المنتج للاعتماد المهني/.test(el.textContent||''));
    if(oldTitle)oldTitle.textContent='الجاهزية المهنية — Professional Readiness V2';
    return true;
  }

  function scheduleRender(){clearTimeout(state.timer);state.timer=setTimeout(render,40);}
  async function refresh(){
    try{state.data=await getJson();render();document.dispatchEvent(new CustomEvent('main-app:professional-readiness-v2',{detail:state.data}));}
    catch(e){console.warn('Professional Readiness V2 unavailable:',e.message||e);}
  }
  function init(){
    refresh();
    if(!state.observer){state.observer=new MutationObserver(scheduleRender);state.observer.observe(document.body,{childList:true,subtree:true});}
    setInterval(refresh,60000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
