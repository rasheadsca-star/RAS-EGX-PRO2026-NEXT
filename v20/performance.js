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
    LIVE_FORWARD: 'Live Forward'
  }[value] || value || '—');

  const titleAr = id => ({
    V16_FIXED_BASKET_3: 'V16 — سلة ثابتة 3 أسهم',
    V16_FIXED_BASKET_4: 'V16 — سلة ثابتة 4 أسهم',
    V16_FIXED_BASKET_5: 'V16 — سلة ثابتة 5 أسهم',
    V16_BLOCKED_WALK_FORWARD: 'V16 — مرجع Walk-forward',
    V19_V6_DEVELOPMENT_OOS: 'V19 V6 — Development OOS',
    V19_V6_REUSED_BENCHMARK: 'V19 V6 — Reused Benchmark',
    V20_LIVE_FORWARD_TRACKING: 'V20 — التتبع الأمامي الحي'
  }[id] || id || 'دليل أداء');

  const independenceAr = value => ({
    NOT_ESTABLISHED_BY_SOURCE: 'الاستقلالية غير مثبتة بالمصدر',
    INTERNAL_WALK_FORWARD_SOURCE_DOES_NOT_CLAIM_FRESH_EXTERNAL_HOLDOUT: 'Walk-forward داخلي — ليس Holdout خارجيًا حديثًا',
    NOT_FRESH_INDEPENDENT: 'ليس دليلًا مستقلًا حديثًا',
    EXPLICITLY_NOT_FRESH_INDEPENDENT: 'غير مستقل صراحةً',
    POINT_IN_TIME_FORWARD_TRACKING: 'تتبع أمامي Point-in-time'
  }[value] || value || '—');

  const roleAr = value => ({
    ACTIVE_CHAMPION_REFERENCE: 'مرجع Champion الحالي',
    SHADOW_CHALLENGER: 'Challenger بحثي فقط',
    CURRENT_FORWARD_EVIDENCE: 'دليل Forward حالي'
  }[value] || value || '—');

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

  function renderEntry(entry) {
    const card = document.createElement('article');
    const isReused = entry.evidenceClass === 'REUSED_BENCHMARK_NOT_INDEPENDENT';
    const isDevelopment = entry.evidenceClass === 'DEVELOPMENT_OOS';
    const isForward = entry.evidenceClass === 'LIVE_FORWARD';
    card.className = `performance-card${isReused ? ' performance-card-warning' : ''}${isDevelopment ? ' performance-card-development' : ''}${isForward ? ' performance-card-forward' : ''}`;

    const caveats = (entry.caveats || []).map(item => `<li>${esc(item)}</li>`).join('');
    const fresh = entry.independence?.freshIndependentEvidence;
    const independenceClass = fresh === true ? 'performance-trust-good' : fresh === false ? 'performance-trust-warn' : 'performance-trust-neutral';
    const independenceText = independenceAr(entry.independence?.status);
    const promotionBadge = entry.promotionEligible === false ? '<span class="performance-badge performance-badge-blocked">غير صالح كدليل ترقية</span>' : '';

    card.innerHTML = `
      <div class="performance-card-head">
        <div>
          <span class="performance-class">${esc(classAr(entry.evidenceClass))}</span>
          <h3>${esc(titleAr(entry.evidenceId))}</h3>
          <p>${esc(roleAr(entry.role))}</p>
        </div>
        <div class="performance-card-badges">
          <span class="performance-badge ${independenceClass}">${esc(independenceText)}</span>
          ${promotionBadge}
        </div>
      </div>
      <div class="performance-metrics">${isForward ? renderForwardEntry(entry) : renderMetricEntry(entry)}</div>
      <div class="performance-evidence-meta">
        <span>المصدر: <b>${esc(entry.source || '—')}</b></span>
        <span>الاستخدام: <b>${esc(entry.decisionUse || '—')}</b></span>
      </div>
      ${caveats ? `<details class="performance-caveats"><summary>التحفظات والمنهجية</summary><ul>${caveats}</ul></details>` : ''}`;
    return card;
  }

  async function init() {
    const loading = $('performanceLoading');
    const error = $('performanceError');
    try {
      const registry = await loadJson('../data/v20/performance-evidence-registry.json');
      if (
        registry.policy?.singleHeadlinePerformanceMetricAllowed !== false ||
        registry.policy?.crossEvidenceAggregationAllowed !== false ||
        registry.policy?.historicalAndForwardEvidenceMustRemainSeparate !== true
      ) throw new Error('Performance evidence separation policy is not active');

      $('performanceEvidenceCount').textContent = num(registry.summary?.evidenceEntryCount, 0);
      $('performanceForwardState').textContent = Number(registry.summary?.forwardResolvedCount || 0) > 0
        ? `${num(registry.summary.forwardResolvedCount, 0)} محسوم / ${num(registry.summary.forwardPendingCount, 0)} معلق`
        : `${num(registry.summary?.forwardPendingCount, 0)} تقييمات معلقة — لا عائد Forward محسوم`;
      $('performancePolicyNote').textContent = 'لا يوجد رقم أداء موحد: Historical وWalk-forward وDevelopment وReused Benchmark وLive Forward معروضة كأدلة منفصلة.';

      const grid = $('performanceGrid');
      grid.innerHTML = '';
      for (const entry of registry.entries || []) grid.appendChild(renderEntry(entry));

      const v18 = registry.externalReferences?.v18 || {};
      $('performanceV18Note').textContent = v18.acceptedForPerformanceClaims === false
        ? 'V18: مطالبات الأداء غير مقبولة داخل V20 حتى تتوفر مادة قابلة للتدقيق وتعريفات متصالحة.'
        : 'V18: توجد أدلة أداء مقبولة.';

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
