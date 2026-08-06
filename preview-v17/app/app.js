'use strict';

(() => {
  const URLS = {
    current: '../../data/v17/current.json',
    market: '../../data/market.json',
  };

  const state = { current: null, market: [], view: 'dashboard' };
  const $ = id => document.getElementById(id);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 2) => number(value) === null ? '—' : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits });
  const pct = (value, digits = 1) => number(value) === null ? '—' : `${fmt(value, digits)}%`;
  const money = value => number(value) === null ? '—' : Number(value).toLocaleString('en-EG', { maximumFractionDigits: 0 });
  const escapeHtml = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function cleanName(value, fallback = '—') {
    const raw = String(value || '').replace(/<[^>]+>/g, ' ').replace(/-->/g, ' ').replace(/\s+/g, ' ').trim();
    const cleaned = raw.replace(/^.*End AdSlot\s*\d*\s*/i, '').replace(/^[\[\]0-9,]+\s*/, '').trim();
    return cleaned.length >= 2 ? cleaned : fallback;
  }

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} عند تحميل ${url}`);
    return response.json();
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function metric(label, value, extraClass = '') {
    return `<div class="metric ${extraClass}"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`;
  }

  function setView(name) {
    state.view = name;
    document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `view-${name}`));
    document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'market') renderMarket();
    if (name === 'portfolio') renderPortfolio();
  }

  function renderHeader() {
    const current = state.current;
    const date = new Date(current.generatedAt);
    $('lastUpdated').textContent = Number.isNaN(date.getTime()) ? current.generatedAt : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
    const ready = current.status === 'READY_FOR_NEXT_SESSION_REVIEW';
    $('snapshotStatus').textContent = ready ? 'جاهز للمراجعة قبل الجلسة' : 'موقوف لحماية القرار';
    $('snapshotStatus').classList.toggle('blocked', !ready);
    $('decisionDisclosure').textContent = current.statusAr || 'هذه السلة للمراجعة وليست أمر شراء آليًا.';
    $('decisionWarning').textContent = current.decisionWarnings?.warningAr || 'التنفيذ مشروط بالافتتاح والسيولة.';
  }

  function renderScores() {
    const readiness = state.current.readiness || {};
    $('marketStrengthScore').textContent = fmt(readiness.marketStrengthScore, 0);
    $('dataQualityScore').textContent = fmt(readiness.dataQualityScore, 0);
    $('liveEvidenceScore').textContent = fmt(readiness.liveEvidenceScore, 1);
    $('operationalScore').textContent = fmt(readiness.operationalIntegrityScore, 0);
    $('marketRegimeLabel').textContent = state.current.market?.labelAr || 'غير محدد';
  }

  function renderSession() {
    const current = state.current;
    const health = current.systemHealth || {};
    $('sessionMetrics').innerHTML = [
      metric('جلسة القرار', current.sessionDate || '—'),
      metric('جلسة المصدر', health.sourceSession || '—'),
      metric('جلسة حالة السوق', health.regimeSession || '—'),
      metric('الأسهم الممسوحة', fmt(health.fetchedRows, 0)),
      metric('درجة التنفيذ', health.executionGrade ? 'مقبولة' : 'مرفوضة', health.executionGrade ? 'positive' : 'negative'),
      metric('اتساق الجلسة', health.sessionAligned ? 'متسقة' : 'غير متسقة', health.sessionAligned ? 'positive' : 'negative'),
    ].join('');

    const policy = current.portfolioPolicy || {};
    $('allocationBar').style.width = `${Math.min(100, number(policy.plannedAllocationPct) || 0)}%`;
    $('allocationMetrics').innerHTML = [
      metric('التعرض المخطط', pct(policy.plannedAllocationPct)),
      metric('الاحتياطي النقدي', pct(policy.cashReservePct)),
      metric('الحد الأقصى', pct(policy.maximumTotalAllocationPct)),
      metric('السهم غير المتفعل', policy.unfilledMemberPolicy === 'KEEP_CASH' ? 'يبقى نقدًا' : 'تحذير'),
    ].join('');
  }

  function renderRecommendations() {
    const current = state.current;
    $('engineTitle').textContent = current.engine?.labelAr || current.engine?.id || 'المحرك غير معروف';
    $('engineSubtitle').textContent = `${current.recommendations.length} أسهم — جلسة إشارة ${current.sessionDate} — الاحتفاظ المخطط جلسة واحدة`;
    $('recommendationGrid').innerHTML = current.recommendations.map(row => {
      const hot = row.hotMomentumRisk === true;
      return `<article class="recommendation-card ${hot ? 'hot' : ''}" data-ticker="${escapeHtml(row.ticker)}">
        <div class="rec-head">
          <div><h4>${escapeHtml(row.ticker)}</h4><p>${escapeHtml(cleanName(row.companyNameAr, row.ticker))}</p></div>
          <span class="weight-badge">${pct(row.portfolioWeightPct)} من المحفظة</span>
        </div>
        <div class="rec-prices">
          <div class="price-box"><small>الدخول من</small><b>${fmt(row.entryLow, 4)}</b></div>
          <div class="price-box"><small>الدخول إلى</small><b>${fmt(row.entryHigh, 4)}</b></div>
          <div class="price-box"><small>الهدف</small><b>${fmt(row.target, 4)}</b></div>
          <div class="price-box"><small>الوقف</small><b>${fmt(row.stop, 4)}</b></div>
        </div>
        <div class="rec-meta">
          <span class="chip">RSI ${fmt(row.rsi14, 1)}</span>
          <span class="chip">حجم ×${fmt(row.volumeRatio20, 2)}</span>
          <span class="chip">احتمال Top 10: ${pct(row.probabilityTop10Pct, 2)}</span>
          ${hot ? '<span class="chip warn">زخم ساخن — لا تطارد السعر</span>' : ''}
        </div>
        <div class="execution-rule">راقب أول ${fmt(row.executionRules?.observeFirstMinutes, 0)} دقيقة. يُلغى التنفيذ إذا كان الافتتاح خارج النطاق أو لم تتأكد السيولة. هذه ليست أمر شراء.</div>
      </article>`;
    }).join('');
  }

  function renderEvidence() {
    const current = state.current;
    const readiness = current.readiness || {};
    const native = current.evidence?.nativeV17 || {};
    const nativeGate = native.gate || {};
    const research = current.evidence?.researchAudit || {};
    const legacy = current.evidence?.legacyMethodEvidence || {};

    $('evidenceStage').textContent = readiness.releaseStage === 'PROFESSIONAL_EVIDENCE' ? 'دليل مهني' : 'Pilot مضبوط';
    $('evidenceDisclosure').textContent = readiness.disclosureAr || 'الدليل الحي V17 منفصل عن الاختبار التاريخي.';
    $('nativeEvidence').innerHTML = [
      metric('السلال الصادرة', fmt(native.issuedBaskets, 0)),
      metric('السلال المحسومة', `${fmt(native.resolvedBaskets, 0)} / ${fmt(nativeGate.minimumResolvedBaskets, 0)}`),
      metric('الأعضاء المحسومون', `${fmt(native.resolvedMembers, 0)} / ${fmt(nativeGate.minimumResolvedMembers, 0)}`),
      metric('الأيام المرصودة', `${fmt(nativeGate.observedCalendarDays, 0)} / ${fmt(nativeGate.minimumObservedCalendarDays, 0)}`),
      metric('نسبة فوز السلة', pct(native.winRatePct)),
      metric('متوسط السلة', pct(native.averageBasketReturnPct, 3)),
    ].join('');
    $('researchEvidence').innerHTML = [
      metric('الجلسات المختبرة', fmt(research.auditWindow?.completedSessions, 0)),
      metric('تحقيق الهدف المحافظ', pct(research.conservativeTargetHitRatePct, 2)),
      metric('جلسات سلة رابحة', pct(research.positiveBasketSessionPct, 1)),
      metric('متوسط العائد الصافي', pct(research.averageNetReturnPct, 3)),
      metric('Profit Factor', fmt(research.profitFactor, 3)),
      metric('أقصى تراجع', pct(research.maximumDrawdownPct, 3)),
    ].join('');
    $('legacyEvidence').innerHTML = legacy.name ? [
      metric('التوصيات السابقة', fmt(legacy.archivedRecommendations, 0)),
      metric('الصفقات المحسومة', fmt(legacy.resolvedTrades, 0)),
      metric('نسبة الفوز', pct(legacy.winRatePct)),
      metric('متوسط العائد', pct(legacy.averageNetReturnPct, 3)),
      metric('Profit Factor', legacy.profitFactor === null ? 'غير قابل للحساب' : fmt(legacy.profitFactor, 3)),
      metric('الأيام المرصودة', fmt(legacy.observedCalendarDays, 0)),
    ].join('') : '<div class="empty">لا يوجد مرجع سابق متاح.</div>';
  }

  function renderHealth() {
    const current = state.current;
    const health = current.systemHealth || {};
    const quality = health.marketDataQuality || {};
    const governance = current.championChallenger || {};
    const checks = [
      ['محرك إنتاج واحد', current.engine?.singleProductionEngine === true],
      ['طريقة الاختيار مجمدة', current.engine?.selectionMethodFrozen === true],
      ['اتساق جلسة القرار والمصدر', health.sessionAligned === true],
      ['بيانات بدرجة تنفيذ', health.executionGrade === true],
      ['منع الأوامر الآلية', current.portfolioPolicy?.automaticOrders === false],
      ['إبقاء الوزن غير المتفعل نقدًا', current.portfolioPolicy?.unfilledMemberPolicy === 'KEEP_CASH'],
      ['الدليل الحي خاص بـV17', Boolean(current.evidence?.nativeV17)],
      ['المحرك الأساسي مطابق للـChampion', governance.activeEngine === current.engine?.id],
      ['منع الترقية الآلية للمنافس', governance.promotionAllowed === false],
    ];
    $('healthChecks').innerHTML = checks.map(([label, passed]) => `<div class="check-item"><span>${escapeHtml(label)}</span><b class="${passed ? 'good' : 'bad'}">${passed ? 'سليم' : 'مرفوض'}</b></div>`).join('');
    $('dataQualityDetails').innerHTML = [
      metric('إجمالي الصفوف', fmt(quality.totalRows, 0)),
      metric('تغطية السعر', pct(quality.pricedCoveragePct, 2)),
      metric('اكتمال OHLC', pct(quality.completeOhlcPct, 2)),
      metric('نظافة أسماء الشركات', pct(quality.cleanCompanyNamePct, 2)),
      metric('المحرك الأساسي', governance.activeEngine || '—'),
      metric('حالة المنافس', governance.statusAr || governance.status || '—'),
    ].join('');
    $('lineageList').innerHTML = Object.entries(current.lineage || {}).map(([key, value]) => `<div class="lineage-item"><span>${escapeHtml(key)}</span><code>${escapeHtml(value)}</code></div>`).join('');
  }

  function marketRowsFiltered() {
    const query = String($('marketSearch')?.value || '').trim().toLowerCase();
    const filter = $('marketFilter')?.value || 'all';
    const selected = new Set((state.current?.recommendations || []).map(row => row.ticker));
    return state.market.filter(row => {
      const symbol = String(row.symbol || '').toUpperCase();
      const name = cleanName(row.name_ar || row.name_en, symbol).toLowerCase();
      const matchesQuery = !query || symbol.toLowerCase().includes(query) || name.includes(query);
      const isRecommended = selected.has(symbol);
      const change = number(row.changePct) || 0;
      const matchesFilter = filter === 'all' || (filter === 'recommended' && isRecommended) || (filter === 'outside' && !isRecommended) || (filter === 'gainers' && change > 0);
      return matchesQuery && matchesFilter;
    }).sort((a, b) => (number(b.valueTraded) || 0) - (number(a.valueTraded) || 0));
  }

  function renderMarket() {
    if (!$('marketRows')) return;
    const rows = marketRowsFiltered();
    const selected = new Set((state.current?.recommendations || []).map(row => row.ticker));
    const visible = rows.slice(0, 80);
    $('marketSummary').innerHTML = `<span class="chip">النتائج ${rows.length}</span><span class="chip">المعروض ${visible.length}</span><span class="chip">جلسة ${escapeHtml(state.current?.sessionDate || '—')}</span>`;
    $('marketRows').innerHTML = visible.length ? visible.map(row => {
      const symbol = String(row.symbol || '').toUpperCase();
      const change = number(row.changePct);
      return `<tr>
        <td><b>${escapeHtml(symbol)}</b><div class="muted">${escapeHtml(cleanName(row.name_ar || row.name_en, symbol))}</div></td>
        <td>${fmt(row.price ?? row.last, 4)}</td>
        <td class="${change > 0 ? 'positive' : change < 0 ? 'negative' : 'muted'}">${pct(change)}</td>
        <td>${money(row.volume)}</td>
        <td>${selected.has(symbol) ? '<span class="chip">ضمن السلة</span>' : '<span class="muted">خارج السلة</span>'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">لا توجد نتائج مطابقة.</td></tr>';
  }

  function renderPortfolio() {
    if (!state.current) return;
    const capital = Math.max(0, number($('capitalInput')?.value) || 0);
    const requestedRisk = Math.max(0, number($('riskInput')?.value) || 0);
    const marketRiskCap = number(state.current.market?.maxTradeRiskPct);
    if ($('riskInput') && marketRiskCap !== null) {
      $('riskInput').max = String(marketRiskCap);
      if (requestedRisk > marketRiskCap) $('riskInput').value = String(marketRiskCap);
    }
    const appliedRiskPct = Math.min(number($('riskInput')?.value) || 0, marketRiskCap ?? 1);
    let totalValue = 0;
    let totalRisk = 0;
    const rows = state.current.recommendations.map(row => {
      const plannedValue = capital * (number(row.portfolioWeightPct) || 0) / 100;
      const entry = ((number(row.entryLow) || 0) + (number(row.entryHigh) || 0)) / 2;
      const riskPerShare = Math.max(0, entry - (number(row.stop) || 0));
      const byWeight = entry > 0 ? Math.floor(plannedValue / entry) : 0;
      const maxRiskAmount = capital * appliedRiskPct / 100;
      const byRisk = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : byWeight;
      const quantity = Math.max(0, Math.min(byWeight, byRisk));
      const value = quantity * entry;
      const risk = quantity * riskPerShare;
      totalValue += value;
      totalRisk += risk;
      return `<tr><td><b>${escapeHtml(row.ticker)}</b></td><td>${pct(row.portfolioWeightPct)}</td><td>${money(value)}</td><td>${fmt(entry, 4)}</td><td>${money(quantity)}</td><td>${money(risk)}</td></tr>`;
    });
    $('positionRows').innerHTML = rows.join('');
    $('portfolioSummary').innerHTML = [
      metric('رأس المال', money(capital)),
      metric('قيمة المراكز النظرية', money(totalValue)),
      metric('نسبة التعرض الفعلية', capital > 0 ? pct(totalValue / capital * 100) : '—'),
      metric('الخطر النظري الإجمالي', money(totalRisk)),
      metric('سقف مخاطرة الصفقة', pct(appliedRiskPct, 2)),
      metric('احتياطي نقدي تقريبي', money(Math.max(0, capital - totalValue))),
    ].join('');
  }

  async function load() {
    $('refreshButton').disabled = true;
    try {
      const [current, market] = await Promise.all([fetchJson(URLS.current), fetchJson(URLS.market)]);
      state.current = current;
      state.market = Array.isArray(market.rows) ? market.rows : [];
      renderHeader();
      renderScores();
      renderSession();
      renderRecommendations();
      renderEvidence();
      renderHealth();
      renderMarket();
      renderPortfolio();
      showToast('تم تحميل مصدر الحقيقة V17 بنجاح');
    } catch (error) {
      console.error(error);
      $('snapshotStatus').textContent = 'تعذر تحميل البيانات';
      $('snapshotStatus').classList.add('blocked');
      $('recommendationGrid').innerHTML = `<div class="empty">${escapeHtml(error.message || error)}</div>`;
      showToast('تعذر تحديث بيانات V17');
    } finally {
      $('refreshButton').disabled = false;
    }
  }

  document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('refreshButton').addEventListener('click', load);
  $('marketSearch').addEventListener('input', renderMarket);
  $('marketFilter').addEventListener('change', renderMarket);
  $('capitalInput').addEventListener('input', renderPortfolio);
  $('riskInput').addEventListener('input', renderPortfolio);
  load();
})();
