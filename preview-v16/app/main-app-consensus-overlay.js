(()=>{
  'use strict';
  if(window.__MAIN_APP_CONSENSUS_OVERLAY__)return;
  window.__MAIN_APP_CONSENSUS_OVERLAY__=true;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const consensusUrl=()=>new URL('../../data/stable/v16-main-app-consensus.json',location.href).href;
  const snapshotUrl=()=>new URL('../../data/stable/v16-main-app-current.json',location.href).href;
  const getJson=async url=>{const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const state={consensus:null,snapshot:null,observer:null,timer:null,refreshTimer:null,loading:false};

  const style=document.createElement('style');
  style.textContent=`
    .main-app-consensus-summary{margin:10px 0 14px;padding:12px;border:1px solid #315970;border-radius:14px;background:#0b2031;color:#bfe0f0;font-size:11px;line-height:1.7;text-align:right;display:grid;gap:10px}
    .main-app-consensus-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.main-app-consensus-head b{color:#fff;font-size:12px}
    .main-app-consensus-session{font-size:10px;padding:4px 8px;border-radius:999px;background:#14384c;color:#d9f4ff;direction:ltr}
    .main-app-consensus-engines,.main-app-consensus-basket{display:flex;gap:6px;flex-wrap:wrap}
    .main-app-summary-chip{font-size:10px;padding:5px 8px;border-radius:999px;border:1px solid #365d72;background:#102a3a;color:#c9e9f8}
    .main-app-summary-chip.aligned{border-color:#2f8c68;background:#123d31;color:#d2ffec}.main-app-summary-chip.pending{border-color:#8b6a31;background:#332913;color:#ffe3a2}.main-app-summary-chip.blocked{border-color:#93444f;background:#35171d;color:#ffd9de}
    .main-app-basket-agreement{padding:6px 9px;border-radius:10px;background:#071b28;border:1px solid #21465a;color:#d6edf7;direction:ltr;font-weight:800}
    .main-app-engine-note{margin:10px 0 2px;padding:11px;border:1px solid #42596b;border-radius:12px;background:#0a1b29;display:grid;gap:8px;text-align:right}
    .main-app-engine-note.has-agreement{border-color:#3f9a72;background:linear-gradient(135deg,#0b251f,#0a1b29)}
    .main-app-engine-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .main-app-engine-head strong{font-size:12px;color:#eaf8ff}.main-app-agreement-score{font-size:12px;font-weight:900;padding:5px 9px;border-radius:999px;background:#17384b;color:#dff6ff;direction:ltr}
    .main-app-engine-note.has-agreement .main-app-agreement-score{background:#164f3b;color:#c8ffe9}
    .main-app-engine-meta{display:flex;gap:6px;flex-wrap:wrap;font-size:10px;color:#9eb7c5}.main-app-engine-meta span{padding:4px 7px;border-radius:999px;background:#101f2a;border:1px solid #2f4d5e}
    .main-app-engine-matrix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .main-app-engine-cell{padding:8px;border-radius:9px;border:1px solid #375467;background:#0c202c;display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:10px}
    .main-app-engine-cell b{font-size:10px}.main-app-engine-cell.agree{border-color:#347f61;background:#103428;color:#d8ffed}.main-app-engine-cell.no-match{border-color:#50606a;color:#c8d4da}.main-app-engine-cell.pending{border-color:#8b6a31;background:#302713;color:#ffe2a0}.main-app-engine-cell.blocked{border-color:#8e4650;background:#33181e;color:#ffd9de}
    .main-app-engine-copy{font-size:11px;line-height:1.7;color:#adc6d5}.main-app-independent-line{font-size:10px;color:#8eabbc;border-top:1px dashed #29485c;padding-top:6px}
    @media(max-width:640px){.main-app-engine-matrix{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  function annotations(){return new Map((state.consensus?.current?.mainAppAnnotations||[]).map(row=>[String(row.ticker||'').trim().toUpperCase(),row]));}
  function tickerFor(card){return String(card.dataset.ticker||card.querySelector('[data-ticker]')?.dataset?.ticker||card.querySelector('h3')?.textContent||'').trim().toUpperCase();}
  function shortDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return value||'—';const [y,m,d]=value.split('-');return `${d}/${m}`;}
  function engineClass(engine){if(engine.blocked)return'blocked';if(!engine.sessionAligned)return'pending';return engine.selected===true?'agree':'no-match';}
  function engineStatusAr(engine){if(engine.blocked)return`محجوب · ${shortDate(engine.sessionDate)}`;if(!engine.sessionAligned)return`غير متزامن · ${shortDate(engine.sessionDate)}`;return engine.selected===true?'متوافق':'غير متوافق';}
  function engineCell(engine){return `<div class="main-app-engine-cell ${engineClass(engine)}"><b>${esc(engine.label)}</b><span>${esc(engineStatusAr(engine))}</span></div>`;}
  function noteSignature(a){return JSON.stringify({t:a.ticker,a:a.agreementCount,o:a.otherEngineCount,s:a.alignedEngineCount,i:a.independentVotes,c:(a.engineComparisons||[]).map(x=>[x.id,x.sessionDate,x.sessionAligned,x.selected,x.blocked,x.sourceStatus])});}
  function noteHtml(a){
    const agree=Number(a.agreementCount||0),total=Number(a.otherEngineCount||0),aligned=Number(a.alignedEngineCount||0);
    const independentOther=Math.max(0,Number(a.independentVotes||1)-1),independentTotal=Math.max(0,Number(a.independentEngineCount||1)-1);
    return `<div class="main-app-engine-note${agree>0?' has-agreement':''}" data-main-app-consensus-note="${esc(a.ticker)}" data-consensus-signature="${esc(noteSignature(a))}"><div class="main-app-engine-head"><strong>التوافق مع باقي المحركات</strong><span class="main-app-agreement-score">${agree}/${total}</span></div><div class="main-app-engine-meta"><span>المتزامن: ${aligned}/${total}</span><span>تأكيد مستقل: ${independentOther}/${independentTotal}</span></div><div class="main-app-engine-matrix">${(a.engineComparisons||[]).map(engineCell).join('')}</div><div class="main-app-engine-copy">${esc(a.noteAr||'')}</div><div class="main-app-independent-line">عدد التوافق يعرض كل المحركات الأخرى. التأكيد المستقل يحتسب فقط المحركات مختلفة المنهجية وعلى نفس جلسة MAIN APP.</div></div>`;
  }

  function decorateCard(card,map){
    const ticker=tickerFor(card);if(!ticker)return;
    const a=map.get(ticker);const old=card.querySelector('[data-main-app-consensus-note]');
    if(!a){old?.remove();return;}
    const signature=noteSignature(a);
    if(old?.dataset.consensusSignature===signature)return;
    old?.remove();
    const head=card.querySelector('.v169-card-head')||card.querySelector('.tag-row');
    if(head)head.insertAdjacentHTML('afterend',noteHtml(a));else card.insertAdjacentHTML('afterbegin',noteHtml(a));
  }

  function decorate(){
    const map=annotations();
    document.querySelectorAll('#v169BasketPanel .v169-card,#recommendationGrid .rec-card').forEach(card=>decorateCard(card,map));
  }

  function summary(){
    const c=state.consensus,s=state.snapshot;if(!c||!s)return;
    const engines=c?.current?.engineSessions||c?.engineRegistry?.comparisonEngines||[];
    const anns=c?.current?.mainAppAnnotations||[];
    let box=document.getElementById('mainAppConsensusSummary');
    if(!box){box=document.createElement('div');box.id='mainAppConsensusSummary';}
    const signature=JSON.stringify({session:c.sessionDate,status:c.status,engines:engines.map(e=>[e.id,e.sessionDate,e.sessionAligned,e.blocked,e.sourceStatus]),rows:anns.map(a=>[a.ticker,a.agreementCount,a.alignedEngineCount,a.otherEngineCount])});
    if(box.dataset.signature!==signature){
      box.dataset.signature=signature;
      box.className='main-app-consensus-summary';
      const engineChips=engines.map(e=>`<span class="main-app-summary-chip ${e.blocked?'blocked':e.sessionAligned?'aligned':'pending'}">${esc(e.label)} · ${e.blocked?'محجوب':e.sessionAligned?'متزامن':`جلسة ${shortDate(e.sessionDate)}`}</span>`).join('');
      const basket=anns.map(a=>`<span class="main-app-basket-agreement">${esc(a.ticker)} ${Number(a.agreementCount||0)}/${Number(a.otherEngineCount||0)}</span>`).join('');
      box.innerHTML=`<div class="main-app-consensus-head"><b>مقارنة MAIN APP مع باقي المحركات</b><span class="main-app-consensus-session">MAIN ${esc(shortDate(c.sessionDate))}</span></div><div class="main-app-consensus-engines">${engineChips}</div><div>عدد التوافق لكل سهم — لا يتم احتساب محرك من جلسة أقدم كاتفاق حالي.</div><div class="main-app-consensus-basket">${basket}</div>`;
    }
    const truth=document.querySelector('#v169BasketPanel .v169-session-truth');
    if(truth&&box.previousElementSibling!==truth)truth.insertAdjacentElement('afterend',box);
  }

  function observe(){if(!state.observer)state.observer=new MutationObserver(schedule);if(document.body)state.observer.observe(document.body,{childList:true,subtree:true});}
  function apply(){
    if(!state.consensus||!state.snapshot)return;
    state.observer?.disconnect();
    try{summary();decorate();}finally{observe();}
  }
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(apply,60);}

  async function refreshData(){
    if(state.loading)return;state.loading=true;
    try{
      const [consensus,snapshot]=await Promise.all([getJson(consensusUrl()),getJson(snapshotUrl())]);
      if(consensus.schemaVersion!=='20.1.0-method-independent-consensus-1')throw Error(`consensus schema mismatch: ${consensus.schemaVersion}`);
      state.consensus=consensus;state.snapshot=snapshot;apply();
      document.dispatchEvent(new CustomEvent('main-app:engine-comparison-ready',{detail:{sessionDate:consensus.sessionDate,comparisonVersion:consensus.comparisonVersion,rows:consensus.current?.mainAppAnnotations||[]}}));
    }catch(error){console.warn('MAIN APP all-engine comparison unavailable:',error.message||error);}finally{state.loading=false;}
  }

  function init(){
    refreshData();
    clearInterval(state.refreshTimer);state.refreshTimer=setInterval(refreshData,60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshData();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
