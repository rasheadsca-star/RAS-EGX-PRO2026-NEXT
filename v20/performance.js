(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[ch]));
  const numeric = value => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const num = (value, digits = 2) => {
    const n = numeric(value);
    return n === null ? '—' : n.toLocaleString('ar-EG', { maximumFractionDigits: digits });
  };
  const pct = value => numeric(value) === null ? '—' : `${num(value, 2)}%`;
  const signedClass = value => numeric(value) > 0 ? 'performance-positive' : numeric(value) < 0 ? 'performance-negative' : '';

  const classAr = value => ({
    HISTORICAL_BACKTEST: 'اختبار تاريخي',
    WALK_FORWARD_INTERNAL: 'Walk-forward داخلي',
    DEVELOPMENT_OOS: 'Development OOS',
    REUSED_BENCHMARK_NOT_INDEPENDENT: 'Benchmark معاد الاستخدام — غير مستقل',
    LIVE_FORWARD: 'Live Forward',
    LIVE_FORWARD_SHADOW: 'Native Shadow Forward'
  }[value] || value || '—');

  const titleAr = id => ({
    V16_FIXED_BASKET_3: 'V16 — سلة ثابتة 3 أسهم',
    V16_FIXED_BASKET_4: 'V16 — سلة ثابتة 4 أسهم',
    V16_FIXED_BASKET_5: 'V16 — سلة ثابتة 5 أسهم',
    V16_BLOCKED_WALK_FORWARD: 'V16 — مرجع Walk-forward',
    V19_V6_DEVELOPMENT_OOS: 'V19 V6 — Development OOS',
    V19_V6_REUSED_BENCHMARK: 'V19 V6 — Reused Benchmark',
    V20_LIVE_FORWARD_TRACKING: 'V20 — التتبع الأمامي الحي',
    V20_FULL_MARKET_NATIVE_FORWARD_SHADOW: 'V20 Native — التتبع الأمامي المستقل'
  }[id] || id || 'دليل أداء');

  const independenceAr = value => ({
    NOT_ESTABLISHED_BY_SOURCE: 'الاستقلالية غير مثبتة بالمصدر',
    INTERNAL_WALK_FORWARD_SOURCE_DOES_NOT_CLAIM_FRESH_EXTERNAL_HOLDOUT: 'Walk-forward داخلي — ليس Holdout خارجيًا حديثًا',
    NOT_FRESH_INDEPENDENT: 'ليس دليلًا مستقلًا حديثًا',
    EXPLICITLY_NOT_FRESH_INDEPENDENT: 'غير مستقل صراحةً',
    POINT_IN_TIME_FORWARD_TRACKING: 'تتبع أمامي Point-in-time',
    METHOD_FREEZE_BASELINE_ONLY_NO_FRESH_FORWARD_SAMPLE: 'Baseline تثبيت المنهج — لا توجد عينة Forward مستقلة بعد',
    POINT_IN_TIME_POST_FREEZE_FORWARD_EVIDENCE_EXISTS: 'توجد عينات Point-in-time بعد تثبيت المنهج'
  }[value] || value || '—');

  const roleAr = value => ({
    ACTIVE_CHAMPION_REFERENCE: 'مرجع Champion الحالي',
    SHADOW_CHALLENGER: 'Challenger بحثي فقط',
    CURRENT_FORWARD_EVIDENCE: 'دليل Forward حالي',
    SHADOW_CHALLENGER_FORWARD_EVIDENCE: 'دليل Forward للـNative Challenger — بحثي فقط'
  }[value] || value || '—');

  const v18MissingAr = value => ({
    sourceArtifact: 'ملف مصدر V18 قابل لإعادة الإنتاج',
    tradeDefinition: 'تعريف الصفقة',
    signalUniverse: 'نطاق الإشارات / الأسهم',
    holdingPeriod: 'فترة الاحتفاظ',
    inSampleDefinition: 'تعريف In-Sample',
    outOfSampleDefinition: 'تعريف Out-of-Sample',
    walkForwardDefinition: 'تعريف Walk-forward',
    multiHorizonDefinition: 'تعريف Multi-horizon',
    entryTiming: 'توقيت الدخول',
    transactionCosts: 'تكاليف التداول',
    overlapAndPortfolioCompounding: 'تداخل المراكز وتجميع عائد المحفظة',
    sameCandleAmbiguityPolicy: 'سياسة Target/Stop داخل نفس الشمعة',
    independentHoldoutDefinition: 'تعريف Independent Holdout'
  }[value] || value);

  async function loadJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  function metric(label, value, css = '') {
    return `<div class="performance-metric"><span>${esc(label)}</span><strong class="${esc(css)}">${esc(value)}</strong></div>`;
  }

  function renderMetricEntry(entry) {
    const m = entry.metrics || {};
    return [
      metric('الجلسات', num(m.sessions, 0)),
      metric('متوسط صافي العائد / جلسة', pct(m.averageNetReturnPct), signedClass(m.averageNetReturnPct)),
      metric('نسبة الجلسات الرابحة', pct(m.sessionWinRatePct)),
      metric('Profit Factor', num(m.profitFactor, 3)),
      metric('العائد التراكمي', pct(m.compoundedNetReturnPct), signedClass(m.compoundedNetReturnPct)),
      metric('أقصى Drawdown', pct(m.maximumDrawdownPct), 'performance-negative')
    ].join('');
  }

  function renderForwardEntry(entry) {
    const f = entry.forwardState || {};
    return [
      metric('الإشارات', num(f.signalCount, 0)),
      metric('التقييمات', num(f.evaluationCount, 0)),
      metric('Resolved', num(f.resolvedCount, 0)),
      metric('Pending', num(f.pendingCount, 0)),
      metric('Ambiguous', num(f.ambiguousCount, 0)),
      metric('العائد', Number(f.resolvedCount || 0) > 0 ? 'راجع النتائج المحسومة منفصلة' : 'لا يوجد عائد محسوم بعد')
    ].join('');
  }

  function renderNativeShadowEntry(entry) {
    const f = entry.forwardState || {};
    const min = Number(entry.governance?.requiresMinimumIndependentResolvedSessions || 30);
    const independent = Number(f.independentForwardSessionCount || 0);
    const ready = independent >= min;
    const horizons = Array.isArray(f.horizonsSessions) ? f.horizonsSessions.join(' / ') : '1 / 3 / 5 / 10 / 20';
    return [
      metric('جلسات Canonical', num(f.canonicalSessionCount, 0)),
      metric('عينات Forward مستقلة', `${num(independent, 0)} / ${num(min, 0)}`),
      metric('تقييمات مستقلة محسومة', num(f.independentResolvedEvaluationCount, 0)),
      metric('Pending', num(f.pendingCount, 0)),
      metric('Horizons', horizons),
      metric('Performance Review', ready ? 'العينة بلغت الحد الأدنى للمراجعة' : 'غير جاهز — لا Performance claim')
    ].join('');
  }

  function renderEntry(entry) {
    const card = document.createElement('article');
    const isReused = entry.evidenceClass === 'REUSED_BENCHMARK_NOT_INDEPENDENT';
    const isDevelopment = entry.evidenceClass === 'DEVELOPMENT_OOS';
    const isForward = entry.evidenceClass === 'LIVE_FORWARD';
    const isNativeShadow = entry.evidenceClass === 'LIVE_FORWARD_SHADOW';
    card.dataset.evidenceId = entry.evidenceId || '';
    card.dataset.evidenceClass = entry.evidenceClass || '';
    card.className = `performance-card${isReused ? ' performance-card-warning' : ''}${isDevelopment ? ' performance-card-development' : ''}${isForward ? ' performance-card-forward' : ''}${isNativeShadow ? ' performance-card-forward performance-card-native-shadow' : ''}`;

    const caveats = (entry.caveats || []).map(item => `<li>${esc(item)}</li>`).join('');
    const fresh = entry.independence?.freshIndependentEvidence;
    const independenceClass = fresh === true ? 'performance-trust-good' : fresh === false ? 'performance-trust-warn' : 'performance-trust-neutral';
    const independenceText = independenceAr(entry.independence?.status);
    const promotionBadge = entry.promotionEligible === false ? '<span class="performance-badge performance-badge-blocked">غير صالح كدليل ترقية</span>' : '';
    const freezeBadge = isNativeShadow ? '<span class="performance-badge performance-trust-neutral">Method Freeze: 13 أغسطس 2026</span>' : '';

    card.innerHTML = `
      <div class="performance-card-head">
        <div>
          <span class="performance-class">${esc(classAr(entry.evidenceClass))}</span>
          <h3>${esc(titleAr(entry.evidenceId))}</h3>
          <p>${esc(roleAr(entry.role))}</p>
        </div>
        <div class="performance-card-badges">
          <span class="performance-badge ${independenceClass}">${esc(independenceText)}</span>
          ${freezeBadge}
          ${promotionBadge}
        </div>
      </div>
      <div class="performance-metrics">${isNativeShadow ? renderNativeShadowEntry(entry) : isForward ? renderForwardEntry(entry) : renderMetricEntry(entry)}</div>
      <div class="performance-evidence-meta">
        <span>المصدر: <b>${esc(entry.source || '—')}</b></span>
        <span>الاستخدام: <b>${esc(entry.decisionUse || '—')}</b></span>
      </div>
      ${isNativeShadow ? '<div class="native-shadow-guard"><strong>Shadow Forward فقط</strong><span>Baseline جلسة تثبيت المنهج لا تُحسب عينة مستقلة. لا ترقية، لا Execution، ولا رقم عائد قبل وجود نتائج Forward حقيقية.</span></div>' : ''}
      ${caveats ? `<details class="performance-caveats"><summary>التحفظات والمنهجية</summary><ul>${caveats}</ul></details>` : ''}`;
    return card;
  }

  function renderV18Audit(v18) {
    const host = $('performanceV18Note');
    if (!host) return;
    const counts = Array.isArray(v18.observedTradeCounts) ? v18.observedTradeCounts : [];
    const missing = Array.isArray(v18.missingDefinitions) ? v18.missingDefinitions : [];
    const accepted = v18.acceptedForPerformanceClaims === true && v18.reproducible === true;
    const statusText = accepted ? 'مقبول بعد التدقيق' : 'محجوب عن ادعاءات الأداء';
    const statusClass = accepted ? 'good' : 'blocked';
    const sourceText = v18.sourceArtifactAvailable === true ? 'المصدر متاح' : 'المصدر القابل لإعادة الإنتاج غير متاح';
    const countChips = counts.length
      ? counts.map(value => `<span class="v18-count-chip">${esc(num(value, 0))} صفقة</span>`).join('')
      : '<span class="v18-count-chip">لا توجد Claims مسجلة</span>';
    const missingList = missing.length
      ? missing.slice(0, 8).map(value => `<li>${esc(v18MissingAr(value))}</li>`).join('')
      : '<li>لا توجد تعريفات ناقصة مسجلة.</li>';

    host.innerHTML = `
      <div class="v18-audit-head">
        <div>
          <span class="eyebrow">V18 Performance Audit</span>
          <h3>أرقام V18 لا تدخل سجل الأداء تلقائيًا</h3>
          <p>يتم فصل تجربة V18 التحليلية والـUI عن قبول مطالبات الأداء. أي رقم تاريخي يحتاج مصدرًا قابلًا لإعادة الإنتاج وتعريفًا واضحًا للصفقة والـOOS والـWalk-forward قبل استخدامه.</p>
        </div>
        <span class="v18-audit-status ${statusClass}">${esc(statusText)}</span>
      </div>
      <div class="v18-audit-grid">
        <div class="v18-audit-cell"><span>Claims المتعارضة</span><div class="v18-counts">${countChips}</div><small>للتدقيق فقط — ليست Performance Evidence.</small></div>
        <div class="v18-audit-cell"><span>قابلية إعادة الإنتاج</span><strong>${esc(sourceText)}</strong><small>Audit status: ${esc(v18.status || '—')}</small></div>
        <div class="v18-audit-cell"><span>اكتمال التعريفات</span><strong>${esc(pct(v18.definitionCoveragePct))}</strong><small>${esc(num(missing.length, 0))} تعريفات/متطلبات ما زالت ناقصة</small></div>
      </div>
      <details class="v18-audit-details" ${accepted ? '' : 'open'}>
        <summary>ما المطلوب قبل قبول أداء V18؟</summary>
        <ul>${missingList}</ul>
        <p>حتى إغلاق التدقيق: V18 لا يضبط V20 Score، لا يفتح Execution Gate، لا يغيّر Champion، ولا يرقّي Challenger.</p>
      </details>`;
  }

  async function init() {
    const loading = $('performanceLoading');
    const error = $('performanceError');
    try {
      const registry = await loadJson('../data/v20/performance-evidence-registry.json');
      if (
        registry.policy?.singleHeadlinePerformanceMetricAllowed !== false ||
        registry.policy?.crossEvidenceAggregationAllowed !== false ||
        registry.policy?.historicalAndForwardEvidenceMustRemainSeparate !== true ||
        registry.policy?.v18AuditRequired !== true ||
        registry.policy?.nativeShadowForwardMustRemainSeparate !== true ||
        registry.policy?.nativeFreezeBaselineCannotCountAsIndependentForward !== true ||
        registry.policy?.nativeSameSessionRevisionsCannotIncreaseSampleCount !== true ||
        registry.policy?.nativeForwardCannotPromoteAutomatically !== true
      ) throw new Error('Performance evidence separation/audit policy is not active');

      $('performanceEvidenceCount').textContent = num(registry.summary?.evidenceEntryCount, 0);
      $('performanceForwardState').textContent = Number(registry.summary?.forwardResolvedCount || 0) > 0
        ? `${num(registry.summary.forwardResolvedCount, 0)} محسوم / ${num(registry.summary.forwardPendingCount, 0)} معلق`
        : `${num(registry.summary?.forwardPendingCount, 0)} تقييمات معلقة — لا عائد Forward محسوم`;
      $('performancePolicyNote').textContent = `لا يوجد رقم أداء موحد: كل Evidence Class منفصلة. Native Shadow حاليًا ${num(registry.summary?.nativeForwardIndependentSessionCount,0)} جلسة مستقلة، وحالة ${registry.summary?.nativeForwardStatus === 'METHOD_FREEZE_BASELINE_ONLY' ? 'Baseline تثبيت المنهج فقط' : 'Forward tracking بعد التثبيت'}.`;

      const grid = $('performanceGrid');
      grid.innerHTML = '';
      for (const entry of registry.entries || []) grid.appendChild(renderEntry(entry));
      renderV18Audit(registry.externalReferences?.v18 || {});

      loading.classList.add('hidden');
      $('performanceContent').classList.remove('hidden');
    } catch (err) {
      loading.classList.add('hidden');
      error.classList.remove('hidden');
      error.textContent = `تعذر تحميل سجل الأداء: ${err.message}`;
    }
  }

  init();
})();