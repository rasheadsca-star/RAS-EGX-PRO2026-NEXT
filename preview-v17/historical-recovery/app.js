'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { data: null, sort: {} };
  const esc = value => String(value ?? 'غير متاح').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const fmt = (value, digits = 2) => finite(value) ? Number(value).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: digits }) : 'غير متاح';
  const pct = value => finite(value) ? `${fmt(value)}٪` : 'غير متاح';
  const dateAr = value => value ? new Date(value).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }) : 'غير متاح';
  const dateTimeAr = value => value ? new Date(value).toLocaleString('ar-EG') : 'غير متاح';
  const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? value : null;
  const horizon = row => row.horizons?.[$('horizon').value];
  const query = () => $('filter').value.trim().toLocaleLowerCase('ar');
  const selectedClassification = () => $('classification').value;
  const visible = row => {
    const matchText = !query() || `${row.companyNameAr || ''} ${row.companyNameEn || ''} ${row.ticker}`.toLocaleLowerCase('ar').includes(query());
    return matchText && (!selectedClassification() || row.classificationCode === selectedClassification());
  };
  const stockName = row => row.companyNameAr || row.companyNameEn || row.ticker;
  const identity = row => `<td data-value="${esc(stockName(row))}" class="share-name">${esc(stockName(row))}</td><td data-value="${esc(row.ticker)}" class="ticker" dir="ltr">${esc(row.ticker)}</td>`;
  const cell = (value, display = null, className = '') => `<td data-value="${esc(finite(value) ? Number(value) : value)}"${className ? ` class="${className}"` : ''}>${display ?? esc(value)}</td>`;
  const emptyRow = (columns, message = 'لا توجد نتائج تستوفي الشروط الحالية.') => `<tr class="empty-row"><td colspan="${columns}">${esc(message)}</td></tr>`;
  const badge = (text, tone = 'neutral') => `<span class="badge badge-${tone}">${esc(text)}</span>`;
  const classificationTone = code => ['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE'].includes(code) ? 'positive'
    : code === 'VALUE_TRAP_RISK' || code === 'REVIEW_REQUIRED' ? 'danger'
      : code === 'INSUFFICIENT_FINANCIAL_DATA' ? 'warning' : 'neutral';
  const sourceStatusAr = status => ({ HEALTHY: 'سليم', DEGRADED: 'متراجع', FAILED: 'متعطل', STALE: 'قديم' }[status] || 'غير متاح');
  const sourceTone = status => status === 'HEALTHY' ? 'positive' : status === 'DEGRADED' ? 'warning' : 'danger';
  const fundamentalStatus = row => row.fundamental?.fundamentalDataConfidence === 'UNAVAILABLE' ? 'البيانات المالية غير كافية'
    : row.fundamental?.fundamentalDataConfidence === 'LOW' ? 'التحليل المالي: جزئي منخفض الثقة'
      : row.fundamental?.fundamentalDataConfidence === 'MEDIUM' ? 'التحليل المالي: جزئي موثوق' : 'التحليل المالي: مكتمل';
  const fundamentalTone = row => row.fundamental?.fundamentalDataConfidence === 'HIGH' ? 'positive'
    : row.fundamental?.fundamentalDataConfidence === 'MEDIUM' ? 'neutral' : 'warning';
  const locationAr = value => value <= 10 ? 'عند قاع دورة الهبوط' : value <= 25 ? 'بالقرب من قاع دورة الهبوط' : value <= 40 ? 'داخل منطقة القاع' : 'تعافى بعيدًا عن القاع';
  const changeTypeAr = code => ({ CLASSIFICATION_UPGRADE: 'ترقية التصنيف', CLASSIFICATION_DOWNGRADE: 'خفض التصنيف', RISK_INCREASE: 'ارتفاع المخاطر', RISK_DECREASE: 'انخفاض المخاطر', TECHNICAL_CHANGE: 'تغير فني', DATA_QUALITY_IMPROVED: 'تحسن جودة البيانات', DATA_QUALITY_DETERIORATED: 'تراجع جودة البيانات', BREAK_BELOW_POST_PEAK_TROUGH: 'كسر قاع دورة الهبوط', MATERIAL_NEGATIVE_NEWS: 'خبر سلبي جوهري' }[code] || 'تغير جوهري');
  const valuationMetricAr = code => ({ P_E: 'مضاعف الربحية', P_B: 'مضاعف القيمة الدفترية', EV_EBITDA: 'قيمة المنشأة إلى الأرباح التشغيلية', DIVIDEND_YIELD_PCT: 'عائد التوزيعات' }[code] || 'مقياس تقييم');
  const historyReasonAr = reason => {
    const value = String(reason || '');
    if (value.startsWith('CORPORATE_ACTION_REVIEW_REQUIRED')) return 'إجراء رأسمالي أو انقطاع سعري يحتاج مراجعة.';
    if (value.startsWith('MISSING_ADJUSTED_CLOSE')) return 'بيانات السعر المعدل غير مكتملة.';
    if (value === 'SOURCE_RETRIEVAL_FAILED') return 'تعذر استرجاع التاريخ من المصدر.';
    if (value.includes('STALE')) return 'البيانات التاريخية غير محدثة وفق جلسات السوق.';
    if (value.includes('INSUFFICIENT')) return 'التغطية التاريخية لا تكفي للأفق المطلوب.';
    return 'تحتاج البيانات إلى مراجعة فنية قبل استخدامها.';
  };

  function populateSummary(rows) {
    const s = state.data.summary;
    $('universe').textContent = fmt(s.canonicalEquityUniverse, 0);
    $('priceCoverage').textContent = fmt(s.priceHistoryCovered, 0);
    $('historyValid').textContent = fmt(s.historicalDataValid, 0);
    $('fundamentalCoverage').textContent = fmt(s.fundamentalCoverage, 0);
    $('newsCoverage').textContent = fmt(s.newsDisclosureCoverage, 0);
    $('fullCoverage').textContent = fmt(s.fullDataCoverage, 0);
    $('partialCoverage').textContent = fmt(s.partialDataCoverage, 0);
    $('reviewCount').textContent = fmt(s.unavailableData, 0);
    $('upgradeCount').textContent = fmt(s.decisionUpgrades, 0);
    $('downgradeCount').textContent = fmt(s.decisionDowngrades, 0);
    $('criticalCount').textContent = fmt(s.criticalAlerts, 0);
    $('nearBottom').textContent = fmt(rows.filter(row => row.historicalDataQuality.status === 'VALID' && horizon(row)?.available && horizon(row).recoveryPositionPct <= 25).length, 0);
    const changed = rows.filter(row => row.decisionChanged);
    const positiveCodes = new Set(['CLASSIFICATION_UPGRADE', 'RISK_DECREASE', 'DATA_QUALITY_IMPROVED']);
    const negativeCodes = new Set(['CLASSIFICATION_DOWNGRADE', 'RISK_INCREASE', 'DATA_QUALITY_DETERIORATED', 'BREAK_BELOW_POST_PEAK_TROUGH', 'MATERIAL_NEGATIVE_NEWS']);
    $('positiveChanges').textContent = fmt(changed.filter(row => row.changeTypes?.some(code => positiveCodes.has(code))).length, 0);
    $('negativeChanges').textContent = fmt(changed.filter(row => row.changeTypes?.some(code => negativeCodes.has(code))).length, 0);
    $('materialNews').textContent = fmt(new Set(rows.flatMap(row => (row.news?.materialEvents || []).map(event => event.fingerprint))).size, 0);
    $('opportunityEntries').textContent = fmt(changed.filter(row => row.changeTypes?.includes('CLASSIFICATION_UPGRADE') && ['مرشح استثماري قوي بعد التأكيد', 'مرشح استثماري تدريجي'].includes(row.classificationAr)).length, 0);
    $('opportunityExits').textContent = fmt(changed.filter(row => row.changeTypes?.includes('CLASSIFICATION_DOWNGRADE') && ['مرشح استثماري قوي بعد التأكيد', 'مرشح استثماري تدريجي'].includes(row.previousDecisionAr)).length, 0);
    const insufficient = s.fundamentalCoverage === 0 || s.newsDisclosureCoverage === 0;
    $('coverageWarning').textContent = insufficient
      ? 'تنبيه جودة: التغطية المالية أو الإخبارية الموثقة غير متاحة حاليًا؛ لذلك لا يصدر النظام درجات استثمارية متكاملة أو مرشحين إيجابيين مصطنعين.'
      : 'توجد تغطية مالية وإخبارية موثقة، مع استمرار تطبيق بوابات المخاطر والثقة.';
  }

  function renderSourceHealth() {
    $('sourceHealth').innerHTML = state.data.sourceHealth.sources.map(source => `<article><div>${badge(sourceStatusAr(source.status), sourceTone(source.status))}</div><strong>${esc(source.labelAr)}</strong><span>التغطية: ${pct(source.coveragePct)}</span></article>`).join('');
  }

  function renderIntegrated(rows) {
    const eligible = rows.filter(visible).filter(row => ['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE', 'HIGH_RISK_RECOVERY', 'POSITIVE_WATCH'].includes(row.classificationCode))
      .sort((a, b) => (b.investmentResearchScore ?? -1) - (a.investmentResearchScore ?? -1));
    $('integratedRows').innerHTML = eligible.length ? eligible.map(row => {
      const h = horizon(row) || row.historical;
      return `<tr>${identity(row)}${cell(row.classificationAr, badge(row.classificationAr, classificationTone(row.classificationCode)))}${cell(row.investmentResearchScore, fmt(row.investmentResearchScore))}${cell(row.risk?.labelAr)}${cell(h?.currentDrawdownPct, pct(h?.currentDrawdownPct))}${cell(h?.recoveryPositionPct, pct(h?.recoveryPositionPct))}${cell(row.fundamental?.fundamentalQualityScore, fmt(row.fundamental?.fundamentalQualityScore))}${cell(row.fundamental?.valuation?.score, fmt(row.fundamental?.valuation?.score))}${cell(row.overallDataConfidence, pct(row.overallDataConfidence))}<td class="reasons">${esc([...(row.classificationReasonsAr || []), ...(row.negativesAr || [])].join(' '))}</td><td><button type="button" class="detail-button" data-detail="${esc(row.ticker)}">عرض</button></td></tr>`;
    }).join('') : emptyRow(12, 'لا توجد فرصة مكتملة الشروط حاليًا. البيانات الناقصة لا تتحول إلى درجة محايدة.');
  }

  function renderDeep(rows) {
    const deep = rows.filter(visible).filter(row => row.historicalDataQuality.status === 'VALID' && horizon(row)?.available && horizon(row).currentDrawdownPct >= 35 && horizon(row).recoveryPositionPct <= 30)
      .sort((a, b) => horizon(b).currentDrawdownPct - horizon(a).currentDrawdownPct || horizon(a).recoveryPositionPct - horizon(b).recoveryPositionPct);
    $('deepRows').innerHTML = deep.length ? deep.map(row => { const h = horizon(row); return `<tr>${identity(row)}${cell(h.high, fmt(h.high))}<td>${dateAr(h.highDate)}</td>${cell(h.current, fmt(h.current))}${cell(h.currentDrawdownPct, pct(h.currentDrawdownPct))}${cell(h.postPeakLow, fmt(h.postPeakLow))}<td>${dateAr(h.postPeakLowDate)}</td>${cell(h.recoveryPositionPct, pct(h.recoveryPositionPct))}${cell(row.technical.rsi14, fmt(row.technical.rsi14))}<td>${esc(row.technical.recoveryStageAr)}</td><td>${badge(fundamentalStatus(row), fundamentalTone(row))}</td><td><button type="button" class="detail-button" data-detail="${esc(row.ticker)}">عرض</button></td></tr>`; }).join('') : emptyRow(13);
  }

  function renderRecovery(rows) {
    const recovery = rows.filter(visible).filter(row => row.historicalDataQuality.status === 'VALID' && horizon(row)?.available && horizon(row).currentDrawdownPct >= 20 && horizon(row).recoveryPositionPct <= 40 && ['BOTTOMING', 'EARLY_RECOVERY', 'RECOVERY_CONFIRMED'].includes(row.technical.recoveryStage))
      .sort((a, b) => b.technical.recoveryScore - a.technical.recoveryScore);
    $('recoveryRows').innerHTML = recovery.length ? recovery.map(row => { const h = horizon(row); return `<tr>${identity(row)}${cell(h.currentDrawdownPct, pct(h.currentDrawdownPct))}${cell(h.recoveryPositionPct, pct(h.recoveryPositionPct))}${cell(row.technical.rsi14, fmt(row.technical.rsi14))}${cell(row.technical.strengthScore, fmt(row.technical.strengthScore))}${cell(row.technical.recoveryScore, fmt(row.technical.recoveryScore))}<td>${esc(row.technical.recoveryStageAr)}</td><td>${badge(fundamentalStatus(row), fundamentalTone(row))}</td><td>${fmt(row.fundamental?.valuation?.score)}</td></tr>`; }).join('') : emptyRow(10);
    const supported = recovery.filter(row => finite(row.fundamental?.fundamentalQualityScore) && row.fundamental.fundamentalQualityScore >= 55 && finite(row.investmentResearchScore));
    $('supportedRows').innerHTML = supported.length ? supported.map(row => `<tr>${identity(row)}<td>${fmt(row.investmentResearchScore)}</td><td>${fmt(row.technical.recoveryScore)}</td></tr>`).join('') : emptyRow(4, 'لا توجد حاليًا فرص تعافٍ ذات دعم مالي مكتمل.');
    const strongDiscount = rows.filter(visible).filter(row => finite(row.fundamental?.fundamentalQualityScore) && row.fundamental.fundamentalQualityScore >= 65 && horizon(row)?.currentDrawdownPct >= 25);
    $('strongDiscountRows').innerHTML = strongDiscount.length ? strongDiscount.map(row => `<tr>${identity(row)}<td>${fmt(row.fundamental.fundamentalQualityScore)}</td><td>${pct(horizon(row).currentDrawdownPct)}</td></tr>`).join('') : emptyRow(4, 'لا توجد تغطية مالية كافية لهذه القائمة.');
  }

  function renderBottomAndTraps(rows) {
    const bottom = rows.filter(visible).filter(row => row.historicalDataQuality.status === 'VALID' && horizon(row)?.available).sort((a, b) => horizon(a).recoveryPositionPct - horizon(b).recoveryPositionPct);
    $('bottomRows').innerHTML = bottom.length ? bottom.map(row => { const h = horizon(row); return `<tr>${identity(row)}<td>${pct(h.recoveryPositionPct)}</td><td>${pct(h.distanceAbovePostPeakLowPct)}</td><td>${pct(h.currentDrawdownPct)}</td><td>${esc(locationAr(h.recoveryPositionPct))}</td><td>${esc(row.technical.recoveryStageAr)}</td><td>${badge(row.classificationAr, classificationTone(row.classificationCode))}</td><td><button type="button" class="detail-button" data-detail="${esc(row.ticker)}">عرض</button></td></tr>`; }).join('') : emptyRow(9);
    const traps = rows.filter(visible).filter(row => row.valueTrapRisk?.classification === 'HIGH').sort((a, b) => b.valueTrapRisk.score - a.valueTrapRisk.score);
    $('valueTrapRows').innerHTML = traps.length ? traps.map(row => `<tr>${identity(row)}<td>${esc(row.valueTrapRisk.labelAr)}</td><td>${esc(row.risk.labelAr)}</td><td>${pct(horizon(row)?.currentDrawdownPct)}</td><td class="reasons">${esc((row.valueTrapRisk.reasons || []).map(reason => reason.explanationAr).join(' '))}</td></tr>`).join('') : emptyRow(6, 'لا يمكن تحديد مصائد قيمة دون بيانات مالية موثقة كافية.');
  }

  function renderChangesAndNews(rows) {
    const events = rows.flatMap(row => (row.news?.materialEvents || []).map(event => ({ row, event }))).sort((a, b) => String(b.event.eventDate).localeCompare(String(a.event.eventDate)));
    $('newsRows').innerHTML = events.length ? events.slice(0, 50).map(({ row, event }) => `<tr><td>${esc(stockName(row))} — <span dir="ltr">${esc(row.ticker)}</span></td><td class="reasons">${esc(event.summaryAr || event.explanationAr)}</td><td>${finite(event.newsImpactScore) ? fmt(event.newsImpactScore) : 'غير متاح'}</td><td>${pct(event.sourceConfidence)}</td><td>${safeUrl(event.sourceUrl) ? `<a href="${esc(event.sourceUrl)}" target="_blank" rel="noopener">المصدر</a>` : 'مرجع رسمي محفوظ'}</td></tr>`).join('') : emptyRow(5, 'لا توجد تغذية أحداث موثقة ومفعلة حاليًا؛ لا يعني ذلك عدم وجود أخبار في السوق.');
    const changes = rows.filter(visible).filter(row => row.decisionChanged);
    $('changeRows').innerHTML = changes.length ? changes.map(row => `<tr>${identity(row)}<td>${esc(row.previousDecisionAr || 'أول تقييم')}</td><td>${esc(row.classificationAr)}</td><td>${esc(row.risk?.labelAr)}</td><td>${esc((row.changeTypes || []).map(changeTypeAr).join(' · '))}</td><td>${dateTimeAr(row.changedAt)}</td><td class="reasons">${esc((row.changeReasonsAr || []).join(' '))}</td></tr>`).join('') : emptyRow(8, 'لا توجد تغيرات قرار لأن هذه أول لقطة متكاملة أو لأن الأدلة لم تتغير جوهريًا.');
    const alerts = state.data.alerts?.alerts || [];
    $('alertCenter').innerHTML = alerts.length ? alerts.slice(0, 20).map(alert => `<article class="alert alert-${String(alert.severity).toLowerCase()}"><strong>${esc(alert.severityAr)} · ${esc(alert.ticker)}</strong><span>${esc(alert.explanationAr)}</span><time>${dateTimeAr(alert.createdAt)}</time></article>`).join('') : '<p class="empty-message">لا توجد تنبيهات مادية جديدة.</p>';
  }

  function renderQuality(rows) {
    const missing = rows.filter(visible).filter(row => !['HIGH', 'MEDIUM'].includes(row.fundamental?.fundamentalDataConfidence));
    $('missingFundamentalRows').innerHTML = missing.length ? missing.map(row => `<tr>${identity(row)}<td>${esc(fundamentalStatus(row))}</td><td>${esc(row.fundamental?.latestReportingPeriod || 'غير متاح')}</td><td class="reasons">${esc((row.fundamental?.missingFields || []).length ? 'لا توجد مدخلات مالية موثقة كافية لاستكمال الأبعاد المطلوبة.' : 'تحتاج البيانات إلى تحديث أو استكمال.')}</td></tr>`).join('') : emptyRow(5);
    const review = rows.filter(visible).filter(row => row.historicalDataQuality.status !== 'VALID');
    $('historyReviewRows').innerHTML = review.length ? review.map(row => `<tr>${identity(row)}<td>${fmt(row.historicalDataQuality.sessionCount, 0)}</td><td>${dateAr(row.historicalDataQuality.coverageEnd)}</td><td class="reasons">${esc((row.historicalDataQuality.reasons || []).map(historyReasonAr).join(' '))}</td></tr>`).join('') : emptyRow(5);
  }

  function render() {
    if (!state.data) return;
    const rows = state.data.results;
    populateSummary(rows); renderSourceHealth(); renderIntegrated(rows); renderDeep(rows); renderRecovery(rows); renderBottomAndTraps(rows); renderChangesAndNews(rows); renderQuality(rows);
    bindDetails(); bindSorting();
  }

  function showDetail(ticker) {
    const row = state.data.results.find(item => item.ticker === ticker); if (!row) return;
    const h = horizon(row) || row.historical; const f = row.fundamental; const n = row.news;
    const sourceEvents = n?.materialEvents || [];
    const lastMaterialChange = row.changeReasonsAr?.[0] || 'لا توجد متغيرات جوهرية منذ أول تقييم متكامل.';
    $('detailContent').innerHTML = `<div class="detail-title"><p class="eyebrow">${esc(row.ticker)}</p><h2>${esc(stockName(row))} — <span dir="ltr">${esc(row.ticker)}</span></h2><div>${badge(row.classificationAr, classificationTone(row.classificationCode))} ${badge(`المخاطرة: ${row.risk?.labelAr || 'غير متاح'}`, 'neutral')} ${badge(`صلاحية القرار: ${row.decisionValidityAr}`, row.decisionState === 'VALID' ? 'positive' : 'warning')}</div><p>آخر مراجعة: ${dateTimeAr(row.lastReviewedAt)}</p><p>آخر متغير جوهري: ${esc(lastMaterialChange)}</p></div>
      <div class="detail-grid">
        <section><h3>الدورة التاريخية</h3><dl><dt>القمة المعدلة</dt><dd>${fmt(h?.high)} — ${dateAr(h?.highDate)}</dd><dt>قاع ما بعد القمة</dt><dd>${fmt(h?.postPeakLow)} — ${dateAr(h?.postPeakLowDate)}</dd><dt>الهبوط من القمة</dt><dd>${pct(h?.currentDrawdownPct)}</dd><dt>موضع التعافي</dt><dd>${pct(h?.recoveryPositionPct)}</dd></dl></section>
        <section><h3>الفنيات</h3><dl><dt>درجة القوة</dt><dd>${fmt(row.technical.strengthScore)}</dd><dt>درجة التعافي</dt><dd>${fmt(row.technical.recoveryScore)}</dd><dt>RSI</dt><dd>${fmt(row.technical.rsi14)}</dd><dt>EMA 20 / 50 / 200</dt><dd>${fmt(row.technical.ema20)} / ${fmt(row.technical.ema50)} / ${fmt(row.technical.ema200)}</dd><dt>زخم 5 / 20 جلسة</dt><dd>${pct(row.technical.momentum5Pct)} / ${pct(row.technical.momentum20Pct)}</dd><dt>زخم 60 / 120 جلسة</dt><dd>${pct(row.technical.momentum60Pct)} / ${pct(row.technical.momentum120Pct)}</dd><dt>توسع أحجام التداول</dt><dd>${finite(row.technical.volumeExpansionRatio) ? `${fmt(row.technical.volumeExpansionRatio)} مرة` : 'غير متاح'}</dd></dl></section>
        <section><h3>التحليل المالي</h3><p>${badge(fundamentalStatus(row), fundamentalTone(row))}</p><dl><dt>الجودة المالية</dt><dd>${fmt(f?.fundamentalQualityScore)}</dd><dt>الربحية</dt><dd>${fmt(f?.components?.profitability?.score)}</dd><dt>النمو</dt><dd>${fmt(f?.components?.growth?.score)}</dd><dt>الميزانية</dt><dd>${fmt(f?.components?.balanceSheet?.score)}</dd><dt>التدفق النقدي</dt><dd>${fmt(f?.components?.cashFlow?.score)}</dd><dt>آخر فترة</dt><dd>${dateAr(f?.latestReportingPeriod)}</dd></dl></section>
        <section><h3>التقييم والمخاطر</h3><dl><dt>درجة التقييم</dt><dd>${fmt(f?.valuation?.score)}</dd><dt>المقاييس المتاحة</dt><dd>${esc((f?.valuation?.metrics || []).filter(metric => finite(metric.value)).map(metric => `${valuationMetricAr(metric.metric)}: ${fmt(metric.value)}`).join(' · ') || 'غير متاح')}</dd><dt>المقارنة القطاعية</dt><dd>غير متاحة دون مصدر سوق موثوق وكامل.</dd><dt>المخاطرة المالية</dt><dd>${esc(row.risk?.labelAr || 'غير متاح')}</dd><dt>خطر مصيدة القيمة</dt><dd>${esc(row.valueTrapRisk?.labelAr || 'غير متاح')}</dd><dt>الثقة الكلية</dt><dd>${pct(row.overallDataConfidence)}</dd></dl></section>
        <section class="detail-wide"><h3>الأخبار والأحداث</h3>${sourceEvents.length ? sourceEvents.map(event => `<article class="event"><strong>${esc(event.summaryAr || 'حدث موثق')}</strong><p>${esc(event.explanationAr)}</p><span>الأثر: ${fmt(event.newsImpactScore)} · الثقة: ${pct(event.sourceConfidence)} · ${dateAr(event.eventDate)}</span></article>`).join('') : '<p>تغطية الأخبار الآلية غير متاحة أو لا توجد أحداث موثقة في المدخل الحالي.</p>'}</section>
        <section class="detail-wide"><h3>سجل تغير القرار</h3><p>${esc(row.previousDecisionAr || 'لا يوجد — أول تقييم متكامل')} ← ${esc(row.classificationAr)}</p><p>${esc((row.changeReasonsAr || []).join(' ') || 'لم يحدث تغير قرار بعد إنشاء اللقطة المتكاملة الأولى.')}</p></section>
        <section class="detail-wide"><h3>لماذا هذا التصنيف؟</h3><ul>${[...(row.positivesAr || []), ...(row.negativesAr || []), ...(row.classificationReasonsAr || [])].map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></section>
      </div>`;
    $('detailDialog').showModal();
  }

  function bindDetails() { document.querySelectorAll('[data-detail]').forEach(button => { button.onclick = () => showDetail(button.dataset.detail); }); }
  function bindSorting() {
    document.querySelectorAll('th[data-sort]').forEach(header => {
      header.onclick = () => {
        const table = header.closest('table'); const tbody = table.tBodies[0]; const index = [...header.parentElement.cells].indexOf(header); const key = `${table.dataset.table}:${index}`;
        const direction = state.sort[key] === 'asc' ? 'desc' : 'asc'; state.sort[key] = direction;
        const rows = [...tbody.rows].filter(row => !row.classList.contains('empty-row'));
        rows.sort((a, b) => { const av = a.cells[index]?.dataset.value ?? a.cells[index]?.textContent.trim(); const bv = b.cells[index]?.dataset.value ?? b.cells[index]?.textContent.trim(); const an = Number(av), bn = Number(bv); const result = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(av).localeCompare(String(bv), 'ar'); return direction === 'asc' ? result : -result; });
        rows.forEach(row => tbody.appendChild(row));
      };
    });
  }

  function populateClassificationFilter(rows) {
    const select = $('classification');
    const labels = [...new Map(rows.map(row => [row.classificationCode, row.classificationAr])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
    select.innerHTML = '<option value="">كل التصنيفات</option>' + labels.map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join('');
  }

  async function load() {
    try {
      const response = await fetch(`../../data/v17/historical-recovery/integrated-market.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      populateClassificationFilter(state.data.results);
      $('status').textContent = `آخر تحديث بحثي: ${dateTimeAr(state.data.generatedAt)}`;
      render();
    } catch (error) {
      $('status').textContent = `تعذر تحميل منصة البحث: ${error.message}`;
      $('coverageWarning').textContent = 'تعذر التحقق من البيانات؛ لم يتم عرض قرار بحثي.';
    }
  }

  $('horizon').addEventListener('change', render);
  $('classification').addEventListener('change', render);
  $('filter').addEventListener('input', render);
  $('closeDetail').addEventListener('click', () => $('detailDialog').close());
  $('detailDialog').addEventListener('click', event => { if (event.target === $('detailDialog')) $('detailDialog').close(); });
  load();
})();
