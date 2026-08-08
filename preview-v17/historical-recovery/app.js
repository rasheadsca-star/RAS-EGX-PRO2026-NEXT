'use strict';
(() => {
  const state = { bottom: [], recovery: [], sort: { bottom: { key: 'metrics.distanceFromAvailableWindowAdjustedLowPct', direction: 1 }, recovery: { key: 'recoveryScore', direction: -1 } } };
  const $ = id => document.getElementById(id);
  const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
  const fmt = (value, reason = 'البيانات غير متاحة للفترة المطلوبة') => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : `غير متاح — ${reason}`;
  const escapeHtml = value => String(value ?? 'غير متاح').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stageClass = stage => ({ BOTTOMING: 'stage-bottom', EARLY_RECOVERY: 'stage-early', RECOVERY_CONFIRMED: 'stage-confirmed' }[stage] || 'stage-neutral');
  function filteredSorted(type) {
    const query = $('filter').value.trim().toLowerCase(); const sort = state.sort[type];
    return state[type].filter(row => !query || `${row.displayName} ${row.companyNameAr || ''} ${row.companyNameEn || ''} ${row.symbol} ${row.bottomClassificationAr} ${row.recoveryStageAr} ${(row.reasonsAr || []).join(' ')}`.toLowerCase().includes(query)).sort((a, b) => {
      const av = valueAt(a, sort.key); const bv = valueAt(b, sort.key);
      if (typeof av === 'string') return av.localeCompare(bv, 'ar') * sort.direction;
      return ((Number(av) || -Infinity) - (Number(bv) || -Infinity)) * sort.direction;
    });
  }
  function common(row) { return `<td class="share-name">${escapeHtml(row.displayName)}</td><td class="ticker" dir="ltr">${escapeHtml(row.symbol)}</td>`; }
  function renderBottom() {
    $('bottomRows').innerHTML = filteredSorted('bottom').map(row => `<tr class="bottom-${row.bottomClassification.toLowerCase()}">${common(row)}<td>${fmt(row.metrics.availableWindowAdjustedHigh)}</td><td>${fmt(row.metrics.currentAdjustedPrice)}</td><td>${fmt(row.metrics.drawdownFromAvailableWindowAdjustedHighPct)}٪</td><td>${fmt(row.metrics.availableWindowAdjustedLow)}</td><td>${fmt(row.metrics.distanceFromAvailableWindowAdjustedLowPct)}٪</td><td><span class="stage">${escapeHtml(row.bottomClassificationAr)}</span></td><td>${fmt(row.metrics.horizons?.week52?.drawdownFromHighPct, row.metrics.horizons?.week52?.unavailableReason === 'INSUFFICIENT_52_WEEK_COVERAGE' ? 'تغطية 52 أسبوعًا غير مكتملة' : undefined)}</td><td>${fmt(row.metrics.horizons?.week52?.distanceFromLowPct, row.metrics.horizons?.week52?.unavailableReason === 'INSUFFICIENT_52_WEEK_COVERAGE' ? 'تغطية 52 أسبوعًا غير مكتملة' : undefined)}</td><td>${fmt(row.metrics.rsi14)}</td><td><span class="stage ${stageClass(row.recoveryStage)}">${escapeHtml(row.recoveryStageAr)}</span></td><td>${fmt(row.dataConfidence)}٪</td></tr>`).join('');
  }
  function renderRecovery() {
    $('recoveryRows').innerHTML = filteredSorted('recovery').map(row => `<tr>${common(row)}<td>${fmt(row.metrics.availableWindowAdjustedHigh)}</td><td>${fmt(row.metrics.currentAdjustedPrice)}</td><td>${fmt(row.metrics.drawdownFromAvailableWindowAdjustedHighPct)}٪</td><td>${fmt(row.metrics.availableWindowAdjustedLow)}</td><td>${fmt(row.metrics.distanceFromAvailableWindowAdjustedLowPct)}٪</td><td>${escapeHtml(row.bottomClassificationAr)}</td><td>${fmt(row.metrics.rsi14)}</td><td>${fmt(row.strengthScore)}</td><td>${fmt(row.recoveryScore)}</td><td><span class="stage ${stageClass(row.recoveryStage)}">${escapeHtml(row.recoveryStageAr)}</span></td><td>${fmt(row.dataConfidence)}٪</td><td class="reasons">${escapeHtml((row.reasonsAr || ['لا توجد أسباب مترجمة']).join(' · '))}</td></tr>`).join('');
  }
  function render() { renderBottom(); renderRecovery(); }
  async function load() {
    try {
      const response = await fetch(`../../data/v17/historical-recovery/current.json?v=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`تعذر تحميل الملف، رمز الاستجابة ${response.status}`);
      const data = await response.json(); state.bottom = data.bottomUniverse || []; state.recovery = data.topRecoveryOpportunities || [];
      const cards = data.summary.dashboardCounts || {}; $('scanned').textContent = fmt(data.summary.stocksScanned); $('validData').textContent = fmt(data.summary.validDataStocks); $('review').textContent = fmt(data.summary.quarantinedOrDataReview); $('extremeBottom').textContent = fmt(cards.extremeBottom || 0); $('nearBottom').textContent = fmt(cards.nearBottom || 0); $('bottomZone').textContent = fmt(cards.bottomZone || 0); $('aboveBottom').textContent = fmt(cards.aboveBottomZone || 0); $('noRecovery').textContent = fmt(cards.noRecovery || 0); $('bottoming').textContent = fmt(cards.bottoming || 0); $('early').textContent = fmt(cards.earlyRecovery || 0); $('confirmed').textContent = fmt(cards.confirmedRecovery || 0); $('extended').textContent = fmt(cards.movedAwayFromLow || 0); $('opportunities').textContent = fmt(cards.topRecoveryOpportunities || 0);
      $('status').textContent = data.generatedAt ? `آخر تحديث محلي: ${new Date(data.generatedAt).toLocaleString('ar-EG')}` : 'لم يتم إنشاء النتائج بعد'; render();
    } catch (error) { $('status').textContent = `تعذر تحميل نتائج النموذج: ${error.message}`; }
  }
  document.querySelectorAll('table[data-table] th[data-key]').forEach(th => th.addEventListener('click', () => { const type = th.closest('table').dataset.table; const sort = state.sort[type]; sort.direction = sort.key === th.dataset.key ? -sort.direction : 1; sort.key = th.dataset.key; render(); }));
  $('filter').addEventListener('input', render); load();
})();
