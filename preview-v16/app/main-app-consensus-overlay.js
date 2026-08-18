(()=>{
  'use strict';
  if(window.__MAIN_APP_CONSENSUS_OVERLAY__)return;
  window.__MAIN_APP_CONSENSUS_OVERLAY__=true;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const consensusUrl=()=>new URL('../../data/stable/v16-main-app-consensus.json',location.href).href;
  const snapshotUrl=()=>new URL('../../data/stable/v16-main-app-current.json',location.href).href;
  const performanceUrl=()=>new URL('../../data/stable/v16-main-app-engine-performance.json',location.href).href;
  const getJson=async url=>{const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
  const state={consensus:null,snapshot:null,performance:null,observer:null,timer:null,refreshTimer:null,loading:false};

  const style=document.createElement('style');
  style.textContent=`
    .main-app-consensus-summary{margin:10px 0 14px;padding:13px 14px;border:1px solid #315970;border-radius:14px;background:#0b2031;color:#cbe6f2;font-size:14px;line-height:1.55;text-align:right;display:grid;gap:9px}
    .main-app-consensus-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.main-app-consensus-head b{color:#fff;font-size:16px}
    .main-app-consensus-session{font-size:13px;padding:5px 9px;border-radius:999px;background:#14384c;color:#d9f4ff;direction:ltr}
    .main-app-consensus-engines,.main-app-consensus-basket{display:flex;gap:7px;flex-wrap:wrap}
    .main-app-summary-chip{font-size:13px;padding:6px 9px;border-radius:999px;border:1px solid #365d72;background:#102a3a;color:#c9e9f8}
    .main-app-summary-chip.aligned{border-color:#2f8c68;background:#123d31;color:#d2ffec}.main-app-summary-chip.pending{border-color:#8b6a31;background:#332913;color:#ffe3a2}.main-app-summary-chip.blocked{border-color:#93444f;background:#35171d;color:#ffd9de}
    .main-app-basket-agreement{padding:7px 10px;border-radius:10px;background:#071b28;border:1px solid #21465a;color:#e5f5fc;direction:ltr;font-size:14px;font-weight:900}
    .main-app-engine-note{margin:10px 0 0;padding:10px 12px;border:1px solid #3a5b6d;border-radius:11px;background:#0b1e2a;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;text-align:right}
    .main-app-engine-note.has-agreement{border-color:#3f9a72;background:linear-gradient(135deg,#0b2c23,#0b1e2a)}
    .main-app-engine-note strong{font-size:15px;color:#effbff}
    .main-app-agreement-score{font-size:17px;font-weight:900;padding:6px 10px;border-radius:999px;background:#17384b;color:#dff6ff;direction:ltr}
    .main-app-engine-note.has-agreement .main-app-agreement-score{background:#164f3b;color:#c8ffe9}
    .main-app-engine-meta{font-size:13px;color:#a9c3cf;display:flex;gap:8px;flex-wrap:wrap}.main-app-engine-meta span{white-space:nowrap}
    .main-app-engine-performance{margin:0 0 14px;padding:13px 14px;border:1px solid #315970;border-radius:14px;background:#091c29;color:#cbe6f2;text-align:right;display:grid;gap:10px}
    .main-app-performance-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.main-app-performance-head b{font-size:16px;color:#fff}.main-app-performance-head small{font-size:12px;color:#91adba}
    .main-app-performance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:8px}
    .main-app-performance-row{border:1px solid #294b5e;border-radius:12px;padding:10px;background:#0d2635;display:grid;gap:7px;min-width:0}
    .main-app-performance-row.comparable{border-color:#36775d}.main-app-performance-row.pending{border-color:#745f33}.main-app-performance-row.related{border-color:#405d76}
    .main-app-performance-name{display:flex;justify-content:space-between;align-items:center;gap:7px;font-weight:900;color:#eefaff}.main-app-performance-name span:last-child{font-size:11px;color:#9fc0ce;font-weight:700}
    .main-app-performance-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;direction:ltr}.main-app-performance-metric{border-radius:8px;background:#071923;padding:7px 5px;text-align:center;min-width:0}.main-app-performance-metric b{display:block;font-size:16px;color:#fff}.main-app-performance-metric small{font-size:10px;color:#9cb5c0;direction:rtl;display:block;margin-top:2px}
    .main-app-performance-metric.target b{color:#88f0c3}.main-app-performance-metric.stop b{color:#ff9eaa}.main-app-performance-note{font-size:11px;color:#9db6c2;line-height:1.45}.main-app-performance-foot{font-size:11px;color:#91aeba;border-top:1px dashed #315064;padding-top:8px}
    @media(max-width:560px){.main-app-performance-grid{grid-template-columns:1fr}.main-app-performance-metrics{grid-template-columns:repeat(3,1fr)}}
  `;
  document.head.appendChild(style);

  function annotations(){return new Map((state.consensus?.current?.mainAppAnnotations||[]).map(row=>[String(row.ticker||'').trim().toUpperCase(),row]));}
  function tickerFor(card){return String(card.dataset.ticker||card.querySelector('[data-ticker]')?.dataset?.ticker||card.querySelector('h3')?.textContent||'').trim().toUpperCase();}
  function shortDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return value||'—';const [y,m,d]=value.split('-');return `${d}/${m}`;}
  function fmtPct(value){const n=Number(value);return Number.isFinite(n)?`${n.toFixed(1)}%`:'—';}
  function noteSignature(a){return JSON.stringify({t:a.ticker,a:a.agreementCount,o:a.otherEngineCount,s:a.alignedEngineCount,i:a.independentVotes});}
  function noteHtml(a){
    const agree=Number(a.agreementCount||0),total=Number(a.otherEngineCount||0),aligned=Number(a.alignedEngineCount||0);
    const independentOther=Math.max(0,Number(a.independentVotes||1)-1),independentTotal=Math.max(0,Number(a.independentEngineCount||1)-1);
    return `<div class="main-app-engine-note${agree>0?' has-agreement':''}" data-main-app-consensus-note="${esc(a.ticker)}" data-consensus-signature="${esc(noteSignature(a))}"><strong>توافق المحركات</strong><span class="main-app-agreement-score">${agree}/${total}</span><div class="main-app-engine-meta"><span>متزامن ${aligned}/${total}</span><span>مستقل ${independentOther}/${independentTotal}</span></div></div>`;
  }

  function decorateCard(card,map){
    const ticker=tickerFor(card);if(!ticker)return;
    const a=map.get(ticker);const old=card.querySelector('[data-main-app-consensus-note]');
    if(!a){old?.remove();return;}
    const signature=noteSignature(a);
    if(old?.dataset.consensusSignature===signature)return;
    old?.remove();
    const priority=card.querySelector('.v169-priority');
    if(priority)priority.insertAdjacentHTML('afterend',noteHtml(a));
    else card.insertAdjacentHTML('beforeend',noteHtml(a));
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
    const signature=JSON.stringify({session:c.sessionDate,status:c.status,engines:engines.map(e=>[e.id,e.sessionDate,e.sessionAligned,e.blocked]),rows:anns.map(a=>[a.ticker,a.agreementCount,a.alignedEngineCount,a.otherEngineCount])});
    if(box.dataset.signature!==signature){
      box.dataset.signature=signature;
      const engineChips=engines.map(e=>`<span class="main-app-summary-chip ${e.blocked?'blocked':e.sessionAligned?'aligned':'pending'}">${esc(e.label)} · ${e.blocked?'محجوب':e.sessionAligned?'متزامن':shortDate(e.sessionDate)}</span>`).join('');
      const basket=anns.map(a=>`<span class="main-app-basket-agreement">${esc(a.ticker)} ${Number(a.agreementCount||0)}/${Number(a.otherEngineCount||0)}</span>`).join('');
      box.innerHTML=`<div class="main-app-consensus-head"><b>مقارنة المحركات</b><span class="main-app-consensus-session">MAIN ${esc(shortDate(c.sessionDate))}</span></div><div class="main-app-consensus-engines">${engineChips}</div><div class="main-app-consensus-basket">${basket}</div>`;
    }
    const truth=document.querySelector('#v169BasketPanel .v169-session-truth');
    if(truth&&box.previousElementSibling!==truth)truth.insertAdjacentElement('afterend',box);
  }

  function performanceRowHtml(row){
    const comparable=row?.evidenceComparable===true;
    const related=row?.status==='SAME_UNDERLYING_METHOD';
    const cls=comparable?'comparable':related?'related':'pending';
    const target=comparable?fmtPct(row.targetRatePct):related?'مرجعي':'—';
    const stop=comparable?fmtPct(row.stopRatePct):related?'مرجعي':'—';
    const n=comparable?Number(row.executableCount||0):'—';
    const badge=comparable?`${Number(row.auditSessions||0)} جلسة`:related?'نفس V16.9':row?.blocked?'محجوب':'بانتظار عينة';
    const noEntry=comparable&&Number.isFinite(Number(row.noEntryPct))?` · No Entry ${fmtPct(row.noEntryPct)}`:'';
    const ambiguous=comparable&&Number(row.ambiguousCount||0)>0?` · مزدوج ${Number(row.ambiguousCount||0)}`:'';
    return `<div class="main-app-performance-row ${cls}"><div class="main-app-performance-name"><span>${esc(row.label)}</span><span>${esc(badge)}</span></div><div class="main-app-performance-metrics"><div class="main-app-performance-metric target"><b>${esc(target)}</b><small>هدف محافظ</small></div><div class="main-app-performance-metric stop"><b>${esc(stop)}</b><small>ضرب الوقف</small></div><div class="main-app-performance-metric"><b>${esc(n)}</b><small>قابل للتنفيذ</small></div></div><div class="main-app-performance-note">${esc(row.noteAr||row.evidenceStatus||'')}${esc(noEntry)}${esc(ambiguous)}</div></div>`;
  }

  function performanceSummary(){
    const p=state.performance;if(!p)return;
    let box=document.getElementById('mainAppEnginePerformance');
    if(!box){box=document.createElement('div');box.id='mainAppEnginePerformance';box.className='main-app-engine-performance';}
    const rows=Array.isArray(p.rows)?p.rows:[];
    const signature=JSON.stringify({generated:p.generatedAt,session:p.sessionDate,rows:rows.map(r=>[r.id,r.targetRatePct,r.stopRatePct,r.executableCount,r.status])});
    if(box.dataset.signature!==signature){
      box.dataset.signature=signature;
      const comparable=rows.filter(r=>r.evidenceComparable===true).length;
      box.innerHTML=`<div class="main-app-performance-head"><b>أداء المحركات — الهدف / الوقف</b><small>Diagnostic فقط · لا يغيّر الترتيب · ${comparable} قابل للمقارنة</small></div><div class="main-app-performance-grid">${rows.map(performanceRowHtml).join('')}</div><div class="main-app-performance-foot">المقياس الأساسي هو الهدف المحافظ ÷ الحالات القابلة للتنفيذ. إذا لمس الهدف والوقف في نفس Daily OHLC تُعامل الحالة كوقف ولا تُحسب هدفًا محافظًا.</div>`;
    }
    const consensus=document.getElementById('mainAppConsensusSummary');
    if(consensus&&consensus.nextElementSibling!==box)consensus.insertAdjacentElement('afterend',box);
  }

  function observe(){if(!state.observer)state.observer=new MutationObserver(schedule);if(document.body)state.observer.observe(document.body,{childList:true,subtree:true});}
  function apply(){
    if(!state.consensus||!state.snapshot)return;
    state.observer?.disconnect();
    try{summary();performanceSummary();decorate();}finally{observe();}
  }
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(apply,60);}

  async function refreshData(){
    if(state.loading)return;state.loading=true;
    try{
      const [consensus,snapshot,performance]=await Promise.all([getJson(consensusUrl()),getJson(snapshotUrl()),getJson(performanceUrl()).catch(error=>{console.warn('MAIN APP engine performance unavailable:',error.message||error);return null;})]);
      if(consensus.schemaVersion!=='20.1.0-method-independent-consensus-1')throw Error(`consensus schema mismatch: ${consensus.schemaVersion}`);
      if(performance&&performance.schemaVersion!=='16.9.2-engine-performance-comparison-1')throw Error(`performance schema mismatch: ${performance.schemaVersion}`);
      state.consensus=consensus;state.snapshot=snapshot;state.performance=performance;apply();
    }catch(error){console.warn('MAIN APP engine comparison unavailable:',error.message||error);}finally{state.loading=false;}
  }

  function init(){
    refreshData();
    clearInterval(state.refreshTimer);state.refreshTimer=setInterval(refreshData,60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshData();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
