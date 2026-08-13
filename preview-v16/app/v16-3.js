'use strict';
(() => {
  const URLS = {
    regime: '../../data/stable/v16-market-regime.json',
    live: '../../data/stable/v16-live-evidence.json',
    official: '../../data/stable/v16-official-disclosures.json',
    fundamentals: '../../data/stable/v16-fundamental-analysis.json',
    correlation: '../../data/stable/v16-correlation-risk.json',
    alerts: '../../data/stable/v16-alerts.json',
    update: '../../data/stable/v15-update-status.json'
  };
  const state = { regime: null, live: null, official: null, fundamentals: null, correlation: null, alerts: null, update: null };
  const $ = id => document.getElementById(id);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 1) => number(value) === null ? '—' : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits });
  const pct = (value, digits = 1) => number(value) === null ? '—' : `${fmt(value, digits)}%`;
  const escapeHtml = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  async function json(url) {
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch { return null; }
  }
  function cls(value) {
    if (['RISK_ON', 'PROFESSIONAL_EVIDENCE', 'ACCEPTED'].includes(value)) return 'good';
    if (['RISK_OFF', 'HIGH_VOLATILITY', 'REJECTED'].includes(value)) return 'bad';
    return 'warn';
  }
  function metric(label, value, detail = '') {
    return `<div class="v163-metric"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b>${detail ? `<div class="v163-version">${escapeHtml(detail)}</div>` : ''}</div>`;
  }
  function progress(label, value) {
    const safe = Math.max(0, Math.min(100, number(value) || 0));
    return `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px"><span>${escapeHtml(label)}</span><b>${fmt(safe, 0)}%</b></div><div class="v163-progress"><i style="width:${safe}%"></i></div></div>`;
  }
  function updateVersion() {
    document.title = document.title.replace(/V16(?:\.1)?/g, 'V16.3');
    document.querySelectorAll('h1,meta[name="description"]').forEach(element => {
      if (element.tagName === 'META') element.content = element.content.replace(/V16(?:\.1)?/g, 'V16.3');
      else element.innerHTML = element.innerHTML.replace(/V16(?:\.1)?/g, 'V16.3');
    });
    const brand = document.querySelector('.brand > div:last-child');
    if (brand && !brand.querySelector('.v163-version')) brand.insertAdjacentHTML('beforeend', '<div class="v163-version">V16.3 Professional Pilot + V16.9 Primary Basket</div>');
  }
  function injectShell() {
    const hero = document.querySelector('#view-dashboard .hero-grid');
    if (hero && !$('marketRegimeCard')) hero.insertAdjacentHTML('beforebegin', `
      <div class="v163-grid" id="v163DashboardGrid">
        <article class="v163-card wide" id="marketRegimeCard"><div class="v163-empty">جارٍ احتساب حالة السوق…</div></article>
        <article class="v163-card" id="releaseStatusCard"><div class="v163-empty">جارٍ قراءة حالة الإصدار…</div></article>
      </div>`);
    const fundamentalsView = $('view-fundamentals');
    if (fundamentalsView && !$('officialDisclosureCard')) fundamentalsView.insertAdjacentHTML('afterbegin', `
      <div class="v163-grid">
        <article class="v163-card wide" id="financialCoverageCard"><div class="v163-empty">جارٍ قراءة التغطية المالية…</div></article>
        <article class="v163-card" id="officialDisclosureCard"><div class="v163-empty">جارٍ فحص الإفصاحات الرسمية…</div></article>
      </div>`);
    const evidenceView = $('view-evidence');
    if (evidenceView && !$('liveEvidenceV162')) evidenceView.insertAdjacentHTML('afterbegin', `
      <div class="v163-grid">
        <article class="v163-card wide" id="liveEvidenceV162"><div class="v163-empty">جارٍ بناء السجل الحي المتقدم…</div></article>
        <article class="v163-card" id="calibrationCard"><div class="v163-empty">جارٍ احتساب معايرة الاحتمالات…</div></article>
      </div>`);
    const portfolioView = $('view-portfolio');
    if (portfolioView && !$('correlationRiskCard')) portfolioView.insertAdjacentHTML('afterbegin', `
      <div class="v163-grid">
        <article class="v163-card wide" id="correlationRiskCard"><div class="v163-empty">جارٍ احتساب الارتباط ومخاطر التركّز…</div></article>
        <article class="v163-card" id="portfolioStressCard"><div class="v163-empty">جارٍ إعداد اختبارات الضغط…</div></article>
      </div>`);
    const topActions = document.querySelector('.top-actions');
    if (topActions && !$('alertsButton')) topActions.insertAdjacentHTML('beforeend', '<button class="btn v163-alert-button" id="alertsButton" type="button">التنبيهات<span class="v163-alert-count" id="alertsCount">0</span></button>');
    if (!$('v163AlertDrawer')) document.body.insertAdjacentHTML('beforeend', `
      <aside class="v163-drawer" id="v163AlertDrawer" aria-hidden="true">
        <div class="v163-backdrop" id="alertsBackdrop"></div>
        <section class="v163-panel" role="dialog" aria-modal="true" aria-label="مركز التنبيهات">
          <header class="v163-panel-head"><div><h3>مركز التنبيهات</h3><div class="v163-version">داخل التطبيق + إشعارات متصفح محلية</div></div><button class="btn" id="closeAlertsButton" type="button">إغلاق</button></header>
          <div class="v163-alerts" id="alertsList"><div class="v163-empty">جارٍ تحميل التنبيهات…</div></div>
          <footer class="v163-actions"><button class="btn primary" id="enableBrowserNotifications" type="button">تفعيل إشعارات المتصفح</button><button class="btn" id="markAlertsRead" type="button">تحديد الكل كمقروء</button></footer>
        </section>
      </aside>`);
  }
  function renderRegime() {
    const box = $('marketRegimeCard');
    const data = state.regime;
    if (!box) return;
    if (!data) { box.innerHTML = '<div class="v163-empty">لم يتم توليد حالة السوق بعد.</div>'; return; }
    const m = data.metrics || {};
    box.innerHTML = `<div class="v163-head"><div><h3>محرك حالة السوق V16.2</h3><p>قرار المخاطرة مبني على اتساع السوق والاتجاه والتقلب، وليس على مؤشر واحد.</p></div><span class="v163-pill ${cls(data.regime)}">${escapeHtml(data.labelAr || data.regime)}</span></div>
      <div class="v163-score-band"><div class="v163-score-circle" style="--score-deg:${Math.max(0, Math.min(100, data.score || 0)) * 3.6}deg"><b>${fmt(data.score, 0)}</b></div><div style="flex:1">${progress('فوق متوسط 20 جلسة', m.aboveSma20Pct)}${progress('نسبة الأسهم الصاعدة', m.advancePct)}</div></div>
      <div class="v163-metrics" style="margin-top:12px">${metric('العائد الوسيط 20 جلسة', pct(m.medianReturn20Pct))}${metric('التقلب السنوي', pct(m.volatility20AnnualizedPct))}${metric('معامل المخاطرة', fmt(data.riskMultiplier, 2))}${metric('أقصى مخاطرة للصفقة', pct(data.maxTradeRiskPct, 2))}</div>
      <div class="v163-guidance">${escapeHtml(data.guidanceAr || '')}</div>`;
    applyRegimeRiskCap();
  }
  function applyRegimeRiskCap() {
    const cap = number(state.regime?.maxTradeRiskPct);
    const input = $('riskPctInput');
    const box = document.querySelector('.position-box');
    if (!input || cap === null) return;
    input.max = String(cap);
    if (number(input.value) > cap) { input.value = String(cap); input.dispatchEvent(new Event('input', { bubbles: true })); }
    if (box && !$('regimeRiskNotice')) box.insertAdjacentHTML('beforeend', `<div class="v163-notice" id="regimeRiskNotice">سقف المخاطرة الحالي وفق حالة السوق: <b>${pct(cap, 2)}</b> لكل صفقة.</div>`);
    else if ($('regimeRiskNotice')) $('regimeRiskNotice').innerHTML = `سقف المخاطرة الحالي وفق حالة السوق: <b>${pct(cap, 2)}</b> لكل صفقة.`;
  }
  function renderRelease() {
    const box = $('releaseStatusCard');
    const u = state.update || {};
    if (!box) return;
    const browser = u.browserTests?.status || 'PENDING';
    box.innerHTML = `<div class="v163-head"><div><h3>حالة V16.3</h3><p>Professional Pilot: لم يكتمل بعد الحد الأدنى للاعتماد المهني؛ التنفيذ اليدوي والقيود المخفضة إلزاميان.</p></div><span class="v163-pill ${u.productInterface === 'EGX_PROFESSIONAL_V16_3' ? 'good' : 'warn'}">${escapeHtml(u.productInterface || 'قيد التحديث')}</span></div>
      <div class="v163-metrics">${metric('جلسة السوق', u.sessionDate || '—')}${metric('التوصيات', fmt(u.recommendationCount, 0))}${metric('التغطية المالية', fmt(u.fundamentals?.rawCoverage, 0))}${metric('السجل الحي', fmt(u.liveEvidence?.resolvedTrades ?? u.liveResolvedTrades, 0))}</div>
      <div class="v163-browser-test" style="margin-top:13px"><i style="background:${browser === 'PASSED' ? '#48d09b' : '#ffb547'}"></i><span>اختبارات المتصفح: ${escapeHtml(browser)}</span></div>`;
  }
  function renderFinancial() {
    const data = state.fundamentals;
    const coverageBox = $('financialCoverageCard');
    const officialBox = $('officialDisclosureCard');
    if (coverageBox) {
      if (!data) coverageBox.innerHTML = '<div class="v163-empty">تقرير التحليل المالي غير متاح.</div>';
      else {
        const s = data.summary || {};
        const coverage = number(s.marketUniverse) ? (number(s.rawCoverage) || 0) / s.marketUniverse * 100 : 0;
        coverageBox.innerHTML = `<div class="v163-head"><div><h3>التغطية المالية V16.2</h3><p>قوائم معيارية مع بوابة جودة ووصف صريح لحداثة المصدر.</p></div><span class="v163-pill ${coverage >= 80 ? 'good' : coverage >= 55 ? 'warn' : 'bad'}">${pct(coverage)} من السوق</span></div>
          ${progress('الشركات المغطاة', coverage)}
          <div class="v163-metrics">${metric('الكون السوقي', fmt(s.marketUniverse, 0))}${metric('بيانات خام', fmt(s.rawCoverage, 0))}${metric('شركات مُقيّمة', fmt(s.scoredCompanies, 0))}${metric('قوائم حديثة', fmt(s.freshStatements, 0))}${metric('توصيات اليوم المغطاة', `${fmt(s.currentRecommendationFinancialCoverage, 0)}/${fmt(s.currentRecommendationCount, 0)}`)}${metric('قوائم قديمة', fmt(s.staleStatements, 0))}</div>`;
      }
    }
    if (officialBox) {
      const official = state.official;
      if (!official) officialBox.innerHTML = '<div class="v163-empty">بوابة الإفصاحات لم تعمل بعد.</div>';
      else {
        const s = official.summary || {};
        officialBox.innerHTML = `<div class="v163-head"><div><h3>الإفصاحات الرسمية</h3><p>لا يُعتمد سجل بلا رابط رسمي وفترة ونوع مراجعة.</p></div><span class="v163-pill ${s.verifiedRecords > 0 ? 'good' : 'warn'}">${fmt(s.verifiedRecords, 0)} موثق</span></div>
          <div class="v163-source-list"><div class="v163-source"><span>التغذية الرسمية</span><b>${escapeHtml(official.remoteFeed?.status || 'غير مهيأة')}</b></div><div class="v163-source"><span>قوائم مدققة</span><b>${fmt(s.auditedRecords, 0)}</b></div><div class="v163-source"><span>مرفوضة بالبوابة</span><b>${fmt(s.rejectedRecords, 0)}</b></div></div>
          <div class="v163-notice">وجود صفر سجلات موثقة لا يعني غياب التحليل المالي؛ يعني أن الأرقام الحالية ما زالت من مصدر معياري ثانوي ولا يجوز تقديمها كإفصاح رسمي.</div>`;
      }
    }
  }
  function renderLive() {
    const box = $('liveEvidenceV162');
    const cal = $('calibrationCard');
    const data = state.live;
    if (box) {
      if (!data) box.innerHTML = '<div class="v163-empty">السجل الحي المتقدم غير متاح.</div>';
      else {
        const s = data.summary || {};
        box.innerHTML = `<div class="v163-head"><div><h3>السجل الحي V16.2</h3><p>نتائج التنفيذ الفعلي منفصلة كليًا عن الاختبارات التاريخية، مع مقارنة بالسوق.</p></div><span class="v163-pill ${cls(data.evidenceTier)}">${escapeHtml(data.evidenceTier)}</span></div>
          <div class="v163-metrics">${metric('صفقات منتهية', fmt(s.resolvedTrades, 0))}${metric('نسبة النجاح', pct(s.winRatePct))}${metric('متوسط العائد الصافي', pct(s.averageNetReturnPct))}${metric('Profit Factor', fmt(s.profitFactor, 2))}${metric('أقصى تراجع', pct(s.maxDrawdownPct))}${metric('Alpha مقابل السوق', pct(s.averageAlphaVsMarketPct))}</div>
          <div class="v163-guidance">${escapeHtml(data.professionalGate?.disclosureAr || '')}</div>`;
      }
    }
    if (cal) {
      if (!data) cal.innerHTML = '<div class="v163-empty">لا توجد معايرة.</div>';
      else {
        const rows = (data.probabilityCalibration || []).filter(row => row.recommendations > 0);
        cal.innerHTML = `<div class="v163-head"><div><h3>معايرة الاحتمالات</h3><p>هل احتمال الهدف المعلن يتوافق مع النتائج الحية؟</p></div></div>${rows.length ? `<table class="v163-table"><thead><tr><th>النطاق</th><th>متوقع</th><th>فعلي</th><th>عينة</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${pct(row.predictedAveragePct)}</td><td>${pct(row.actualTargetHitPct)}</td><td>${fmt(row.resolved, 0)}</td></tr>`).join('')}</tbody></table>` : '<div class="v163-empty">تظهر المعايرة بعد انتهاء صفقات حية كافية.</div>'}`;
      }
    }
  }
  function matrixHtml(data) {
    const tickers = data?.tickers || [];
    if (!tickers.length) return '<div class="v163-empty">لا توجد مصفوفة ارتباط.</div>';
    const byTicker = new Map((data.matrix || []).map(row => [row.ticker, row.correlations || {}]));
    const header = `<div class="v163-matrix-row" style="--cols:${tickers.length}"><div class="v163-cell"></div>${tickers.map(t => `<div class="v163-cell"><b>${escapeHtml(t)}</b></div>`).join('')}</div>`;
    const rows = tickers.map(left => `<div class="v163-matrix-row" style="--cols:${tickers.length}"><div class="v163-cell"><b>${escapeHtml(left)}</b></div>${tickers.map(right => { const value = number(byTicker.get(left)?.[right]?.value); const c = value !== null && value >= .85 ? 'strong' : value !== null && value >= .7 ? 'medium' : ''; return `<div class="v163-cell ${c}">${value === null ? '—' : fmt(value, 2)}</div>`; }).join('')}</div>`).join('');
    return `<div class="v163-matrix">${header}${rows}</div>`;
  }
  function portfolioRows() {
    try { return JSON.parse(localStorage.getItem('egx-v16-professional-portfolio') || '[]') || []; } catch { return []; }
  }
  function portfolioTicker(row) { return String(row.ticker || row.symbol || '').toUpperCase(); }
  function renderCorrelation() {
    const box = $('correlationRiskCard');
    const stress = $('portfolioStressCard');
    const data = state.correlation;
    if (box) {
      if (!data) box.innerHTML = '<div class="v163-empty">تحليل الارتباط غير متاح.</div>';
      else {
        const holdings = portfolioRows();
        const holdingTickers = new Set(holdings.map(portfolioTicker).filter(Boolean));
        const activePairs = (data.highCorrelationPairs || []).filter(pair => holdingTickers.has(pair.left) && holdingTickers.has(pair.right));
        box.innerHTML = `<div class="v163-head"><div><h3>الارتباط ومخاطر المحفظة V16.3</h3><p>ارتباط عوائد 60 جلسة؛ الارتباط المرتفع يقلل فائدة التنويع.</p></div><span class="v163-pill ${activePairs.length ? 'bad' : 'good'}">${activePairs.length} زوج بالمحفظة</span></div>
          ${matrixHtml(data)}
          <div class="v163-metrics" style="margin-top:12px">${metric('أزواج مرتفعة بالقائمة', fmt(data.summary?.highCorrelationPairCount, 0))}${metric('أكبر قطاع', data.summary?.largestSector?.sector || '—')}${metric('سقف المراكز المقترح', fmt(data.summary?.suggestedMaximumPositions, 0))}${metric('سقف المخاطرة المفتوحة', pct(data.summary?.suggestedMaximumOpenRiskPct))}</div>`;
      }
    }
    if (stress) {
      if (!data) stress.innerHTML = '<div class="v163-empty">اختبارات الضغط غير متاحة.</div>';
      else stress.innerHTML = `<div class="v163-head"><div><h3>اختبارات ضغط</h3><p>تقديرات حتمية للتوعية بالمخاطر وليست توقعات.</p></div></div><div class="v163-source-list">${(data.stressScenarios || []).map(row => `<div class="v163-source"><span>${escapeHtml(row.labelAr)}</span><b class="${number(row.equalWeightPortfolioImpactPct) < -5 ? 'bad' : ''}">${pct(row.equalWeightPortfolioImpactPct)}</b></div>`).join('')}</div><div class="v163-notice">أعد حساب المخاطر بعد كل إضافة أو حذف من المحفظة. الارتباط قد يرتفع وقت الأزمات.</div>`;
    }
  }
  function renderAlerts() {
    const data = state.alerts;
    const alerts = data?.alerts || [];
    const readIds = new Set(JSON.parse(localStorage.getItem('egx-v16-3-read-alerts') || '[]'));
    const unread = alerts.filter(alert => !readIds.has(alert.id)).length;
    if ($('alertsCount')) { $('alertsCount').textContent = String(unread); $('alertsCount').style.display = unread ? 'flex' : 'none'; }
    if ($('alertsList')) $('alertsList').innerHTML = alerts.length ? alerts.map(alert => `<article class="v163-alert" data-severity="${escapeHtml(alert.severity)}"><h4>${escapeHtml(alert.titleAr)}</h4><p>${escapeHtml(alert.messageAr)}</p>${alert.actionAr ? `<footer>${escapeHtml(alert.actionAr)}</footer>` : ''}</article>`).join('') : '<div class="v163-empty">لا توجد تنبيهات حالية.</div>';
  }
  async function enableNotifications() {
    if (!('Notification' in window)) { alert('المتصفح لا يدعم الإشعارات المحلية.'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const key = `egx-v16-3-notified-${state.alerts?.generatedAt || 'current'}`;
    if (localStorage.getItem(key)) return;
    const urgent = (state.alerts?.alerts || []).filter(row => row.notificationEligible && ['CRITICAL', 'HIGH'].includes(row.severity)).slice(0, 3);
    for (const row of urgent) {
      try {
        const registration = await navigator.serviceWorker?.ready;
        if (registration) await registration.showNotification(row.titleAr, { body: row.messageAr, tag: row.id, renotify: false });
        else new Notification(row.titleAr, { body: row.messageAr, tag: row.id });
      } catch { new Notification(row.titleAr, { body: row.messageAr, tag: row.id }); }
    }
    localStorage.setItem(key, '1');
  }
  function bind() {
    $('alertsButton')?.addEventListener('click', () => { $('v163AlertDrawer')?.classList.add('open'); $('v163AlertDrawer')?.setAttribute('aria-hidden', 'false'); });
    const close = () => { $('v163AlertDrawer')?.classList.remove('open'); $('v163AlertDrawer')?.setAttribute('aria-hidden', 'true'); };
    $('closeAlertsButton')?.addEventListener('click', close);
    $('alertsBackdrop')?.addEventListener('click', close);
    $('enableBrowserNotifications')?.addEventListener('click', enableNotifications);
    $('markAlertsRead')?.addEventListener('click', () => { localStorage.setItem('egx-v16-3-read-alerts', JSON.stringify((state.alerts?.alerts || []).map(row => row.id))); renderAlerts(); });
    window.addEventListener('storage', event => { if (event.key === 'egx-v16-professional-portfolio') renderCorrelation(); });
    document.addEventListener('click', event => { if (event.target.closest('#addPortfolioBtn,#clearPortfolioBtn,[data-remove]')) setTimeout(renderCorrelation, 50); });
  }
  async function load() {
    const keys = Object.keys(URLS);
    const results = await Promise.all(keys.map(key => json(URLS[key])));
    keys.forEach((key, index) => { state[key] = results[index]; });
    renderRegime();
    renderRelease();
    renderFinancial();
    renderLive();
    renderCorrelation();
    renderAlerts();
    document.documentElement.dataset.egxVersion = '16.3';
    document.documentElement.dataset.v163Ready = 'true';
  }
  function init() {
    updateVersion();
    injectShell();
    bind();
    load();
  }
  document.addEventListener('egx:fundamentals-rendered', () => {
    injectShell();
    renderFinancial();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
