(()=>{
  'use strict';
  if(window.__MAIN_APP_CONSENSUS_OVERLAY__)return;
  window.__MAIN_APP_CONSENSUS_OVERLAY__=true;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const consensusUrl=()=>new URL('../../data/stable/v16-main-app-consensus.json',location.href).href;
  const snapshotUrl=()=>new URL('../../data/stable/v16-main-app-current.json',location.href).href;
  const getJson=async url=>{const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const state={consensus:null,snapshot:null,observer:null,timer:null};

  const style=document.createElement('style');
  style.textContent=`
    .main-app-consensus-summary{margin:10px 0 14px;padding:10px 12px;border:1px solid #315970;border-radius:12px;background:#0b2031;color:#bfe0f0;font-size:11px;line-height:1.7;text-align:right}
    .main-app-consensus-summary.stale{border-color:#8a6632;color:#ffd990}
    .main-app-engine-note{margin:10px 0 2px;padding:10px 11px;border:1px solid #42596b;border-radius:12px;background:#0a1b29;display:grid;gap:6px;text-align:right}
    .main-app-engine-note.confirmed{border-color:#3f9a72;background:linear-gradient(135deg,#0b251f,#0a1b29)}
    .main-app-engine-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .main-app-engine-head strong{font-size:12px;color:#eaf8ff}
    .main-app-confirmation-score{font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:#17384b;color:#dff6ff;direction:ltr}
    .main-app-engine-note.confirmed .main-app-confirmation-score{background:#164f3b;color:#c8ffe9}
    .main-app-engine-badges{display:flex;gap:5px;flex-wrap:wrap}
    .main-app-engine-badge{font-size:10px;padding:4px 7px;border:1px solid #37657e;border-radius:999px;color:#bfeaff;background:#102b3c}
    .main-app-engine-badge.related{border-color:#7c6936;background:#332a15;color:#ffe3a1}
    .main-app-engine-copy{font-size:11px;line-height:1.7;color:#adc6d5}
    .main-app-validator-line{font-size:10px;color:#8eabbc;border-top:1px dashed #29485c;padding-top:6px}
  `;
  document.head.appendChild(style);

  function annotations(){
    return new Map((state.consensus?.current?.mainAppAnnotations||[]).map(row=>[String(row.ticker||'').trim().toUpperCase(),row]));
  }
  function tickerFor(card){return String(card.querySelector('h3')?.textContent||'').trim().toUpperCase();}
  function validatorText(v){
    if(!v)return 'V17 Validator: غير متزامن/غير متاح — لا يُحتسب صوتًا.';
    if(v.executionEligible)return 'V17 Validator: صالح كتحقق إضافي — لا يُحتسب صوتًا مستقلاً.';
    const blockers=(v.blockers||[]).slice(0,2).join(' · ');
    return `V17 Validator: لا يمنح تنفيذًا${blockers?` (${blockers})`:''}.`;
  }
  function noteHtml(a){
    const votes=Number(a.independentVotes||1);
    const count=Number(a.independentEngineCount||2);
    const confirmed=votes===count&&count>1;
    const score=Number(a.confirmationScore||votes/count*100);
    const independents=(a.confirmingIndependentEngines||[]).map(name=>`<span class="main-app-engine-badge">✓ ${esc(name)}</span>`).join('');
    const related=(a.relatedCorroborators||[]).map(name=>`<span class="main-app-engine-badge related">≈ ${esc(name)}</span>`).join('');
    return `<div class="main-app-engine-note${confirmed?' confirmed':''}" data-main-app-consensus-note="${esc(a.ticker)}"><div class="main-app-engine-head"><strong>${esc(a.confirmationLabelAr||'تأكيد المحركات')}</strong><span class="main-app-confirmation-score">${votes}/${count} · ${score.toFixed(0)}%</span></div><div class="main-app-engine-badges"><span class="main-app-engine-badge">MAIN APP</span>${independents}${related}</div><div class="main-app-engine-copy">${esc(a.noteAr||'')}</div><div class="main-app-validator-line">${esc(validatorText(a.v17Validation))}</div></div>`;
  }
  function decorate(){
    const map=annotations();
    document.querySelectorAll('#v169BasketPanel .v169-card,#recommendationGrid .rec-card').forEach(card=>{
      const ticker=tickerFor(card);if(!ticker)return;
      const a=map.get(ticker);
      card.querySelector('[data-main-app-consensus-note]')?.remove();
      if(!a)return;
      const head=card.querySelector('.v169-card-head')||card.querySelector('.tag-row');
      if(head)head.insertAdjacentHTML('afterend',noteHtml(a));else card.insertAdjacentHTML('afterbegin',noteHtml(a));
    });
  }
  function summary(){
    const c=state.consensus,s=state.snapshot;if(!c||!s)return;
    const aligned=c.status==='CURRENT_SESSION_ALIGNED'&&c.sessionDate===s.sessionDate;
    const anns=c?.current?.mainAppAnnotations||[];
    const count=Number(c?.scoreDefinition?.independentEngineCount||2);
    const full=anns.filter(row=>Number(row.independentVotes)===count).length;
    let box=document.getElementById('mainAppConsensusSummary');
    if(!box){box=document.createElement('div');box.id='mainAppConsensusSummary';}
    box.className=`main-app-consensus-summary${aligned?'':' stale'}`;
    box.innerHTML=aligned
      ? `<b>مقارنة المحركات:</b> ${full}/${anns.length} توصية من MAIN APP ظهرت أيضًا في كل المحركات المستقلة المتزامنة. المقارنة للعرض والتأكيد فقط ولا تغيّر ترتيب MAIN APP أو صلاحية التنفيذ.`
      : `<b>مقارنة المحركات:</b> المحرك المستقل الآخر لم يصل بعد لنفس جلسة MAIN APP (${esc(s.sessionDate||'—')}). لن يُحتسب أي تطابق قديم.`;
    const truth=document.querySelector('#v169BasketPanel .v169-session-truth');
    if(truth)truth.insertAdjacentElement('afterend',box);
  }
  function apply(){summary();decorate();}
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(apply,30);}
  async function init(){
    try{
      [state.consensus,state.snapshot]=await Promise.all([getJson(consensusUrl()),getJson(snapshotUrl())]);
      if(state.consensus.schemaVersion!=='20.1.0-method-independent-consensus-1')throw Error('consensus schema mismatch');
      apply();
      if(!state.observer){state.observer=new MutationObserver(schedule);state.observer.observe(document.body,{childList:true,subtree:true});}
    }catch(error){console.warn('MAIN APP consensus unavailable:',error.message||error);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
