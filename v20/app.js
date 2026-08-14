(() => {
  'use strict';

  const state = { current: null, sourceHealth: null, profiles: null, rrAudit: null, portfolioRisk: null, query: '', status: 'ALL' };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const num = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ar-EG', { maximumFractionDigits: digits }) : '—';
  const pct = value => Number.isFinite(Number(value)) ? `${num(value, 1)}%` : '—';
  const money = value => Number.isFinite(Number(value)) ? num(value, 4) : '—';
  const rr = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
  const statusAr = value => ({ACTIONABLE:'قابل للتنفيذ',WATCH:'مراقبة',WAIT:'انتظار',AVOID:'تجنب'}[value] || value || '—');
  const riskAr = value => ({NORMAL:'طبيعي',CAUTIOUS:'حذر',DEFENSIVE:'دفاعي',CASH_PRESERVATION:'حماية السيولة'}[value] || value || '—');
  const reasonAr = code => ({
    GLOBAL_EXECUTION_GATE_CLOSED:'بوابة التنفيذ العامة مغلقة',
    GLOBAL_EXECUTION_NOT_GRADE:'حالة المنصة ليست Execution Grade',
    MARKET_REGIME_NOT_VERIFIED:'نظام السوق الحالي غير متحقق',
    LEGACY_RR_REQUIRES_AUDIT:'R/R القديم يحتاج مراجعة',
    LEGACY_RR_REFERENCE_UNVERIFIED:'مرجع R/R القديم غير متحقق',
    CURRENT_PRICE_BELOW_ENTRY_RANGE:'السعر الحالي أقل من نطاق الدخول',
    LEGACY_RR_MATERIAL_MISMATCH_VS_CONSERVATIVE_ENTRY_HIGH_REFERENCE:'اختلاف جوهري بين R/R القديم والحساب المحافظ',
    LIQUIDITY_NOT_EXECUTION_ELIGIBLE:'السيولة غير مؤهلة للتنفيذ',
    SUPPORT_RESISTANCE_RESEARCH_ONLY:'الدعم والمقاومة للبحث فقط',
    SUPPORT_RESISTANCE_SESSION_MISMATCH:'جلسة الدعم والمقاومة غير متطابقة',
    CRITICAL_SOURCE_CONFLICT:'تعارض حرج بين المصادر',
    MISSING_CRITICAL_SYMBOL_EVIDENCE:'نقص دليل حرج للسهم',
    HIGH_LEGACY_OPPORTUNITY_SCORE:'درجة فرصة مرتفعة في الترتيب المرجعي',
    LIQUIDITY_GATE_ELIGIBLE:'مؤهل من بوابة السيولة',
    SUPPORT_RESISTANCE_SESSION_ALIGNED:'الدعم والمقاومة متزامنان مع الجلسة',
    INTERNAL_SUPPORT_RESISTANCE_EXECUTION_ELIGIBLE:'الدعم والمقاومة الداخليان مستوفيان لشروطهما',
    POSITIVE_TARGET1_NET_REWARD_AFTER_COSTS:'العائد الصافي للهدف الأول موجب بعد التكلفة'
  }[code] || code);

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function load() {
    try {
      const [current, sourceHealth, profiles, rrAudit, portfolioRisk] = await Promise.all([
        json('../data/v20/current.json'),
        json('../data/v20/source-health.json'),
        json('../data/v20/stock-profiles.json'),
        json('../data/v20/risk-reward-audit.json'),
        json('../data/v20/portfolio-risk.json')
      ]);
      Object.assign(state, { current, sourceHealth, profiles, rrAudit, portfolioRisk });
      renderHeader(); renderMetrics(); renderAudit(); renderOpportunities(); renderSourceHealth(); renderGovernance();
      $('loadingState').classList.add('hidden');
      $('opportunityTableWrap').classList.remove('hidden');
      $('mobileCards').classList.remove('hidden');
    } catch (error) {
      $('loadingState').classList.add('hidden');
      $('errorState').classList.remove('hidden');
      $('errorState').textContent = `تعذر تحميل بيانات V20: ${error.message}`;
    }
  }

  function renderHeader() {
    const c = state.current;
    $('sessionBadge').textContent = `جلسة ${c.sessionDate || '—'}`;
    const exec = c.executionStatus || 'BLOCKED';
    const badge = $('executionBadge');
    badge.textContent = exec === 'EXECUTION_GRADE' ? 'Execution Grade' : exec === 'RESEARCH_ONLY' ? 'بحث فقط' : 'محظور';
    badge.className = `status-pill ${exec === 'EXECUTION_GRADE' ? 'status-good' : exec === 'RESEARCH_ONLY' ? 'status-warn' : 'status-bad'}`;
    const open = exec === 'EXECUTION_GRADE';
    $('gateTitle').textContent = open ? 'بوابة التنفيذ مفتوحة وفق الضوابط الحالية' : exec === 'RESEARCH_ONLY' ? 'المنصة الآن في وضع البحث فقط — لا تنفيذ' : 'القرار التنفيذي محظور حاليًا';
    $('gateText').textContent = open
      ? 'لا يزال القرار للمساعدة والتحليل، ويجب الالتزام بقيود المحفظة وخطة المخاطر.'
      : `بوابة V17 النهائية لم تمنح Execution Grade. أي إشارات محلية لا تتجاوز هذه البوابة. الحالة: ${c.dataStatus?.status || '—'}.`;
    $('gateExposure').textContent = pct(c.portfolio?.recommendedExposurePct);
    $('gateCash').textContent = `النقد ${pct(c.portfolio?.cashPct)}`;
  }

  function renderMetrics() {
    const c = state.current;
    $('coverage').textContent = pct(c.dataStatus?.coveragePct);
    $('freshness').textContent = pct(c.dataStatus?.freshnessPct);
    $('criticalFields').textContent = pct(c.dataStatus?.criticalFieldsPct);
    $('riskState').textContent = riskAr(c.portfolio?.riskState);
  }

  function renderAudit() {
    const a = state.rrAudit;
    if (!a || !a.materialMismatchCount) return;
    const box = $('rrAuditBanner');
    box.classList.remove('hidden');
    box.innerHTML = `<strong>تنبيه مراجعة R/R:</strong> تم رصد ${esc(a.materialMismatchCount)} حالة اختلاف جوهري بين R/R القديم والحساب المحافظ المبني على حد الدخول الأعلى. الواجهة تستخدم <b>Net R/R بعد تكلفة التداول</b> كمقياس أساسي، ولا تفترض صيغة R/R القديمة.`;
  }

  function filteredRows() {
    const q = state.query.trim().toLowerCase();
    return (state.current?.opportunities || []).filter(row => {
      const matchesStatus = state.status === 'ALL' || row.status === state.status;
      const haystack = `${row.ticker || ''} ${row.nameAr || ''}`.toLowerCase();
      return matchesStatus && (!q || haystack.includes(q));
    });
  }

  function rrClass(value) { return Number(value) > 0 ? 'rr-positive' : Number(value) < 0 ? 'rr-negative' : ''; }

  function renderOpportunities() {
    const rows = filteredRows();
    const tbody = $('opportunityRows');
    const cards = $('mobileCards');
    tbody.innerHTML = '';
    cards.innerHTML = '';
    $('emptyState').classList.toggle('hidden', rows.length !== 0);
    $('opportunityTableWrap').classList.toggle('hidden', rows.length === 0);
    cards.classList.toggle('hidden', rows.length === 0);

    for (const row of rows) {
      const netRR = row.riskReward?.primaryTarget1NetRiskReward;
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `فتح تفاصيل ${row.ticker}`);
      tr.innerHTML = `<td>${esc(row.rank)}</td><td class="symbol-cell"><strong>${esc(row.ticker)}</strong><small>${esc(row.nameAr || '—')}</small></td><td><span class="state-tag state-${esc(row.status)}">${esc(statusAr(row.status))}</span></td><td>${money(row.price)}</td><td>${num(row.opportunityScore,1)}</td><td class="rr-primary ${rrClass(netRR)}">${rr(netRR)}</td><td>${pct(row.confidence?.dataConfidencePct)}</td><td>${money(row.tradePlan?.entryLow)}–${money(row.tradePlan?.entryHigh)}</td><td>${money(row.tradePlan?.stop)}</td><td>${money(row.tradePlan?.target1)}</td>`;
      tr.addEventListener('click', () => openProfile(row.ticker));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(row.ticker); } });
      tbody.appendChild(tr);

      const card = document.createElement('button');
      card.type = 'button'; card.className = 'mobile-card';
      card.innerHTML = `<div class="mobile-card-head"><div class="symbol-cell"><strong>${esc(row.ticker)}</strong><small>${esc(row.nameAr || '—')}</small></div><span class="state-tag state-${esc(row.status)}">${esc(statusAr(row.status))}</span></div><div class="mobile-card-grid"><div><span>السعر</span><strong>${money(row.price)}</strong></div><div><span>Net R/R T1</span><strong class="${rrClass(netRR)}">${rr(netRR)}</strong></div><div><span>الدخول</span><strong>${money(row.tradePlan?.entryLow)}–${money(row.tradePlan?.entryHigh)}</strong></div><div><span>وقف الخسارة</span><strong>${money(row.tradePlan?.stop)}</strong></div></div>`;
      card.addEventListener('click', () => openProfile(row.ticker));
      cards.appendChild(card);
    }
  }

  function renderSourceHealth() {
    const s = state.sourceHealth || {};
    const conflicts = Array.isArray(s.sourceConflicts) ? s.sourceConflicts.length : 0;
    const missing = Array.isArray(s.missingSymbols) ? s.missingSymbols.join('، ') : '—';
    $('sourceHealth').innerHTML = [
      ['الحالة', s.status], ['تزامن الجلسة', s.sessionAligned ? 'نعم' : 'لا'], ['Execution Grade', s.executionGrade ? 'نعم' : 'لا'],
      ['تعارضات حرجة', conflicts], ['رموز ناقصة', missing || 'لا يوجد'], ['آخر تحديث مصدر', s.lastSourceUpdate || '—']
    ].map(([label,value]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function renderGovernance() {
    const g = state.current?.governance || {};
    $('governance').innerHTML = [
      ['Champion', g.activeChampion || '—'], ['Challenger', g.challenger || '—'], ['حالة Challenger', g.challengerStatus || '—'],
      ['ترقية تلقائية', g.automaticPromotion ? 'مسموحة' : 'ممنوعة'], ['دليل مستقل حديث', g.challengerFreshIndependentEvidence ? 'متوفر' : 'غير متوفر']
    ].map(([label,value]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function openProfile(ticker) {
    const profile = (state.profiles?.profiles || []).find(p => p.ticker === ticker);
    if (!profile) return;
    $('stockDialogTicker').textContent = profile.ticker;
    $('stockDialogTitle').textContent = profile.nameAr || profile.nameEn || profile.ticker;
    const p = profile.tradePlan || {};
    const r = p.riskReward || {};
    const sr = profile.supportResistance || {};
    const strengths = (profile.whyThisStock?.strengths || []).map(x => `<li>${esc(reasonAr(x))}</li>`).join('') || '<li>لا توجد نقاط قوة موثقة حاليًا</li>';
    const blockers = (profile.whyThisStock?.blockers || []).map(x => `<li>${esc(reasonAr(x))}</li>`).join('') || '<li>لا توجد موانع مسجلة</li>';
    $('stockDialogBody').innerHTML = `
      <div class="dialog-grid">
        <div class="info-box"><span>الحالة</span><strong>${esc(statusAr(profile.status))}</strong></div>
        <div class="info-box"><span>السعر</span><strong>${money(profile.price)}</strong></div>
        <div class="info-box"><span>Net R/R الهدف 1</span><strong class="${rrClass(r.primaryTarget1NetRiskReward)}">${rr(r.primaryTarget1NetRiskReward)}</strong></div>
        <div class="info-box"><span>الدخول</span><strong>${money(p.entryLow)}–${money(p.entryHigh)}</strong></div>
        <div class="info-box"><span>وقف الخسارة</span><strong>${money(p.stop)}</strong></div>
        <div class="info-box"><span>الهدف 1 / 2</span><strong>${money(p.target1)} / ${money(p.target2)}</strong></div>
      </div>
      <section class="dialog-section"><h3>لماذا هذا السهم؟</h3><p class="muted">نقاط القوة</p><ul class="reason-list">${strengths}</ul><p class="muted">الموانع والتحفظات</p><ul class="reason-list">${blockers}</ul></section>
      <section class="dialog-section"><h3>الدعم والمقاومة</h3><div class="dialog-grid"><div class="info-box"><span>دعم 1</span><strong>${money(sr.support1)}</strong></div><div class="info-box"><span>دعم 2</span><strong>${money(sr.support2)}</strong></div><div class="info-box"><span>مقاومة 1</span><strong>${money(sr.resistance1)}</strong></div><div class="info-box"><span>مقاومة 2</span><strong>${money(sr.resistance2)}</strong></div><div class="info-box"><span>الثقة</span><strong>${Number(sr.confidence) <= 1 ? pct(Number(sr.confidence)*100) : pct(sr.confidence)}</strong></div><div class="info-box"><span>تزامن الجلسة</span><strong>${sr.sessionAligned ? 'نعم' : 'لا'}</strong></div></div></section>
      <section class="dialog-section"><h3>الثقة — أبعاد منفصلة</h3><div class="dialog-grid"><div class="info-box"><span>السوق</span><strong>${pct(profile.confidence?.marketConfidencePct)}</strong></div><div class="info-box"><span>البيانات</span><strong>${pct(profile.confidence?.dataConfidencePct)}</strong></div><div class="info-box"><span>النموذج</span><strong>${pct(profile.confidence?.modelConfidencePct)}</strong></div><div class="info-box"><span>التنفيذ</span><strong>${pct(profile.confidence?.executionConfidencePct)}</strong></div></div></section>
      <section class="dialog-section"><h3>مراجعة R/R</h3><div class="detail-list"><div class="detail-row"><span>المقياس الأساسي</span><strong>Net R/R بعد التكلفة</strong></div><div class="detail-row"><span>Gross R/R المحافظ</span><strong>${rr(r.target1GrossRiskReward)}</strong></div><div class="detail-row"><span>Legacy R/R — للمراجعة فقط</span><strong>${rr(r.legacyRiskReward)}</strong></div><div class="detail-row"><span>مرجع Legacy</span><strong>${esc(r.legacyReference || '—')}</strong></div></div></section>
      <section class="dialog-section"><h3>المؤشرات الفنية</h3><p class="muted">لم يتم اختلاق RSI/MACD/ATR من لقطة جلسة واحدة. الحالة: ${esc(profile.technicalAnalysis?.status || '—')}.</p></section>
      <section class="dialog-section"><h3>المصدر والحداثة</h3><div class="detail-list"><div class="detail-row"><span>المصدر</span><strong>${esc(profile.provenance?.source || '—')}</strong></div><div class="detail-row"><span>وقت المصدر</span><strong>${esc(profile.provenance?.sourceTimestamp || '—')}</strong></div><div class="detail-row"><span>الجلسة متطابقة</span><strong>${profile.provenance?.sessionAligned ? 'نعم' : 'لا'}</strong></div></div></section>`;
    const dialog = $('stockDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
  }

  $('searchInput').addEventListener('input', e => { state.query = e.target.value; renderOpportunities(); });
  $('statusFilter').addEventListener('change', e => { state.status = e.target.value; renderOpportunities(); });
  $('closeDialog').addEventListener('click', () => $('stockDialog').close());
  $('stockDialog').addEventListener('click', e => { if (e.target === $('stockDialog')) $('stockDialog').close(); });

  load();
})();
