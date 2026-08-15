(() => {
  'use strict';
  if (window.__V20_DECISION_BOARD__) return;
  window.__V20_DECISION_BOARD__ = true;

  const state = { contract:null, core:null, native:null, freeze:null, nav:null, perf:null, governance:null, sync:null, query:'', finalState:'ALL', nativeFilter:'ALL', v17Filter:'ALL' };
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const num = (v,d=2) => finite(v) ? Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d}) : '—';
  const pct = v => finite(v) ? `${num(v,1)}%` : '—';
  const yesNo = v => v === true ? '<span class="decision-yes">نعم</span>' : v === false ? '<span class="decision-no">لا</span>' : '<span class="decision-unknown">غير متاح</span>';
  const stateAr = v => ({ACTIONABLE:'قابل للتنفيذ',WAIT_FOR_ENTRY:'انتظار الدخول',DO_NOT_CHASE:'لا تطارد السعر',HIGH_QUALITY_RESEARCH:'بحث عالي الجودة',RESEARCH_ONLY:'بحث فقط',BLOCKED:'محظور',WATCHLIST:'قائمة مراقبة'}[v] || v || '—');
  const tierAr = v => ({RESEARCH_A:'بحث A',RESEARCH_B:'بحث B',RESEARCH_C:'بحث C',RESEARCH_D:'بحث D'}[v] || v || '—');
  const priceAr = v => ({IN_ENTRY_RANGE:'داخل نطاق الدخول',BELOW_ENTRY_RANGE:'أسفل نطاق الدخول',BELOW_ENTRY_RANGE_WAITING:'أسفل النطاق — انتظار',ABOVE_ENTRY_RANGE_DO_NOT_CHASE:'أعلى النطاق — لا تطارد'}[v] || v || '—');
  const blockerAr = code => ({
    STALE_DATA:'بيانات غير حديثة',MISSING_CRITICAL_FIELDS:'حقول حرجة ناقصة',SESSION_NOT_ALIGNED:'الجلسة غير متزامنة',LOW_LIQUIDITY:'السيولة لا تجتاز V17',
    TECHNICAL_SOURCE_NOT_CURRENT:'المصدر الفني غير حالي',INSUFFICIENT_TECHNICAL_HISTORY:'التاريخ الفني غير كافٍ وفق V17',MISSING_SR:'دعم/مقاومة غير متاح',SR_LOW_CONFIDENCE:'ثقة S/R أقل من المطلوب',SR_NOT_EXECUTION_ELIGIBLE:'S/R غير مؤهل للتنفيذ',CRITICAL_SOURCE_CONFLICT:'تعارض مصدر حرج',PRICE_UNTRUSTED:'السعر غير مؤهل',V17_RECOMMENDATION_FILTER:'خارج مرشحي V17 الحاليين',V17_SR_GLOBAL_EXECUTION_NOT_READY:'منظومة S/R العامة غير جاهزة للتنفيذ',EXECUTION_GATE_CLOSED:'بوابة V17 العامة مغلقة',CORPORATE_ACTION_STATUS_UNAVAILABLE:'حالة Corporate Action غير متاحة — Fail Closed',NET_RR_TOO_LOW:'Net R/R أقل من الحد',DO_NOT_CHASE:'لا تطارد السعر',PRICE_OUTSIDE_ENTRY_RANGE:'السعر خارج نطاق الدخول'}[code] || code);
  const nextAr = value => ({
    FOLLOW_APPROVED_PRODUCTION_POLICY_AND_PORTFOLIO_GUARDS:'اتبع سياسة التنفيذ وحواجز المحفظة المعتمدة.',
    'WAIT_FOR_PRICE_TO_REENTER_ISSUED_ENTRY_RANGE;_DO_NOT_MOVE_ENTRY_RANGE_UP':'انتظر عودة السعر إلى نطاق الدخول؛ لا ترفع النطاق لمطاردة السعر.',
    WAIT_FOR_PRICE_TO_ENTER_ISSUED_ENTRY_RANGE:'انتظر دخول السعر إلى نطاق الدخول.',
    V17_GLOBAL_EXECUTION_GATE_MUST_OPEN_AFTER_ALL_QUALITY_GATES_PASS:'يجب أن تفتح بوابة V17 بعد اجتياز كل بوابات الجودة.',
    RESOLVE_CRITICAL_SOURCE_CONFLICT:'يلزم حل تعارض المصدر الحرج.',RESTORE_V17_SR_READINESS:'يلزم استعادة جاهزية V17 للدعم والمقاومة.',PASS_V17_LIQUIDITY_ELIGIBILITY:'يلزم اجتياز أهلية السيولة في V17.',COMPLETE_TRUSTED_TECHNICAL_HISTORY_REQUIREMENT:'يلزم اكتمال متطلب التاريخ الفني الموثوق في V17.',AUTHORITATIVE_CORPORATE_ACTION_SAFETY_EVIDENCE_REQUIRED_FOR_EXECUTION:'يلزم مصدر موثوق لحالة Corporate Action قبل التنفيذ.',SATISFY_V17_PRODUCTION_ELIGIBILITY:'يلزم استيفاء أهلية V17 الإنتاجية.',CONTINUE_MONITORING:'استمرار المراقبة.'
  }[value] || value || 'استمرار المراقبة.');

  async function json(url, optional=false) {
    try { const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch(e){ if(optional) return null; throw new Error(`${url}: ${e.message}`); }
  }

  function mount() {
    const main=document.querySelector('main'); if(!main || document.getElementById('decisionBoardPanel')) return;
    const panel=document.createElement('section'); panel.id='decisionBoardPanel'; panel.className='panel decision-board-panel'; panel.dataset.primaryDecisionBoard='true';
    panel.innerHTML=`
      <div class="decision-board-head"><div><span class="eyebrow">مسار القرار المعتمد</span><h2>Decision Board — V17-Centric</h2><p>V20 Native يكتشف الفرص من السوق الكامل، لكن V17 وحده يحدد الأهلية الإنتاجية. القرار النهائي يجمع تحقق V17، البوابة العامة، وخطة السعر في حالة واحدة قابلة للتفسير.</p></div><span class="decision-primary-badge">الواجهة الأساسية للقرار</span></div>
      <div id="decisionPipeline" class="decision-pipeline" aria-label="سلسلة القرار"></div>
      <div class="decision-board-notice"><b>قاعدة حاكمة:</b><span>Native Score درجة بحثية وليست Confidence ولا Execution Permission. إغلاق V17 Global Gate يعني صفر ACTIONABLE وصفر تعرض إنتاجي جديد.</span></div>
      <div class="decision-filters" role="search">
        <label>بحث<input id="decisionSearch" type="search" placeholder="الكود أو اسم الشركة…" autocomplete="off"></label>
        <label>القرار النهائي<select id="decisionStateFilter"><option value="ALL">كل الحالات</option><option value="ACTIONABLE">قابل للتنفيذ</option><option value="WAIT_FOR_ENTRY">انتظار الدخول</option><option value="DO_NOT_CHASE">لا تطارد السعر</option><option value="HIGH_QUALITY_RESEARCH">بحث عالي الجودة</option><option value="RESEARCH_ONLY">بحث فقط</option><option value="BLOCKED">محظور</option><option value="WATCHLIST">قائمة مراقبة</option></select></label>
        <label>اكتشاف Native<select id="decisionNativeFilter"><option value="ALL">الكل</option><option value="YES">اكتشفه Native</option><option value="NO">خارج Top 30 Native</option></select></label>
        <label>أهلية توصية V17<select id="decisionV17Filter"><option value="ALL">الكل</option><option value="YES">مؤهل</option><option value="NO">غير مؤهل</option></select></label>
      </div>
      <div id="decisionError" class="decision-board-error" hidden></div>
      <div id="decisionContent" hidden><div class="decision-resultbar"><strong id="decisionCount">—</strong><span>اضغط على أي سهم لفتح Stock Dossier الكامل.</span></div><div class="decision-table-wrap"><table class="decision-table"><thead><tr><th>Native</th><th>السهم</th><th>Native Score</th><th>V17 Data</th><th>V17 Liquidity</th><th>V17 Technical</th><th>V17 S/R</th><th>Global Gate</th><th>خطة السعر</th><th>القرار النهائي</th></tr></thead><tbody id="decisionRows"></tbody></table></div><div id="decisionCards" class="decision-mobile"></div></div>`;
    const anchor=document.getElementById('marketRegimePanel') || document.querySelector('.opportunities-panel') || main.firstElementChild;
    if(anchor) main.insertBefore(panel,anchor); else main.prepend(panel);
    document.querySelector('.opportunities-panel')?.classList.add('legacy-secondary-panel');
    const dialog=document.createElement('dialog'); dialog.id='decisionDossier'; dialog.className='decision-dossier'; dialog.innerHTML='<div class="decision-dossier-shell" id="decisionDossierBody"></div>'; document.body.appendChild(dialog);
    dialog.addEventListener('click',e=>{if(e.target===dialog) dialog.close();});
  }

  function coreMap(){ return new Map((state.core?.rows||[]).map(r=>[String(r.ticker||'').toUpperCase(),r])); }
  function sortedRows(){
    const q=state.query.trim().toLowerCase();
    return (state.contract?.rows||[]).filter(r=>{
      const symbol=String(r.identity?.symbol||''); const name=String(r.identity?.companyName||''); const discovered=r.v20Native?.discovered===true; const eligible=r.v17?.recommendationEligible===true; const final=r.governance?.finalDecisionState;
      if(q && !`${symbol} ${name}`.toLowerCase().includes(q)) return false;
      if(state.finalState!=='ALL' && final!==state.finalState) return false;
      if(state.nativeFilter==='YES'&&!discovered) return false; if(state.nativeFilter==='NO'&&discovered) return false;
      if(state.v17Filter==='YES'&&!eligible) return false; if(state.v17Filter==='NO'&&eligible) return false;
      return true;
    }).sort((a,b)=>{
      const ar=a.v20Native?.discoveryRank, br=b.v20Native?.discoveryRank;
      if(finite(ar)&&finite(br)) return Number(ar)-Number(br); if(finite(ar)) return -1; if(finite(br)) return 1;
      return String(a.identity?.symbol||'').localeCompare(String(b.identity?.symbol||''));
    });
  }

  function renderPipeline(){
    const c=state.contract, core=state.core, native=state.native; if(!c||!core||!native)return;
    const globalOpen=c.sessionStatus==='EXECUTION_GRADE';
    document.getElementById('decisionPipeline').innerHTML=`
      <article class="decision-stage"><span>1 · V20 Native Discovery</span><strong>${num(native.publishedCandidates?.length,0)}</strong><small>Top 30 بحثية · Legacy contribution 0%</small></article>
      <article class="decision-stage ${core.summary?.recommendationEligibleCount?'is-open':'is-research'}"><span>2 · V17 Per-stock Eligibility</span><strong>${num(core.summary?.recommendationEligibleCount,0)}</strong><small>المؤهلون كتوصية وفق V17 الحالية</small></article>
      <article class="decision-stage ${globalOpen?'is-open':'is-closed'}"><span>3 · V17 Global Gate</span><strong>${globalOpen?'مفتوحة':'مغلقة'}</strong><small>${esc(c.sessionStatus||'—')} · Execution Grade ${globalOpen?'Yes':'No'}</small></article>
      <article class="decision-stage ${c.summary?.productionActionableCount?'is-open':'is-research'}"><span>4 · Final Canonical Decision</span><strong>${num(c.summary?.productionActionableCount,0)} ACTIONABLE</strong><small>تعرض جديد ${pct(c.summary?.productionNewExposurePct)}</small></article>`;
  }

  function finalPill(v){return `<span class="decision-state-pill decision-state-${esc(v)}" data-state="${esc(v)}">${esc(stateAr(v))}</span>`;}
  function render(){
    const rows=sortedRows(), cm=coreMap(), gateOpen=state.contract?.sessionStatus==='EXECUTION_GRADE';
    document.getElementById('decisionCount').textContent=`${rows.length.toLocaleString('ar-EG')} من ${(state.contract?.rows||[]).length.toLocaleString('ar-EG')} سهم`;
    document.getElementById('decisionRows').innerHTML=rows.map(r=>{const symbol=r.identity?.symbol, cr=cm.get(symbol), discovered=r.v20Native?.discovered===true; return `<tr data-symbol="${esc(symbol)}"><td>${discovered?`#${num(r.v20Native.discoveryRank,0)}`:'—'}</td><td><div class="decision-symbol"><b>${esc(symbol)}</b><small>${esc(r.identity?.companyName||'')}</small></div></td><td><span class="decision-score">${discovered?num(r.v20Native.nativeScore,1):'—'}</span></td><td>${yesNo(r.v17?.dataEligible)}</td><td>${yesNo(r.v17?.liquidityEligible)}</td><td>${yesNo(cr?.v17TechnicalProductionReady)}</td><td>${yesNo(cr?.v17SrProductionReady)}</td><td>${gateOpen?'<span class="decision-yes">مفتوحة</span>':'<span class="decision-no">مغلقة</span>'}</td><td>${esc(priceAr(r.tradePlan?.priceState))}</td><td>${finalPill(r.governance?.finalDecisionState)}</td></tr>`;}).join('');
    document.getElementById('decisionCards').innerHTML=rows.map(r=>{const symbol=r.identity?.symbol, cr=cm.get(symbol); return `<article class="decision-card" data-symbol="${esc(symbol)}"><div class="decision-card-top"><div><h3>${esc(symbol)} ${finite(r.v20Native?.discoveryRank)?`· Native #${num(r.v20Native.discoveryRank,0)}`:''}</h3><div class="decision-card-name">${esc(r.identity?.companyName||'')}</div></div>${finalPill(r.governance?.finalDecisionState)}</div><div class="decision-card-grid"><div><span>Native Score</span><strong>${num(r.v20Native?.nativeScore,1)}</strong></div><div><span>V17 Recommendation</span><strong>${r.v17?.recommendationEligible?'مؤهل':'غير مؤهل'}</strong></div><div><span>Technical Production</span><strong>${cr?.v17TechnicalProductionReady?'جاهز':'غير جاهز'}</strong></div><div><span>خطة السعر</span><strong>${esc(priceAr(r.tradePlan?.priceState))}</strong></div></div></article>`;}).join('');
    document.querySelectorAll('#decisionRows tr[data-symbol],#decisionCards [data-symbol]').forEach(el=>el.addEventListener('click',()=>openDossier(el.dataset.symbol)));
  }

  function blockerHtml(list){const a=[...new Set(list||[])];return a.length?a.map(x=>`<span class="decision-blocker">${esc(blockerAr(x))}</span>`).join(''):'<span class="decision-mini-pill">لا توجد blockers مسجلة</span>';}
  function kv(label,value){return `<span>${esc(label)}</span><strong>${value}</strong>`;}
  function openDossier(symbol){
    const r=(state.contract?.rows||[]).find(x=>x.identity?.symbol===symbol); const cr=(state.core?.rows||[]).find(x=>x.ticker===symbol); if(!r||!cr)return;
    const d=document.getElementById('decisionDossier'), body=document.getElementById('decisionDossierBody'); const final=r.governance?.finalDecisionState;
    const corp=cr.v17CorporateActionSafe===true?'آمن':cr.v17CorporateActionSafe===false?'غير آمن':'Unknown — Fail Closed';
    body.innerHTML=`<div class="decision-dossier-head"><div><span class="eyebrow">Stock Dossier · جلسة ${esc(r.identity?.marketSessionDate||'—')}</span><h2>${esc(symbol)} — ${esc(r.identity?.companyName||'')}</h2><p>قرار واحد يجمع Discovery وV17 Eligibility والبوابة العامة وخطة التداول.</p></div><button class="decision-dossier-close" type="button" aria-label="إغلاق">×</button></div>
      <div class="decision-dossier-verdict"><div class="decision-verdict-card"><span class="eyebrow">القرار النهائي</span><strong class="decision-state-${esc(final)}">${esc(stateAr(final))}</strong><p>${esc(nextAr(r.explainability?.nextRequiredCondition))}</p></div><div class="decision-provenance-card"><span class="eyebrow">Provenance</span><p>V17 SHA: <b>${esc((state.sync?.source?.commitSha||state.contract?.sourceV17Commit||'—').slice(0,12))}</b><br>Native: <b>${esc(state.native?.engineId||'—')} / ${esc(state.native?.modelVersion||'—')}</b><br>Freeze: <b>${esc(state.freeze?.freezeId||r.governance?.nativeFreezeId||'—')}</b></p></div></div>
      <div class="decision-dossier-grid">
        <section class="decision-dossier-section"><h3>V20 Native — Discovery فقط</h3><div class="decision-kv">${kv('تم اكتشافه',yesNo(r.v20Native?.discovered))}${kv('Native Rank',finite(r.v20Native?.discoveryRank)?`#${num(r.v20Native.discoveryRank,0)}`:'—')}${kv('Native Score',num(r.v20Native?.nativeScore,1))}${kv('Tier',esc(tierAr(r.v20Native?.tier)))}${kv('Legacy scoring','0%')}${kv('Execution Permission','<span class="decision-no">لا</span>')}</div><div class="decision-no-confidence"><b>Native Score ≠ Confidence.</b> Model Confidence غير معايرة وتظل null؛ لا يجوز استنتاج احتمال نجاح من الدرجة.</div></section>
        <section class="decision-dossier-section"><h3>V17 — أهلية السهم</h3><div class="decision-kv">${kv('Data Eligible',yesNo(cr.v17DataEligible))}${kv('Liquidity Eligible',yesNo(cr.v17LiquidityEligible))}${kv('Technical Source Eligible',yesNo(cr.v17TechnicalSourceEligible))}${kv('Technical Production Ready',yesNo(cr.v17TechnicalProductionReady))}${kv('S/R Source Eligible',yesNo(cr.v17SrSourceEligible))}${kv('S/R Production Ready',yesNo(cr.v17SrProductionReady))}${kv('Price Eligible',yesNo(cr.v17PriceEligible))}${kv('Corporate Action',`<span class="${cr.v17CorporateActionSafe===true?'decision-yes':'decision-unknown'}">${esc(corp)}</span>`)}${kv('Recommendation Eligible',yesNo(cr.v17RecommendationEligible))}${kv('Execution Eligible',yesNo(cr.v17ExecutionEligible))}</div></section>
        <section class="decision-dossier-section"><h3>Global Gate + Blockers</h3><div class="decision-kv">${kv('V17 Gate',esc(state.contract?.sessionStatus||'—'))}${kv('Execution Grade',yesNo(state.contract?.sessionStatus==='EXECUTION_GRADE'))}${kv('S/R Global Ready',yesNo(cr.v17SrGlobalExecutionReady))}${kv('Session aligned',yesNo(r.dataTruth?.sessionAligned))}</div><div class="decision-blockers" style="margin-top:10px">${blockerHtml(r.v17?.blockers)}</div></section>
        <section class="decision-dossier-section"><h3>Trade Plan — بدون مطاردة</h3><div class="decision-kv">${kv('Current Price',num(r.tradePlan?.currentPrice,4))}${kv('Entry',`${num(r.tradePlan?.entryLow,4)} – ${num(r.tradePlan?.entryHigh,4)}`)}${kv('Stop',num(r.tradePlan?.stop,4))}${kv('Target 1',num(r.tradePlan?.target1,4))}${kv('Net R/R',finite(r.tradePlan?.netRR)?Number(r.tradePlan.netRR).toFixed(2):'—')}${kv('Costs',pct(r.tradePlan?.transactionCostsPct))}${kv('Price State',esc(priceAr(r.tradePlan?.priceState)))}${kv('Chase State',esc(r.tradePlan?.chaseState||'—'))}</div></section>
      </div>
      <div class="decision-evidence-strip"><div class="decision-evidence-box"><span>Technical evidence</span><strong>${num(cr.evidence?.technicalHistorySessions,0)} جلسة</strong><small>الحد الدلالي في V17 قبل زوال «تاريخ غير كافٍ»: ${num(cr.evidence?.technicalMinimumSessionsBeforeHistoryIsNotInsufficient,0)}</small></div><div class="decision-evidence-box"><span>S/R evidence</span><strong>${num(cr.evidence?.srConfidence,2)}</strong><small>${esc(cr.evidence?.srFreshness||'—')} · ${esc(cr.evidence?.srMethodology||'—')}</small></div><div class="decision-evidence-box"><span>Model freeze / ranking</span><strong>${esc((state.native?.rankingDigest||'—').slice(0,12))}</strong><small>${esc(state.native?.rankingContract||'—')} · V1 لا يُعاد ضبطها بأثر رجعي</small></div></div>`;
    body.querySelector('.decision-dossier-close').addEventListener('click',()=>d.close());
    if(typeof d.showModal==='function')d.showModal(); else d.setAttribute('open','');
  }

  function evidenceStrip(){
    const board=document.getElementById('decisionBoardPanel'); if(!board)return; const nav=state.nav, fwd=(state.perf?.entries||[]).find(x=>x.evidenceId==='V20_NATIVE_V1_FRESH_FORWARD')||null; const gov=state.governance;
    const strip=document.createElement('div'); strip.className='decision-evidence-strip'; strip.dataset.decisionEvidenceStrip='true'; strip.innerHTML=`<div class="decision-evidence-box"><span>Funded NAV</span><strong>${nav?`${num(nav.current?.endingEquity??nav.summary?.endingEquity??nav.latest?.endingEquity,2)} Equity`:'Pending'}</strong><small>${nav?`Cash ${pct(nav.current?.cashPct??nav.summary?.cashPct??nav.latest?.cashPct)} · Exposure ${pct(nav.current?.grossExposurePct??nav.summary?.grossExposurePct??nav.latest?.grossExposurePct)}`:'لا توجد نتائج ممولة قابلة للعرض بعد.'}</small></div><div class="decision-evidence-box"><span>Native Fresh Forward</span><strong>${num(fwd?.forwardState?.independentForwardSessionCount??state.perf?.summary?.nativeIndependentForwardSessions,0)} جلسة مستقلة</strong><small>${esc(state.perf?.summary?.nativeFreshForwardStatus||'Baseline / Pending')} · Baseline لا يُحسب Fresh Evidence.</small></div><div class="decision-evidence-box"><span>Champion / Challenger</span><strong>${esc(gov?.activeChampion||'V16_9_EQUAL_WEIGHT_BASKET')}</strong><small>V20 Native: ${esc(gov?.models?.find?.(m=>m.modelId==='V20_FULL_MARKET_NATIVE_SELECTION')?.governanceState||gov?.native?.governanceState||'CHALLENGER_SHADOW')} · Auto-promotion disabled.</small></div>`; board.appendChild(strip);
  }

  function bind(){
    const q=document.getElementById('decisionSearch'), sf=document.getElementById('decisionStateFilter'), nf=document.getElementById('decisionNativeFilter'), vf=document.getElementById('decisionV17Filter');
    q.addEventListener('input',()=>{state.query=q.value;render();}); sf.addEventListener('change',()=>{state.finalState=sf.value;render();}); nf.addEventListener('change',()=>{state.nativeFilter=nf.value;render();}); vf.addEventListener('change',()=>{state.v17Filter=vf.value;render();});
  }

  async function init(){
    mount(); bind();
    try{
      const [contract,core,native,freeze,nav,perf,governance,sync]=await Promise.all([
        json('../data/v20/final-decision-contract.json'),json('../data/v20/v17-production-decision-core.json'),json('../data/v20/native-current.json'),json('../data/v20/native-model-freeze.json',true),json('../data/v20/funded-nav.json',true),json('../data/v20/performance-evidence-registry.json',true),json('../data/v20/champion-challenger-registry.json',true),json('../data/v20/v17-runtime-sync.json',true)
      ]);
      Object.assign(state,{contract,core,native,freeze,nav,perf,governance,sync});
      if(contract.architecture!=='V17_CENTRIC_V20_NATIVE_DISCOVERY')throw new Error('Canonical architecture mismatch');
      if(core.policy?.v17IsAuthoritativeForProductionEligibility!==true)throw new Error('V17 authority contract missing');
      if(native.executionPermission!==false||native.legacyScoringContributionPct!==0)throw new Error('Native governance drift');
      renderPipeline(); render(); evidenceStrip(); document.getElementById('decisionContent').hidden=false;
      if(contract.sessionStatus!=='EXECUTION_GRADE' && (contract.rows||[]).some(r=>r.governance?.finalDecisionState==='ACTIONABLE'))throw new Error('Closed gate exposes ACTIONABLE row');
      document.dispatchEvent(new CustomEvent('v20:decision-board-ready',{detail:{rows:contract.rows?.length||0,actionable:contract.summary?.productionActionableCount||0}}));
    }catch(e){const box=document.getElementById('decisionError');box.hidden=false;box.textContent=`تعذر تحميل Canonical Decision Board: ${e.message}`;}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
