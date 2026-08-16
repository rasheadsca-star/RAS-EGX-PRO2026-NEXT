(()=>{
  'use strict';
  if(window.__MAIN_APP_CONSENSUS_OVERLAY__)return;
  window.__MAIN_APP_CONSENSUS_OVERLAY__=true;
  const state={data:null,decision:null,observer:null,timer:null};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const style=document.createElement('style');
  style.textContent=`
    .main-app-engine-note{margin:10px 0 2px;padding:10px 11px;border:1px solid #34566c;border-radius:12px;background:#0a1b29;display:grid;gap:6px;text-align:right}
    .main-app-engine-note.very-high{border-color:#3f9a72;background:linear-gradient(135deg,#0b251f,#0a1b29)}
    .main-app-engine-note.base-only{border-color:#42596b}
    .main-app-engine-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .main-app-engine-head strong{font-size:12px;color:#eaf8ff}.main-app-confirmation-score{font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:#17384b;color:#dff6ff;direction:ltr}
    .main-app-engine-note.very-high .main-app-confirmation-score{background:#164f3b;color:#c8ffe9}
    .main-app-engine-badges{display:flex;gap:5px;flex-wrap:wrap}.main-app-engine-badge{font-size:10px;padding:4px 7px;border:1px solid #37657e;border-radius:999px;color:#bfeaff;background:#102b3c}
    .main-app-engine-badge.related{border-color:#7c6936;background:#332a15;color:#ffe3a1}.main-app-engine-badge.validator{border-color:#4f5f6b;background:#17242d;color:#b9cbd5}
    .main-app-engine-copy{font-size:11px;line-height:1.7;color:#adc6d5}.main-app-v17-line{font-size:10px;color:#8eabbc;border-top:1px dashed #29485c;padding-top:6px}
    .main-app-consensus-summary{margin:10px 0 14px;padding:10px 12px;border:1px solid #315970;border-radius:12px;background:#0b2031;color:#bfe0f0;font-size:11px;line-height:1.7;text-align:right}
    .main-app-consensus-summary b{color:#fff}.main-app-consensus-stale{border-color:#8a6632;color:#ffd990}
  `;
  document.head.appendChild(style);
  const json=async url=>{const r=await fetch(url+(url.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const multiUrl=()=>`${location.origin}/RAS-EGX0.1/data/v20/multi-engine-consensus.json`;
  const decisionUrl=()=>new URL('../../data/stable/v16-v169-primary-decision.json',location.href).href;
  function annotationMap(){return new Map((state.data?.current?.mainAppAnnotations||[]).map(x=>[String(x.ticker||'').toUpperCase(),x]));}
  function v17Text(v){
    if(!v)return'V17 Validator: لا توجد حالة تحقق متزامنة — لا يُحتسب صوتًا في الاتفاق.';
    if(v.executionEligible)return'V17 Validator: صالح وفق بوابة التحقق الحالية — لا يُحتسب صوتًا في الاتفاق.';
    const blockers=(v.blockers||[]).slice(0,2).join(' · ');
    return`V17 Validator: تحقق إضافي غير مستقل، وحالته التنفيذية محجوبة${blockers?` (${blockers})`:''}.`;
  }
  function noteHtml(a){
    const count=Number(a.independentEngineCount||2),votes=Number(a.independentVotes||0),score=Number(a.confirmationScore||0);
    const cls=votes===count&&count>1?'very-high':'base-only';
    const independent=(a.confirmingIndependentEngines||[]).map(e=>`<span class="main-app-engine-badge">✓ مستقل: ${esc(e)}</span>`).join('');
    const related=(a.relatedCorroborators||[]).map(e=>`<span class="main-app-engine-badge related">≈ ${esc(e)}</span>`).join('');
    const signature=`${a.ticker}|${votes}|${count}|${score}|${(a.relatedCorroborators||[]).join(',')}`;
    return`<div class="main-app-engine-note ${cls}" data-main-app-consensus-note="${esc(a.ticker)}" data-consensus-signature="${esc(signature)}"><div class="main-app-engine-head"><strong>${esc(a.confirmationLabelAr||'تأكيد المحركات')}</strong><span class="main-app-confirmation-score">${votes}/${count} مستقل · ${score.toFixed(0)}</span></div><div class="main-app-engine-badges"><span class="main-app-engine-badge">MAIN APP</span>${independent}${related}</div><div class="main-app-engine-copy">${esc(a.noteAr||'')}</div><div class="main-app-v17-line">${esc(v17Text(a.v17Validation))}</div></div>`;
  }
  function tickerFor(card){return String(card.querySelector('h3')?.textContent||'').trim().toUpperCase();}
  function decorateCard(card,map){
    const ticker=tickerFor(card);if(!ticker)return;
    const a=map.get(ticker);const old=card.querySelector(':scope > [data-main-app-consensus-note]')||card.querySelector('[data-main-app-consensus-note]');
    if(!a){old?.remove();return;}
    const signature=`${a.ticker}|${Number(a.independentVotes||0)}|${Number(a.independentEngineCount||2)}|${Number(a.confirmationScore||0)}|${(a.relatedCorroborators||[]).join(',')}`;
    if(old?.dataset.consensusSignature===signature)return;
    old?.remove();
    const html=noteHtml(a);
    if(card.classList.contains('v169-card')){
      const head=card.querySelector('.v169-card-head');
      if(head)head.insertAdjacentHTML('afterend',html);else card.insertAdjacentHTML('afterbegin',html);
      return;
    }
    const anchor=card.querySelector('.tag-row');
    if(anchor)anchor.insertAdjacentHTML('afterend',html);else card.insertAdjacentHTML('afterbegin',html);
  }
  function decorate(){
    if(!state.data||!state.decision)return;
    const map=annotationMap();
    document.querySelectorAll('#v169BasketPanel .v169-card,#recommendationGrid .rec-card').forEach(card=>decorateCard(card,map));
  }
  function summary(){
    if(!state.data||!state.decision)return;
    const aligned=state.data?.status==='CURRENT_SESSION_ALIGNED'&&state.decision?.sessionDate===state.data?.sessionDate;
    const anns=state.data?.current?.mainAppAnnotations||[];
    const count=Number(state.data?.scoreDefinition?.independentEngineCount||2);
    const full=anns.filter(x=>Number(x.independentVotes)===count).length;
    const independent=(state.data?.engineRegistry?.activeIndependent||[]).map(e=>e.label).join(' + ');
    const related=(state.data?.engineRegistry?.relatedCorroborators||[]).map(e=>e.label).join(' + ');
    let box=document.getElementById('mainAppConsensusSummary');
    if(!box){box=document.createElement('div');box.id='mainAppConsensusSummary';}
    box.className='main-app-consensus-summary'+(aligned?'':' main-app-consensus-stale');
    box.innerHTML=aligned
      ?`<b>تأكيد مستقل منهجيًا:</b> ${full}/${anns.length} من توصيات MAIN APP يؤيدها كل المحركات المستقلة الحالية (${esc(independent)}). ${related?`${esc(related)} يُعرض كتأييد من نفس عائلة الإشارة ولا يزيد الدرجة المستقلة.`:''} V17 Validator لا يُحتسب صوتًا.`
      :'<b>متابعة المحركات:</b> بيانات الاتفاق لم تتزامن بعد مع جلسة MAIN APP الحالية؛ لا يتم منح وزن تأكيدي حتى تتطابق الجلسات.';
    const v169Truth=document.querySelector('#v169BasketPanel .v169-session-truth');
    if(v169Truth){if(box.previousElementSibling!==v169Truth)v169Truth.insertAdjacentElement('afterend',box);return;}
    const grid=document.getElementById('recommendationGrid');if(grid&&box.parentElement!==grid.parentElement)grid.parentElement?.insertBefore(box,grid);
  }
  function refreshDom(){summary();decorate();}
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(refreshDom,25);}
  async function init(){
    try{
      const [data,decision]=await Promise.all([json(multiUrl()),json(decisionUrl())]);
      if(data.schemaVersion!=='20.1.0-method-independent-consensus-1')throw Error(`schema mismatch: ${data.schemaVersion}`);
      state.data=data;state.decision=decision;refreshDom();
      if(!state.observer){state.observer=new MutationObserver(schedule);state.observer.observe(document.body,{childList:true,subtree:true});}
      document.dispatchEvent(new CustomEvent('main-app:consensus-ready',{detail:{sessionDate:data.sessionDate,annotations:data.current?.mainAppAnnotations||[],independentEngineCount:data.scoreDefinition?.independentEngineCount||2}}));
    }catch(e){console.warn('MAIN APP method-independent consensus overlay unavailable:',e.message||e);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
