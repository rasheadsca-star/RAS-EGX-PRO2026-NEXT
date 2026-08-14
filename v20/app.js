(() => {
  'use strict';

  const state = {
    current: null, sourceHealth: null, profiles: null, rrAudit: null, portfolioRisk: null, marketExplorer: null,
    query: '', status: 'ALL',
    marketQuery: '', marketAvailability: 'ALL', marketLiquidity: 'ALL', marketTechnical: 'ALL',
    marketSort: 'TURNOVER_DESC', marketPage: 1, marketPageSize: 25
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const num = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ar-EG', { maximumFractionDigits: digits }) : '—';
  const pct = value => Number.isFinite(Number(value)) ? `${num(value, 1)}%` : '—';
  const money = value => Number.isFinite(Number(value)) ? num(value, 4) : '—';
  const rr = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
  const statusAr = value => ({ACTIONABLE:'قابل للتنفيذ',WATCH:'مراقبة',WAIT:'انتظار',AVOID:'تجنب'}[value] || value || '—');
  const riskAr = value => ({NORMAL:'طبيعي',CAUTIOUS:'حذر',DEFENSIVE:'دفاعي',CASH_PRESERVATION:'حماية السيولة'}[value] || value || '—');
  const technicalAr = value => ({
    CURRENT_READY:'فني حالي موثوق',
    HISTORICAL_CONTEXT_ONLY:'سياق تاريخي فقط',
    INSUFFICIENT_TRUSTED_HISTORY:'تاريخ موثوق غير كافٍ',
    UNAVAILABLE:'غير متاح',
    NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE:'لم يُقيّم فنيًا في النطاق الحالي',
    CURRENT_POINT_IN_TIME_READY:'فني حالي موثوق'
  }[value] || value || '—');
  const reasonAr = code => ({
    GLOBAL_EXECUTION_GATE_CLOSED:'بوابة التنفيذ العامة مغلقة',
    GLOBAL_EXECUTION_NOT_GRADE:'حالة المنصة ليست Execution Grade',
    MARKET_REGIME_NOT_VERIFIED:'نظام السوق الحالي غير متحقق',
    LEGACY_RR_REQUIRES_AUDIT:'R/R القديم يحتاج مراجعة',
    LEGACY_RR_REFERENCE_UNVERIFIED:'مرجع R/R القديم غير متحقق',
    CURRENT_PRICE_BELOW_ENTRY_RANGE:'السعر الحالي أقل من نطاق الدخول',
    CURRENT_PRICE_ABOVE_ENTRY_RANGE:'السعر الحالي أعلى من نطاق الدخول — لا تطارد السعر',
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
    POSITIVE_TARGET1_NET_REWARD_AFTER_COSTS:'العائد الصافي للهدف الأول موجب بعد التكلفة',
    CURRENT_TRUSTED_TECHNICAL_TREND_BULLISH:'الاتجاه الفني الحالي الموثوق صاعد',
    CURRENT_RSI_IN_BALANCED_MOMENTUM_RANGE:'RSI الحالي في نطاق زخم متوازن',
    HISTORY_LAST_SESSION_NOT_ALIGNED_WITH_CURRENT_SESSION:'آخر جلسة للتاريخ الفني غير متزامنة مع جلسة القرار',
    LATEST_HISTORY_CLOSE_NOT_RECONCILED_WITH_CURRENT_MARKET_PRICE:'آخر إغلاق تاريخي غير متوافق مع سعر السوق الحالي',
    INSUFFICIENT_ROWS_FOR_SMA50:'عدد الجلسات غير كافٍ لـ SMA50',
    INSUFFICIENT_ROWS_FOR_MACD_SIGNAL:'عدد الجلسات غير كافٍ لإشارة MACD',
    TRUSTED_TECHNICAL_HISTORY_UNAVAILABLE:'تاريخ OHLC الموثوق غير متاح'
  }[code] || code);

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function load() {
    try {
      const [current, sourceHealth, profiles, rrAudit, portfolioRisk, marketExplorer] = await Promise.all([
        json('../data/v20/current.json'),
        json('../data/v20/source-health.json'),
        json('../data/v20/stock-profiles.json'),
        json('../data/v20/risk-reward-audit.json'),
        json('../data/v20/portfolio-risk.json'),
        json('../data/v20/market-explorer.json')
      ]);
      Object.assign(state, { current, sourceHealth, profiles, rrAudit, portfolioRisk, marketExplorer });
      renderHeader(); renderMetrics(); renderAudit(); renderOpportunities(); renderMarketSummary(); renderMarketExplorer(); renderSourceHealth(); renderGovernance();
      $('loadingState').classList.add('hidden');
      $('opportunityTableWrap').classList.remove('hidden');
      $('mobileCards').classList.remove('hidden');
      $('marketLoadingState').classList.add('hidden');
      $('marketExplorerContent').classList.remove('hidden');
    } catch (error) {
      $('loadingState').classList.add('hidden');
      $('marketLoadingState').classList.add('hidden');
      $('errorState').classList.remove('hidden');
      $('errorState').textContent = `تعذر تحميل بيانات V20: ${error.message}`;
      $('marketErrorState').classList.remove('hidden');
      $('marketErrorState').textContent = `تعذر تحميل Market Explorer: ${error.message}`;
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
    const q = state.query.trim().toLocaleLowerCase('ar');
    return (state.current?.opportunities || []).filter(row => {
      const matchesStatus = state.status === 'ALL' || row.status === state.status;
      const haystack = `${row.ticker || ''} ${row.nameAr || ''}`.toLocaleLowerCase('ar');
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

  function renderMarketSummary() {
    const s = state.marketExplorer?.summary || {};
    $('marketUniverseCount').textContent = num(s.universeCount, 0);
    $('marketCurrentCount').textContent = `${num(s.currentSnapshotCount, 0)} / ${num(s.universeCount, 0)}`;
    $('marketCurrentCoverage').textContent = pct(s.currentSessionCoveragePct);
    $('marketTechnicalCurrent').textContent = `${num(s.currentTechnicalReadyCount, 0)} حالي`;
    $('marketTechnicalCoverage').textContent = `${pct(s.technicalCurrentCoverageOfOpportunityUniversePct)} من نطاق الفرص`;
  }

  function marketFilteredRows() {
    const q = state.marketQuery.trim().toLocaleLowerCase('ar');
    const rows = (state.marketExplorer?.rows || []).filter(row => {
      if (q && !String(row.searchText || '').includes(q)) return false;
      if (state.marketAvailability === 'CURRENT' && row.currentSessionAvailable !== true) return false;
      if (state.marketAvailability === 'NO_CURRENT_DATA' && row.currentSessionAvailable === true) return false;
      if (state.marketLiquidity === 'ELIGIBLE' && row.liquidityExecutionEligible !== true) return false;
      if (state.marketLiquidity === 'NOT_ELIGIBLE' && row.liquidityExecutionEligible === true) return false;
      if (state.marketTechnical !== 'ALL' && row.technical?.state !== state.marketTechnical) return false;
      return true;
    });
    const value = row => ({
      TURNOVER_DESC: Number(row.turnover ?? -Infinity), CHANGE_DESC: Number(row.changePct ?? -Infinity),
      CHANGE_ASC: Number(row.changePct ?? Infinity), TICKER_ASC: String(row.ticker || ''),
      DATA_QUALITY_DESC: Number(row.criticalFieldCompletenessPct ?? -Infinity)
    }[state.marketSort]);
    return rows.sort((a, b) => {
      if (state.marketSort === 'TICKER_ASC') return value(a).localeCompare(value(b), 'en');
      if (state.marketSort === 'CHANGE_ASC') return value(a) - value(b);
      return value(b) - value(a);
    });
  }

  function technicalTag(row) {
    const value = row.technical?.state;
    const klass = value === 'CURRENT_READY' ? 'tech-current' : value === 'HISTORICAL_CONTEXT_ONLY' ? 'tech-historical' : value === 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE' ? 'tech-not-evaluated' : 'tech-unavailable';
    return `<span class="technical-tag ${klass}">${esc(technicalAr(value))}</span>`;
  }

  function renderMarketExplorer() {
    const rows = marketFilteredRows();
    const pageCount = Math.max(1, Math.ceil(rows.length / state.marketPageSize));
    state.marketPage = Math.min(Math.max(1, state.marketPage), pageCount);
    const start = (state.marketPage - 1) * state.marketPageSize;
    const pageRows = rows.slice(start, start + state.marketPageSize);
    const tbody = $('marketRows');
    const cards = $('marketCards');
    tbody.innerHTML = ''; cards.innerHTML = '';
    $('marketEmptyState').classList.toggle('hidden', rows.length !== 0);
    $('marketTableWrap').classList.toggle('hidden', rows.length === 0);
    cards.classList.toggle('hidden', rows.length === 0);
    $('marketResultCount').textContent = `${num(rows.length, 0)} سهم`;
    $('marketPageInfo').textContent = `${state.marketPage} / ${pageCount}`;
    $('marketPrev').disabled = state.marketPage <= 1;
    $('marketNext').disabled = state.marketPage >= pageCount;
    for (const row of pageRows) {
      const changeClass = Number(row.changePct) > 0 ? 'change-up' : Number(row.changePct) < 0 ? 'change-down' : '';
      const scopeLabel = row.decision?.scope === 'CURRENT_OPPORTUNITY' ? `<span class="state-tag state-${esc(row.decision.status)}">${esc(statusAr(row.decision.status))}</span>` : '<span class="market-only-tag">سوق فقط</span>';
      const price = row.currentSessionAvailable ? money(row.price) : '<span class="muted">غير متاح</span>';
      const tr = document.createElement('tr');
      tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.setAttribute('aria-label', `فتح بيانات ${row.ticker}`);
      tr.innerHTML = `<td class="symbol-cell"><strong>${esc(row.ticker)}</strong><small>${esc(row.nameAr || row.nameEn || '—')}</small></td><td>${scopeLabel}</td><td>${price}</td><td class="${changeClass}">${row.currentSessionAvailable ? pct(row.changePct) : '—'}</td><td>${row.currentSessionAvailable ? num(row.turnover,0) : '—'}</td><td>${row.liquidityExecutionEligible ? 'مؤهل' : 'غير مؤهل'}</td><td>${technicalTag(row)}</td><td>${row.currentSessionAvailable ? pct(row.criticalFieldCompletenessPct) : '—'}</td><td>${row.currentSessionAvailable ? esc(row.sessionDate) : 'لا توجد بيانات جلسة حالية'}</td>`;
      tr.addEventListener('click', () => openMarketRow(row.ticker));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMarketRow(row.ticker); } });
      tbody.appendChild(tr);
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'mobile-card market-mobile-card';
      card.innerHTML = `<div class="mobile-card-head"><div class="symbol-cell"><strong>${esc(row.ticker)}</strong><small>${esc(row.nameAr || row.nameEn || '—')}</small></div>${scopeLabel}</div><div class="mobile-card-grid"><div><span>السعر</span><strong>${row.currentSessionAvailable ? money(row.price) : 'غير متاح'}</strong></div><div><span>التغير</span><strong class="${changeClass}">${row.currentSessionAvailable ? pct(row.changePct) : '—'}</strong></div><div><span>السيولة</span><strong>${row.liquidityExecutionEligible ? 'مؤهل' : 'غير مؤهل'}</strong></div><div><span>فني</span><strong>${esc(technicalAr(row.technical?.state))}</strong></div></div>`;
      card.addEventListener('click', () => openMarketRow(row.ticker)); cards.appendChild(card);
    }
  }

  function renderSourceHealth() {
    const s = state.sourceHealth || {};
    const conflicts = Array.isArray(s.sourceConflicts) ? s.sourceConflicts.length : 0;
    const missing = Array.isArray(s.missingSymbols) ? s.missingSymbols.join('، ') : '—';
    $('sourceHealth').innerHTML = [['الحالة', s.status], ['تزامن الجلسة', s.sessionAligned ? 'نعم' : 'لا'], ['Execution Grade', s.executionGrade ? 'نعم' : 'لا'], ['تعارضات حرجة', conflicts], ['رموز ناقصة', missing || 'لا يوجد'], ['آخر تحديث مصدر', s.lastSourceUpdate || '—']].map(([label,value]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function renderGovernance() {
    const g = state.current?.governance || {};
    $('governance').innerHTML = [['Champion', g.activeChampion || '—'], ['Challenger', g.challenger || '—'], ['حالة Challenger', g.challengerStatus || '—'], ['ترقية تلقائية', g.automaticPromotion ? 'مسموحة' : 'ممنوعة'], ['دليل مستقل حديث', g.challengerFreshIndependentEvidence ? 'متوفر' : 'غير متوفر']].map(([label,value]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function technicalSection(ta) {
    if (!ta) return '<p class="muted">لا توجد بيانات فنية موثوقة لهذا السهم.</p>';
    const isCurrent = ta.currentTechnicalReady === true;
    const label = isCurrent ? 'حالي موثوق' : ta.historicalIndicatorReady ? `تاريخي فقط حتى ${esc(ta.asOfSession || '—')}` : technicalAr(ta.status);
    const alertClass = isCurrent ? 'technical-current-note' : 'technical-stale-note';
    const blockers = (ta.blockers || []).map(code => reasonAr(code)).filter(Boolean).join(' • ');
    return `<div class="${alertClass}"><strong>${esc(label)}</strong><span>${esc(ta.note || '')}</span></div><div class="dialog-grid technical-grid"><div class="info-box"><span>الاتجاه</span><strong>${esc(ta.trend || '—')}</strong></div><div class="info-box"><span>RSI 14</span><strong>${num(ta.rsi14,2)}</strong></div><div class="info-box"><span>MACD</span><strong>${num(ta.macd,4)}</strong></div><div class="info-box"><span>Signal</span><strong>${num(ta.macdSignal,4)}</strong></div><div class="info-box"><span>ATR 14</span><strong>${num(ta.atr14,4)}</strong></div><div class="info-box"><span>SMA 20 / 50</span><strong>${num(ta.sma20,4)} / ${num(ta.sma50,4)}</strong></div><div class="info-box"><span>Momentum 5</span><strong>${pct(ta.momentum5Pct)}</strong></div><div class="info-box"><span>الجلسات المستخدمة</span><strong>${num(ta.rowsUsed,0)}</strong></div><div class="info-box"><span>المصدر الفني</span><strong>${esc(ta.source || '—')}</strong></div></div>${blockers ? `<p class="technical-blockers">${esc(blockers)}</p>` : ''}`;
  }

  function openProfile(ticker) {
    const profile = (state.profiles?.profiles || []).find(p => p.ticker === ticker);
    if (!profile) return;
    $('stockDialogTicker').textContent = profile.ticker;
    $('stockDialogTitle').textContent = profile.nameAr || profile.nameEn || profile.ticker;
    const p = profile.tradePlan || {}; const r = p.riskReward || {}; const sr = profile.supportResistance || {};
    const strengths = (profile.whyThisStock?.strengths || []).map(x => `<li>${esc(reasonAr(x))}</li>`).join('') || '<li>لا توجد نقاط قوة موثقة حاليًا</li>';
    const blockers = (profile.whyThisStock?.blockers || []).map(x => `<li>${esc(reasonAr(x))}</li>`).join('') || '<li>لا توجد موانع مسجلة</li>';
    $('stockDialogBody').innerHTML = `<div class="dialog-grid"><div class="info-box"><span>الحالة</span><strong>${esc(statusAr(profile.status))}</strong></div><div class="info-box"><span>السعر</span><strong>${money(profile.price)}</strong></div><div class="info-box"><span>Net R/R الهدف 1</span><strong class="${rrClass(r.primaryTarget1NetRiskReward)}">${rr(r.primaryTarget1NetRiskReward)}</strong></div><div class="info-box"><span>الدخول</span><strong>${money(p.entryLow)}–${money(p.entryHigh)}</strong></div><div class="info-box"><span>وقف الخسارة</span><strong>${money(p.stop)}</strong></div><div class="info-box"><span>الهدف 1 / 2</span><strong>${money(p.target1)} / ${money(p.target2)}</strong></div></div><section class="dialog-section"><h3>لماذا هذا السهم؟</h3><p class="muted">نقاط القوة</p><ul class="reason-list">${strengths}</ul><p class="muted">الموانع والتحفظات</p><ul class="reason-list">${blockers}</ul></section><section class="dialog-section"><h3>المؤشرات الفنية — Point in Time</h3>${technicalSection(profile.technicalAnalysis)}</section><section class="dialog-section"><h3>الدعم والمقاومة</h3><div class="dialog-grid"><div class="info-box"><span>دعم 1</span><strong>${money(sr.support1)}</strong></div><div class="info-box"><span>دعم 2</span><strong>${money(sr.support2)}</strong></div><div class="info-box"><span>مقاومة 1</span><strong>${money(sr.resistance1)}</strong></div><div class="info-box"><span>مقاومة 2</span><strong>${money(sr.resistance2)}</strong></div><div class="info-box"><span>الثقة</span><strong>${Number(sr.confidence) <= 1 ? pct(Number(sr.confidence)*100) : pct(sr.confidence)}</strong></div><div class="info-box"><span>تزامن الجلسة</span><strong>${sr.sessionAligned ? 'نعم' : 'لا'}</strong></div></div></section><section class="dialog-section"><h3>الثقة — أبعاد منفصلة</h3><div class="dialog-grid"><div class="info-box"><span>السوق</span><strong>${pct(profile.confidence?.marketConfidencePct)}</strong></div><div class="info-box"><span>البيانات</span><strong>${pct(profile.confidence?.dataConfidencePct)}</strong></div><div class="info-box"><span>النموذج</span><strong>${pct(profile.confidence?.modelConfidencePct)}</strong></div><div class="info-box"><span>التنفيذ</span><strong>${pct(profile.confidence?.executionConfidencePct)}</strong></div></div></section><section class="dialog-section"><h3>مراجعة R/R</h3><div class="detail-list"><div class="detail-row"><span>المقياس الأساسي</span><strong>Net R/R بعد التكلفة</strong></div><div class="detail-row"><span>Gross R/R المحافظ</span><strong>${rr(r.target1GrossRiskReward)}</strong></div><div class="detail-row"><span>Legacy R/R — للمراجعة فقط</span><strong>${rr(r.legacyRiskReward)}</strong></div><div class="detail-row"><span>مرجع Legacy</span><strong>${esc(r.legacyReference || '—')}</strong></div></div></section><section class="dialog-section"><h3>المصدر والحداثة</h3><div class="detail-list"><div class="detail-row"><span>المصدر</span><strong>${esc(profile.provenance?.source || '—')}</strong></div><div class="detail-row"><span>وقت المصدر</span><strong>${esc(profile.provenance?.sourceTimestamp || '—')}</strong></div><div class="detail-row"><span>الجلسة متطابقة</span><strong>${profile.provenance?.sessionAligned ? 'نعم' : 'لا'}</strong></div></div></section>`;
    showDialog();
  }

  function openMarketRow(ticker) {
    const profile = (state.profiles?.profiles || []).find(p => p.ticker === ticker);
    if (profile) { openProfile(ticker); return; }
    const row = (state.marketExplorer?.rows || []).find(item => item.ticker === ticker);
    if (!row) return;
    $('stockDialogTicker').textContent = row.ticker;
    $('stockDialogTitle').textContent = row.nameAr || row.nameEn || row.ticker;
    const priceState = row.currentSessionAvailable ? `بيانات جلسة ${esc(row.sessionDate)} متاحة` : 'بيانات الجلسة الحالية غير متاحة — لا يتم عرض سعر قديم كأنه حالي';
    $('stockDialogBody').innerHTML = `<div class="market-only-notice"><strong>سهم من السوق الكامل — ليس توصية حالية</strong><span>${priceState}</span></div><div class="dialog-grid"><div class="info-box"><span>السعر الحالي</span><strong>${row.currentSessionAvailable ? money(row.price) : 'غير متاح'}</strong></div><div class="info-box"><span>التغير</span><strong>${row.currentSessionAvailable ? pct(row.changePct) : '—'}</strong></div><div class="info-box"><span>حجم التداول</span><strong>${row.currentSessionAvailable ? num(row.volume,0) : '—'}</strong></div><div class="info-box"><span>قيمة التداول</span><strong>${row.currentSessionAvailable ? num(row.turnover,0) : '—'}</strong></div><div class="info-box"><span>السيولة</span><strong>${row.liquidityExecutionEligible ? 'مؤهل' : 'غير مؤهل / غير متاح'}</strong></div><div class="info-box"><span>جودة البيانات</span><strong>${row.currentSessionAvailable ? pct(row.criticalFieldCompletenessPct) : '—'}</strong></div></div><section class="dialog-section"><h3>الحالة الفنية</h3><div class="technical-stale-note"><strong>${esc(technicalAr(row.technical?.state))}</strong><span>عدم التقييم في النطاق الحالي لا يعني أن البيانات الفنية غير موجودة؛ يعني فقط أن V20 لم يحسبها ضمن نطاق الفرص الحالي.</span></div></section><section class="dialog-section"><h3>المصدر والحداثة</h3><div class="detail-list"><div class="detail-row"><span>المصدر</span><strong>${esc(row.provenance?.currentPriceSource || '—')}</strong></div><div class="detail-row"><span>وقت المصدر</span><strong>${esc(row.provenance?.sourceTimestamp || '—')}</strong></div><div class="detail-row"><span>جلسة المصدر</span><strong>${esc(row.provenance?.sourceSession || '—')}</strong></div><div class="detail-row"><span>تعارض مصدر</span><strong>${row.sourceConflict ? 'نعم' : 'لا'}</strong></div></div></section>`;
    showDialog();
  }

  function showDialog() { const dialog = $('stockDialog'); if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  function closeDialog() { const dialog = $('stockDialog'); if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); }

  $('searchInput').addEventListener('input', e => { state.query = e.target.value; renderOpportunities(); });
  $('statusFilter').addEventListener('change', e => { state.status = e.target.value; renderOpportunities(); });
  $('marketSearchInput').addEventListener('input', e => { state.marketQuery = e.target.value; state.marketPage = 1; renderMarketExplorer(); });
  $('marketAvailabilityFilter').addEventListener('change', e => { state.marketAvailability = e.target.value; state.marketPage = 1; renderMarketExplorer(); });
  $('marketLiquidityFilter').addEventListener('change', e => { state.marketLiquidity = e.target.value; state.marketPage = 1; renderMarketExplorer(); });
  $('marketTechnicalFilter').addEventListener('change', e => { state.marketTechnical = e.target.value; state.marketPage = 1; renderMarketExplorer(); });
  $('marketSort').addEventListener('change', e => { state.marketSort = e.target.value; state.marketPage = 1; renderMarketExplorer(); });
  $('marketPrev').addEventListener('click', () => { if (state.marketPage > 1) { state.marketPage -= 1; renderMarketExplorer(); } });
  $('marketNext').addEventListener('click', () => { state.marketPage += 1; renderMarketExplorer(); });
  $('closeDialog').addEventListener('click', closeDialog);
  $('stockDialog').addEventListener('click', e => { if (e.target === $('stockDialog')) closeDialog(); });
  load();
})();
