(()=>{
  'use strict';
  if(window.__MAIN_APP_CONSENSUS_OVERLAY__)return;
  window.__MAIN_APP_CONSENSUS_OVERLAY__=true;
  const state={data:null,decision:null,observer:null};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const style=document.createElement('style');
  style.textContent=`
    .main-app-engine-note{margin:10px 0 2px;padding:10px 11px;border:1px solid #34566c;border-radius:12px;background:#0a1b29;display:grid;gap:6px;text-align:right}
    .main-app-engine-note.very-high{border-color:#3f9a72;background:linear-gradient(135deg,#0b251f,#0a1b29)}
    .main-app-engine-note.high{border-color:#b28a38;background:linear-gradient(135deg,#29200b,#0a1b29)}
    .main-app-engine-note.base-only{border-color:#42596b}
    .main-app-engine-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .main-app-engine-head strong{font-size:12px;color:#eaf8ff}.main-app-confirmation-score{font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:#17384b;color:#dff6ff;direction:ltr}
    .main-app-engine-note.very-high .main-app-confirmation-score{background:#164f3b;color:#c8ffe9}.main-app-engine-note.high .main-app-confirmation-score{background:#5a4316;color:#ffe7a8}
    .main-app-engine-badges{display:flex;gap:5px;flex-wrap:wrap}.main-app-engine-badge{font-size:10px;padding:4px 7px;border:1px solid #37657e;border-radius:999px;color:#bfeaff;background:#102b3c}
    .main-app-engine-copy{font-size:11px;line-height:1.7;color:#adc6d5}.main-app-v17-line{font-size:10px;color:#8eabbc;border-top:1px dashed #29485c;padding-top:6px}
    .main-app-consensus-summary{margin:10px 0 14px;padding:10px 12px;border:1px solid #315970;border-radius:12px;background:#0b2031;color:#bfe0f0;font-size:11px;line-height:1.7;text-align:right}
    .main-app-consensus-summary b{color:#fff}.main-app-consensus-stale{border-color:#8a6632;color:#ffd990}
  `;
  document.head.appendChild(style);
  const json=async url=>{const r=await fetch(url+(url.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const multiUrl=()=>`${location.origin}/RAS-EGX0.1/data/v20/multi-engine-consensus.json`;
  const decisionUrl=()=>new URL('../../data/stable/v16-v169-primary-decision.json',location.href).href;
  function annotationMap(){return new Map((state.data?.current?.mainAppAnnotations||[]).map(x=>[String(x.ticker||'').toUpperCase(),x]));}
  function v17Text(v){if(!v)return'V17: لا توجد حالة تحقق متزامنة.';if(v.executionEligible)return'V17: صالح للتنفيذ وفق البوابة الحالية.';const blockers=(v.blockers||[]).slice(0,2).join(' · ');return`V17: تحقق فقط — التنفيذ محجوب${blockers?` (${blockers})`:''}.`;}
  function noteHtml(a){const cls=a.confirmationLevel==='VERY_HIGH'?'very-high':a.confirmationLevel==='HIGH'?'high':'base-only';const engines=(a.confirmingEngines||[]).map(e=>`<span class="main-app-engine-badge">✓ ${esc(e)}</span>`).join('');return`<div class="main-app-engine-note ${cls}" data-main-app-consensus-note="${esc(a.ticker)}"><div class="main-app-engine-head"><strong>${esc(a.confirmationLabelAr||'وزن تأكيدي')}</strong><span class="main-app-confirmation-score">${Number(a.independentVotes||0)}/${Number(a.independentEngineCount||3)} · ${Number(a.confirmationScore||0).toFixed(0)}</span></div><div class="main-app-engine-badges"><span class="main-app-engine-badge">MAIN APP</span>${engines}</div><div class="main-app-engine-copy">${esc(a.noteAr||'')}</div><div class="main-app-v17-line">${esc(v17Text(a.v17Validation))}</div></div>`;}
  function decorate(){if(!state.data||!state.decision)return;const grid=document.getElementById('recommendationGrid');if(!grid)return;const map=annotationMap();for(const card of grid.querySelectorAll('.rec-card')){const ticker=String(card.querySelector('h3')?.textContent||'').trim().toUpperCase();if(!ticker)continue;const old=card.querySelector('[data-main-app-consensus-note]');const a=map.get(ticker);if(!a){old?.remove();continue;}if(old?.dataset.mainAppConsensusNote===ticker)continue;old?.remove();const anchor=card.querySelector('.tag-row');if(anchor)anchor.insertAdjacentHTML('afterend',noteHtml(a));else card.insertAdjacentHTML('afterbegin',noteHtml(a));}}
  function summary(){if(document.getElementById('mainAppConsensusSummary'))return;const grid=document.getElementById('recommendationGrid');if(!grid)return;const aligned=state.data?.status==='CURRENT_SESSION_ALIGNED'&&state.decision?.sessionDate===state.data?.sessionDate;const anns=state.data?.current?.mainAppAnnotations||[];const full=anns.filter(x=>x.independentVotes===3).length;const box=document.createElement('div');box.id='mainAppConsensusSummary';box.className='main-app-consensus-summary'+(aligned?'':' main-app-consensus-stale');box.innerHTML=aligned?`<b>متابعة المحركات:</b> ${full}/${anns.length} من توصيات MAIN APP لديها تأكيد 3/3 من المحركات المستقلة الحالية (MAIN APP + V19 + V20 Native). V17 يظل طبقة تحقق/تنفيذ ولا يُحتسب صوتًا مستقلًا.`:`<b>متابعة المحركات:</b> بيانات الاتفاق لم تتزامن بعد مع جلسة MAIN APP الحالية؛ لا يتم منح وزن تأكيدي حتى تتطابق الجلسات.`;grid.parentElement?.insertBefore(box,grid);}
  async function init(){try{const [data,decision]=await Promise.all([json(multiUrl()),json(decisionUrl())]);if(data.schemaVersion!=='20.0.0-multi-engine-consensus-1')throw Error('schema mismatch');state.data=data;state.decision=decision;summary();decorate();const grid=document.getElementById('recommendationGrid');if(grid&&!state.observer){state.observer=new MutationObserver(()=>decorate());state.observer.observe(grid,{childList:true,subtree:true});}document.dispatchEvent(new CustomEvent('main-app:consensus-ready',{detail:{sessionDate:data.sessionDate,annotations:data.current?.mainAppAnnotations||[]}}));}catch(e){console.warn('MAIN APP consensus overlay unavailable:',e.message||e);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
