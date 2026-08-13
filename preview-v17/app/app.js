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
    const executionReady = current.status === 'READY_FOR_NEXT_SESSION_REVIEW';
    const researchReady = current.status === 'RESEARCH_READY_EXECUTION_BLOCKED';
    $('snapshotStatus').textContent = executionReady ? 'جاهز للمراجعة التنفيذية' : researchReady ? 'بحث ومراقبة فقط' : 'موقوف لحماية القرار';
    $('snapshotStatus').classList.toggle('blocked', !executionReady);
    $('decisionDisclosure').textContent = current.statusAr || 'هذه الفرص للمراجعة وليست أمر شراء آليًا.';
    $('decisionWarning').textContent = current.decisionWarnings?.warningAr || 'التنفيذ غير مسموح حتى تكتمل بوابات الجلسة الحالية.';
  }

  function renderScores() {
    const readiness = state.current.readiness || {};
    $('marketStrengthScore').textContent = readiness.marketStrengthScore === null ? 'غير محسوب' : fmt(readiness.marketStrengthScore, 0);
    $('dataQualityScore').textContent = fmt(readiness.dataQualityScore, 0);
    $('liveEvidenceScore').textContent = fmt(readiness.liveEvidenceScore, 1);
    $('operationalScore').textContent = fmt(readiness.operationalIntegrityScore, 0);
    $('marketRegimeLabel').textContent = state.current.market?.labelAr || 'غير محدد';
  }

  function renderSession() {
    const current = state.current;
    const health = current.systemHealth || {};
    const championReference = current.championReference || {};
    const currentResearch = current.currentResearch || {};
    $('sessionMetrics').innerHTML = [
      metric('جلسة السوق الحالية', current.sessionDate || '—'),
      metric('جلسة البحث الحالي', currentResearch.sessionDate || '—'),
      metric('جلسة Champion المرجعية', championReference.sessionDate || '—'),
      metric('الأسهم الممسوحة', fmt(health.fetchedRows, 0)),
      metric('وضع المصدر', health.resilientMode || '—'),
      metric('درجة التنفيذ', health.executionGrade ? 'مقبولة' : 'غير مسموحة', health.executionGrade ? 'positive' : 'negative'),
    ].join('');

    const policy = current.portfolioPolicy || {};
    $('allocationBar').style.width = `${Math.min(100, number(policy.plannedAllocationPct) || 0)}%`;
    $('allocationMetrics').innerHTML = [
      metric('التعرض الحالي', pct(policy.plannedAllocationPct)),
      metric('الاحتياطي النقدي', pct(policy.cashReservePct)),
      metric('الحد الأقصى', pct(policy.maximumTotalAllocationPct)),
      metric('وضع المراقبة', Number(policy.researchWatchAllocationPct || 0) === 0 ? '0% — بدون تنفيذ' : pct(policy.researchWatchAllocationPct)),
    ].join('');
  }

  function renderRecommendations() {
    const current = state.current;
    const currentResearch = current.currentResearch || {};
    const championReference = current.championReference || {};
    const researchOnly = current.recommendationMode === 'CURRENT_RESEARCH_WATCH_ONLY';
    $('engineTitle').textContent = researchOnly ? 'فرص السوق الحالية — مراقبة فقط' : (current.engine?.labelAr || current.engine?.id || 'المحرك غير معروف');
    $('engineSubtitle').textContent = researchOnly
      ? `${current.recommendations.length} فرص من جلسة ${current.sessionDate} — Champion محفوظ من جلسة ${championReference.sessionDate || '—'} — لا أوزان استثمارية`
      : `${current.recommendations.length} أسهم — جلسة ${current.sessionDate} — مراجعة تنفيذية مشروطة`;

    $('recommendationGrid').innerHTML = current.recommendations.length ? current.recommendations.map(row => {
      const hot = row.hotMomentumRisk === true;
      const watchOnly = researchOnly || row.monitorOnly === true || row.executionAllowed !== true;
      const badge = watchOnly ? 'مراقبة فقط — 0% من المحفظة' : `${pct(row.portfolioWeightPct)} من المحفظة`;
      const stateLabel = row.opportunityState === 'CONDITIONAL_WATCH' ? 'مراقبة مشروطة' : row.opportunityState === 'EXECUTABLE' ? 'تنفيذ مشروط' : row.grade || row.state || 'متابعة';
      return `<article class="recommendation-card ${hot ? 'hot' : ''}" data-ticker="${escapeHtml(row.ticker)}">
        <div class="rec-head">
          <div><h4>${escapeHtml(row.ticker)}</h4><p>${escapeHtml(cleanName(row.companyNameAr, row.ticker))}</p></div>
          <span class="weight-badge">${escapeHtml(badge)}</span>
        </div>
        <div class="rec-prices">
          <div class="price-box"><small>الدخول من</small><b>${fmt(row.entryLow, 4)}</b></div>
          <div class="price-box"><small>الدخول إلى</small><b>${fmt(row.entryHigh, 4)}</b></div>
          <div class="price-box"><small>الهدف</small><b>${fmt(row.target, 4)}</b></div>
          <div class="price-box"><small>الوقف</small><b>${fmt(row.stop, 4)}</b></div>
        </div>
        <div class="rec-meta">
          <span class="chip">${escapeHtml(stateLabel)}</span>
          ${row.grade ? `<span class="chip">درجة ${escapeHtml(row.grade)}</span>` : ''}
          <span class="chip">ثقة البحث: ${pct(row.probabilityTop10Pct, 1)}</span>
          ${row.srVerified === false ? '<span class="chip warn">S/R غير موثق</span>' : ''}
          ${hot ? '<span class="chip warn">زخم ساخن — لا تطارد السعر</span>' : ''}
        </div>
        <div class="execution-rule">${watchOnly ? 'مراقبة فقط. لا يوجد وزن محفظة ولا أمر شراء. نطاقات الدخول/الهدف بحثية حتى تكتمل بوابات التنفيذ.' : `راقب أول ${fmt(row.executionRules?.observeFirstMinutes, 0)} دقيقة. يُلغى التنفيذ إذا كان الافتتاح خارج النطاق أو لم تتأكد السيولة. هذه ليست أمر شراء.`}</div>
      </article>`;
    }).join('') : '<div class="empty">لا توجد فرص حالية اجتازت بوابة البحث.</div>';
  }

  function renderEvidence() {
    const current = state.current;
    const readiness = current.readiness || {};
    const native = current.evidence?.nativeV17 || {};
    const nativeGate = native.gate || {};
    const researchAudit = current.evidence?.researchAudit || {};
    const legacyMethodEvidence = current.evidence?.legacyMethodEvidence || {};
    const currentResearch = current.currentResearch || {};
    const championReference = current.championReference || {};

    $('evidenceStage').textContent = readiness.releaseStage === 'PROFESSIONAL_EVIDENCE' ? 'دليل مهني' : 'Pilot مضبوط';
    $('evidenceDisclosure').textContent = `${readiness.disclosureAr || 'الدليل الحي V17 منفصل عن الاختبار التاريخي.'} البحث الحالي: ${currentResearch.mainDecision || '—'} Champion: ${championReference.disclosureAr || '—'}`;
    $('nativeEvidence').innerHTML = [
      metric('السلال الصادرة', fmt(native.issuedBaskets, 0)),
      metric('السلال المحسومة', `${fmt(native.resolvedBaskets, 0)} / ${fmt(nativeGate.minimumResolvedBaskets, 0)}`),
      metric('الأعضاء المحسومون', `${fmt(native.resolvedMembers, 0)} / ${fmt(nativeGate.minimumResolvedMembers, 0)}`),
      metric('الأيام المرصودة', `${fmt(nativeGate.observedCalendarDays, 0)} / ${fmt(nativeGate.minimumObservedCalendarDays, 0)}`),
      metric('نسبة فوز السلة', pct(native.winRatePct)),
      metric('متوسط السلة', pct(native.averageBasketReturnPct, 3)),
    ].join('');
    $('researchEvidence').innerHTML = [
      metric('جلسة البحث الحالية', currentResearch.sessionDate || '—'),
      metric('الفرص المرتبة', fmt(currentResearch.rankedCount, 0)),
      metric('فرص التنفيذ', fmt(currentResearch.executionCount, 0)),
      metric('تغطية S/R', pct(currentResearch.supportResistanceCoveragePct, 2)),
      metric('الجلسات التاريخية المختبرة', fmt(researchAudit.auditWindow?.completedSessions, 0)),
      metric('متوسط العائد التاريخي', pct(researchAudit.averageNetReturnPct, 3)),
    ].join('');
    $('legacyEvidence').innerHTML = legacyMethodEvidence.name ? [
      metric('التوصيات السابقة', fmt(legacyMethodEvidence.archivedRecommendations, 0)),
      metric('الصفقات المحسومة', fmt(legacyMethodEvidence.resolvedTrades, 0)),
      metric('نسبة الفوز', pct(legacyMethodEvidence.winRatePct)),
      metric('متوسط العائد', pct(legacyMethodEvidence.averageNetReturnPct, 3)),
      metric('Profit Factor', legacyMethodEvidence.profitFactor === null ? 'غير قابل للحساب' : fmt(legacyMethodEvidence.profitFactor, 3)),
      metric('الأيام المرصودة', fmt(legacyMethodEvidence.observedCalendarDays, 0)),
    ].join('') : '<div class="empty">لا يوجد مرجع سابق متاح.</div>';
  }

  function renderHealth() {
    const current = state.current;
    const health = current.systemHealth || {};
    const quality = health.marketDataQuality || {};
    const governance = current.championChallenger || {};
    const championReference = current.championReference || {};
    const currentResearch = current.currentResearch || {};
    const checks = [
      ['محرك Champion واحد', current.engine?.singleProductionEngine === true],
      ['طريقة Champion مجمدة', current.engine?.selectionMethodFrozen === true],
      ['جلسة البحث = جلسة السوق', health.sessionAligned === true],
      ['البحث الحالي جاهز', currentResearch.researchReady === true],
      ['منع التنفيذ عند نقص البوابات', health.executionGrade === true || Number(current.portfolioPolicy?.plannedAllocationPct || 0) === 0],
      ['Champion القديم معروض كمرجع فقط', championReference.currentForMarketSession === true || current.recommendationMode === 'CURRENT_RESEARCH_WATCH_ONLY'],
      ['منع الأوامر الآلية', current.portfolioPolicy?.automaticOrders === false],
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
      metric('جلسة Champion المرجعية', championReference.sessionDate || '—'),
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
      const isSelected = selected.has(symbol);
      const change = number(row.changePct) || 0;
      const matchesFilter = filter === 'all' || (filter === 'recommended' && isSelected) || (filter === 'outside' && !isSelected) || (filter === 'gainers' && change > 0);
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
        <td>${selected.has(symbol) ? '<span class="chip">ضمن فرص المتابعة</span>' : '<span class="muted">خارج القائمة</span>'}</td>
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
    const appliedRiskPct = Math.min(number($('riskInput')?.value) || 0, marketRiskCap ?? 0);
    const hasAllocation = (state.current.recommendations || []).some(row => (number(row.portfolioWeightPct) || 0) > 0 && row.executionAllowed === true);
    if (!hasAllocation) {
      $('positionRows').innerHTML = '<tr><td colspan="6" class="empty">لا توجد مراكز نظرية: V17 في وضع مراقبة فقط، والتعرض المخطط 0%.</td></tr>';
      $('portfolioSummary').innerHTML = [
        metric('رأس المال', money(capital)),
        metric('قيمة المراكز النظرية', money(0)),
        metric('نسبة التعرض الفعلية', pct(0)),
        metric('الخطر النظري الإجمالي', money(0)),
        metric('سقف مخاطرة الصفقة', pct(0)),
        metric('الاحتياطي النقدي', money(capital)),
      ].join('');
      return;
    }

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