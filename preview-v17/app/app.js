'use strict';

(() => {
  const URLS = {
    current: '../../data/v17/current.json',
    market: '../../data/market.json',
    bridge: '../../data/v17/investment-bridge/current.json',
    historical: '../../data/v17/historical-recovery/integrated-market.json',
    historicalCurrent: '../../data/v17/historical-recovery/current.json',
  };

  const state = { current: null, market: [], bridge: null, historical: null, historicalCurrent: null, view: 'dashboard' };
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

  const byTicker = (rows, ticker, key = 'ticker') => (rows || []).find(row => String(row?.[key] || '').toUpperCase() === ticker);
  const historyStageAr = code => ({ BOTTOMING: 'تكوين قاع', EARLY_RECOVERY: 'بداية تعافٍ', RECOVERY_CONFIRMED: 'تعافٍ مؤكد', RECOVERY_EXTENDED: 'تعافٍ ممتد' }[code] || 'غير متاح');
  const executionStateAr = code => ({ PENDING_OPEN_CONFIRMATION: 'ينتظر تأكيد الافتتاح', EXECUTED: 'تم تنفيذ يومي صالح', KEEP_CASH: 'احتفاظ بالسيولة' }[code] || 'ينتظر تحقق شروط التنفيذ');
  function linkedRecord(ticker) {
    const integrated = byTicker(state.historical?.results, ticker);
    const scanner = byTicker(state.historicalCurrent?.results, ticker, 'symbol');
    const badge = byTicker(state.bridge?.dailyRecommendationBadges, ticker);
    const bridgeMatch = byTicker(state.bridge?.newMatches, ticker);
    return { integrated, scanner, badge, bridgeMatch, matched: Boolean(integrated || scanner) };
  }
  function historicalQuality(link) {
    return V17HistoricalSemantics.quality(link.integrated, link.scanner);
  }
  const semanticFor = link => V17HistoricalSemantics.classify({ integrated: link.integrated, scanner: link.scanner, bridgeBadge: link.badge });
  function bridgePresentation(row, link) {
    const allowed = link.badge?.conversionAllowed === true;
    if (allowed) return { label: 'مؤهل للتحويل بعد تنفيذ صالح', reasons: [] };
    const reasons = [];
    if (row.state !== 'EXECUTED') reasons.push('لم يحدث تنفيذ يومي صالح');
    if (link.integrated?.fundamental?.fundamentalDataConfidence === 'UNAVAILABLE') reasons.push('البيانات المالية غير مكتملة');
    const quality = historicalQuality(link);
    if (!quality.acceptable) reasons.push(quality.labelAr);
    if (!link.matched) return { label: 'توصية يومية فقط', reasons: [] };
    return { label: link.badge?.badgeAr || link.bridgeMatch?.conversionStateAr || 'غير مؤهل للتحويل حاليًا', reasons: [...new Set(reasons)] };
  }

  function renderHistoricalSummary() {
    const rows = state.current?.recommendations || [], links = rows.map(row => { const link=linkedRecord(row.ticker); return { row, link, semantic: semanticFor(link) }; });
    const stage = code => links.filter(x => x.semantic.meaningfulRecoveryCycle && x.semantic.stage === code).length;
    const review = links.filter(x => x.semantic.reviewRequired).length;
    $('historicalLinkMetrics').innerHTML = [
      metric('التوصيات اليومية', fmt(rows.length, 0)), metric('بيانات تاريخية متاحة', fmt(links.filter(x => x.semantic.dataAvailable).length, 0)),
      metric('مطابقات دورة قاع/تعافٍ فعلية', fmt(links.filter(x => x.semantic.meaningfulRecoveryCycle).length, 0)),
      metric('بيانات تاريخية تحت المراجعة', fmt(review, 0), review ? 'negative' : 'positive'),
      metric('قريب من القاع', fmt(stage('BOTTOMING'), 0)), metric('تعافٍ مبكر', fmt(stage('EARLY_RECOVERY'), 0)),
      metric('تعافٍ مؤكد', fmt(stage('RECOVERY_CONFIRMED'), 0)), metric('تعافٍ ممتد', fmt(stage('RECOVERY_EXTENDED'), 0)),
      metric('مؤهلون للربط الاستثماري', fmt(links.filter(x => x.semantic.investmentBridgeEligible).length, 0)),
    ].join('');
  }

  function setView(name) {
    state.view = name;
    document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `view-${name}`));
    document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'market') renderMarket();
    if (name === 'portfolio') renderPortfolio();
    if (name === 'investmentBridge') renderInvestmentBridge();
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
    const bridgeBadges = new Map((state.bridge?.dailyRecommendationBadges || []).map(row => [row.ticker, row.badgeAr]));
    $('engineTitle').textContent = current.engine?.labelAr || current.engine?.id || 'المحرك غير معروف';
    $('engineSubtitle').textContent = `${current.recommendations.length} أسهم — جلسة إشارة ${current.sessionDate} — الاحتفاظ المخطط جلسة واحدة`;
    $('recommendationGrid').innerHTML = current.recommendations.map(row => {
      const hot = row.hotMomentumRisk === true;
      const link = linkedRecord(row.ticker), semantic = semanticFor(link), integrated = link.integrated, historical = integrated?.historical, technical = integrated?.technical || {}, scanner = link.scanner, quality = historicalQuality(link), bridge = bridgePresentation(row, link);
      const stage = technical.recoveryStageAr || scanner?.recoveryStageAr || scanner?.stageAr || historyStageAr(technical.recoveryStage || scanner?.recoveryStage);
      const recoveryScore = number(technical.recoveryScore) ?? number(scanner?.recoveryScore), strengthScore = number(technical.strengthScore) ?? number(scanner?.strengthScore);
      const cycleStory = semantic.meaningfulRecoveryCycle ? `<div class="cycle-story"><b>دورة التعافي</b><span>القمة المرجعية ${fmt(historical?.high,4)}</span><i>↓</i><span>القاع بعد القمة ${fmt(historical?.postPeakLow,4)}</span><i>↑</i><span>السعر الحالي ${fmt(historical?.current,4)}</span></div>` : '';
      const historicalBlock = link.matched ? `<div class="historical-compact semantic-${semantic.state.toLowerCase()}">
          <div class="historical-heading"><b>الوضع التاريخي للسهم</b><span class="quality-badge ${quality.tone}">${escapeHtml(quality.labelAr)}</span></div>
          <div class="semantic-levels"><span>البيانات التاريخية: متاحة</span><b>${escapeHtml(semantic.cycleLabelAr)}</b><span>الربط الاستثماري: ${semantic.investmentBridgeEligible?'مؤهل':'غير مؤهل حاليًا'}</span></div>
          <div class="story-grid"><p><small>حالة الدخول اليوم</small>${escapeHtml(hot ? 'زخم ساخن — التنفيذ مشروط بالنطاق ولا تطارد السعر' : 'التنفيذ مشروط بنطاق الدخول والسيولة')}</p><p><small>الحالة الدلالية</small>${escapeHtml(semantic.labelAr)}</p><p><small>السياق الحالي</small>${escapeHtml(stage)}</p><p><small>الربط</small>${escapeHtml(bridge.label)}</p></div>${cycleStory}
          <div class="bridge-reasons"><b>حالة الربط الاستثماري:</b> ${escapeHtml(bridge.label)}${bridge.reasons.length ? `<span>${escapeHtml(bridge.reasons.join(' · '))}</span>` : ''}</div>
          <details><summary>عرض تفاصيل التعافي التاريخي</summary><div class="historical-details">
            <dl><dt>مستوى التغطية</dt><dd>${escapeHtml(semantic.labelAr)}</dd><dt>القمة المرجعية التاريخية</dt><dd>${fmt(historical?.high, 4)} — ${escapeHtml(historical?.highDate || 'غير متاح')}</dd><dt>القاع بعد القمة</dt><dd>${fmt(historical?.postPeakLow, 4)} — ${escapeHtml(historical?.postPeakLowDate || 'غير متاح')}</dd><dt>أقصى هبوط من القمة إلى قاع الدورة</dt><dd>${pct(semantic.peakToTroughDeclinePct)}</dd><dt>المتبقي حاليًا دون القمة</dt><dd>${pct(semantic.currentDrawdownPct)}</dd><dt>المسافة فوق قاع ما بعد القمة</dt><dd>${pct(historical?.distanceAbovePostPeakLowPct)}</dd><dt>موضع التعافي</dt><dd>${pct(semantic.recoveryPositionPct)}</dd><dt>مرحلة التعافي</dt><dd>${escapeHtml(stage)}</dd><dt>Recovery Score</dt><dd>${fmt(recoveryScore)}</dd><dt>Strength Score</dt><dd>${fmt(strengthScore)}</dd><dt>التصنيف البحثي التاريخي</dt><dd>${escapeHtml(integrated?.classificationAr || scanner?.bottomClassificationAr || 'غير متاح')}</dd><dt>ثقة البيانات</dt><dd>${pct(integrated?.historicalDataQuality?.confidence ?? scanner?.dataConfidence)}</dd><dt>حالة إجراءات الشركات</dt><dd>${escapeHtml(quality.labelAr)}</dd><dt>أسباب عدم الأهلية</dt><dd>${escapeHtml(bridge.reasons.join(' · ') || 'لا توجد أسباب مسجلة')}</dd></dl>
            <p class="reference-warning">القمة المرجعية ليست هدف بيع مضمونًا.</p><div class="detail-actions"><a href="../historical-recovery/?ticker=${encodeURIComponent(row.ticker)}">عرض التحليل التاريخي</a><button type="button" data-open-bridge>عرض الربط الاستثماري</button></div>
          </div></details>
        </div>` : `<div class="historical-compact no-match"><b>الوضع التاريخي للسهم</b><p>لا توجد مطابقة تاريخية صالحة حاليًا</p></div>`;
      return `<article class="recommendation-card ${hot ? 'hot' : ''}" data-ticker="${escapeHtml(row.ticker)}">
        <div class="rec-head">
          <div><h4>${escapeHtml(row.ticker)}</h4><p>${escapeHtml(cleanName(row.companyNameAr, row.ticker))}</p></div>
          <span class="weight-badge">${pct(row.portfolioWeightPct)} من المحفظة</span>
        </div>
        <section class="daily-view"><h5>الرؤية اليومية</h5>
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
          ${bridgeBadges.has(row.ticker) ? `<span class="chip bridge-badge">${escapeHtml(bridgeBadges.get(row.ticker))}</span>` : ''}
        </div>
        <div class="execution-rule"><b>${escapeHtml(executionStateAr(row.state))}.</b> راقب أول ${fmt(row.executionRules?.observeFirstMinutes, 0)} دقيقة. يُلغى التنفيذ إذا كان الافتتاح خارج النطاق أو لم تتأكد السيولة. هذه ليست أمر شراء.</div></section>
        <section class="historical-view"><h5>الرؤية التاريخية</h5>${historicalBlock}</section>
      </article>`;
    }).join('');
    document.querySelectorAll('[data-open-bridge]').forEach(button => button.addEventListener('click', () => setView('investmentBridge')));
    renderHistoricalSummary();
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

  function renderInvestmentBridge() {
    const bridge = state.bridge;
    if (!bridge) {
      $('bridgeStatus').textContent = 'غير متاح';
      $('bridgeMatchRows').innerHTML = '<tr><td colspan="6" class="empty">بيانات جسر V17 غير متاحة حاليًا.</td></tr>';
      $('bridgePositionCards').innerHTML = '<div class="empty">لا يوجد تقرير متابعة محفوظ.</div>';
      $('bridgeAlerts').innerHTML = '<div class="empty">لا توجد تنبيهات.</div>';
      return;
    }
    $('bridgeStatus').textContent = bridge.researchOnly ? 'بحثي مستقل' : 'تحقق مطلوب';
    $('bridgeDisclaimer').textContent = bridge.independenceStatementAr || $('bridgeDisclaimer').textContent;
    $('bridgeHighDisclaimer').textContent = bridge.historicalHighDisclaimerAr || $('bridgeHighDisclaimer').textContent;
    $('bridgeActiveCount').textContent = fmt(bridge.activePositions?.length || 0, 0);
    $('bridgeCandidatesCount').textContent = fmt(bridge.newConversionCandidates?.length || 0, 0);
    $('bridgeApproachCount').textContent = fmt(bridge.approachingHigh?.length || 0, 0);
    $('bridgeExitCount').textContent = fmt(bridge.exitSignals?.length || 0, 0);
    $('bridgeMatchRows').innerHTML = (bridge.newMatches || []).length ? bridge.newMatches.map(row => `<tr>
      <td><b>${escapeHtml(row.ticker)}</b></td>
      <td>${escapeHtml(row.historicalRecovery)}</td>
      <td>${pct(row.drawdownFromHighPct)}</td>
      <td>${pct(row.recoveryPositionPct)}</td>
      <td>${escapeHtml(row.recoveryStage)}</td>
      <td>${escapeHtml(row.badgeAr || row.conversionStateAr)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">لا يوجد توافق تاريخي مؤهل ضمن توصيات اليوم.</td></tr>';
    $('bridgePositionCards').innerHTML = (bridge.activePositions || []).length ? bridge.activePositions.map(row => `<article class="bridge-card">
      <div class="rec-head"><div><h4>${escapeHtml(row.companyArabic || row.ticker)} — ${escapeHtml(row.ticker)}</h4><p>${escapeHtml(row.currentInvestmentClassification)}</p></div><span class="weight-badge">${escapeHtml(row.dailyReview?.decisionAr || row.status)}</span></div>
      <div class="rec-prices">
        <div class="price-box"><small>سعر التحويل</small><b>${fmt(row.conversionReferencePrice, 4)}</b></div>
        <div class="price-box"><small>السعر الحالي</small><b>${fmt(row.currentPrice, 4)}</b></div>
        <div class="price-box"><small>العائد منذ التحويل</small><b>${pct(row.unrealizedReturnPct)}</b></div>
        <div class="price-box"><small>المسافة للقمة</small><b>${pct(row.distanceToHistoricalHighPct)}</b></div>
      </div>
      <div class="execution-rule"><b>لماذا؟</b> ${escapeHtml((row.dailyReview?.whyAr || []).join(' '))}</div>
      <div class="execution-rule"><b>ما الذي تغير منذ أمس؟</b> ${escapeHtml((row.dailyReview?.changedSinceYesterdayAr || []).join(' ') || 'لا تغير جوهري.')}</div>
    </article>`).join('') : '<div class="empty">لا توجد مراكز استثمارية محولة نشطة حاليًا</div>';
    $('bridgeAlerts').innerHTML = (bridge.alerts || []).length ? bridge.alerts.map(row => `<div class="check-item"><span>${escapeHtml(row.ticker || 'عام')} — ${escapeHtml(row.textAr)}</span><b>${escapeHtml(row.priority)}</b></div>`).join('') : '<div class="empty">لا توجد تنبيهات جوهرية.</div>';
  }

  async function load() {
    $('refreshButton').disabled = true;
    try {
      const [current, market, bridgeResult, historical, historicalCurrent] = await Promise.all([
        fetchJson(URLS.current),
        fetchJson(URLS.market),
        fetchJson(URLS.bridge).catch(() => null),
        fetchJson(URLS.historical).catch(() => null),
        fetchJson(URLS.historicalCurrent).catch(() => null),
      ]);
      state.current = current;
      state.market = Array.isArray(market.rows) ? market.rows : [];
      state.bridge = bridgeResult;
      state.historical = historical;
      state.historicalCurrent = historicalCurrent;
      renderHeader();
      renderScores();
      renderSession();
      renderRecommendations();
      renderEvidence();
      renderHealth();
      renderMarket();
      renderPortfolio();
      renderInvestmentBridge();
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
