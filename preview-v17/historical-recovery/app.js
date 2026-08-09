'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { data: null, acquisition: null, sort: {} };
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
  const changeTypeAr = code => ({ CLASSIFICATION_UPGRADE: 'ترقية التصنيف', CLASSIFICATION_DOWNGRADE: 'خفض التصنيف', RISK_INCREASE: 'ارتفاع المخاطر', RISK_DECREASE: 'انخفاض المخاطر', TECHNICAL_CHANGE: 'تغير فني', DATA_QUALITY_IMPROVED: 'تحسن جودة البيانات', DATA_QUALITY_DETERIORATED: 'تراجع جودة البيانات', BREAK_BELOW_POST_PEAK_TROUGH: 'كسر قاع دورة الهبوط', MATERIAL_NEGATIVE_NEWS: 'خبر سلبي جوهري', NEW_EVIDENCE: 'اكتمال أدلة جديدة' }[code] || 'تغير جوهري');
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
  const confidenceAr = value => ({ HIGH: 'مرتفعة', MEDIUM: 'متوسطة', LOW: 'منخفضة', UNAVAILABLE: 'غير متاحة', REJECTED: 'مرفوضة' }[value] || 'غير متاحة');
  const statementScopeAr = value => ({ CONSOLIDATED: 'مجمعة', STANDALONE: 'مستقلة' }[value] || 'غير متاح');
  const valuationStatusAr = value => value === 'AVAILABLE' ? 'متاح' : 'بيانات التقييم غير كافية';
  const sourceTypeAr = value => ({ OFFICIAL_COMPANY_IR: 'علاقات المستثمرين الرسمية', OFFICIAL_COMPANY_EARNINGS_RELEASE: 'بيان نتائج رسمي', OFFICIAL_COMPANY_PRESS_RELEASE: 'بيان صحفي رسمي' }[value] || 'مصدر رسمي');
  const reviewReasonAr = reason => {
    const value = String(reason || '');
    if (value.includes('IDENTITY')) return 'إعادة مراجعة الهوية مطلوبة.';
    if (value.includes('CURRENT_DOCUMENT_LINKS')) return 'روابط القوائم الحالية في موقع علاقات المستثمرين غير متاحة أو معطلة.';
    if (value.includes('2024_AND_OLDER') || value.includes('NO_2025') || value.includes('STALE')) return 'لم تُعثر على قوائم حديثة كافية في المصدر الرسمي أثناء الفحص.';
    if (value.includes('NO_STABLE_FIRST_PARTY')) return 'لم يُتحقق من مسار ثابت لقوائم رسمية من الشركة.';
    if (value.includes('OFFICIAL_SITE_IS_STALE')) return 'الموقع الرسمي قديم ولم تُعثر فيه على قائمة حديثة قابلة للتحقق.';
    if (value.includes('PROVIDER_COUPLED')) return 'صفحة علاقات المستثمرين تعتمد على مزود مضمّن وتحتاج مراجعة مستند يدويًا.';
    if (value.includes('PUBLICATION_TIMESTAMP')) return 'توقيت النشر الرسمي يحتاج مراجعة؛ لذلك لا يدخل المستند في أثر الأحداث الزمني.';
    if (value.includes('PUBLICATION_DATE_CROSS_CHECKED')) return 'توقيت النشر الرسمي يحتاج مراجعة؛ تاريخ النشر متقاطع التحقق لكن التوقيت الدقيق غير مكتمل.';
    if (value.includes('ANNUAL')) return 'لا توجد فترتان سنويتان قابلتان للمقارنة.';
    if (value.includes('OPERATING_PROFIT')) return 'بند الربح التشغيلي يحتاج مراجعة دلالية قبل استخدامه.';
    if (value.includes('EBITDA')) return 'الأرباح قبل الفوائد والضرائب والإهلاك غير متحققة صراحةً.';
    if (value.includes('DIVIDEND')) return 'توزيعات السهم غير متحققة.';
    if (value.includes('INTEREST_EXPENSE')) return 'مصروفات الفائدة غير متحققة.';
    if (value.includes('CASH_FLOW')) return 'بيانات التدفق النقدي غير مكتملة.';
    if (value.includes('DEBT')) return 'بيانات الدين غير مكتملة.';
    if (value.includes('EPS')) return 'ربحية السهم غير مكتملة.';
    return 'الدليل غير مكتمل ويحتاج مراجعة قبل استخدامه.';
  };

  function populateSummary(rows) {
    const s = state.data.summary;
    $('universe').textContent = fmt(s.canonicalEquityUniverse, 0);
    $('priceCoverage').textContent = fmt(s.priceHistoryCovered, 0);
    $('historyValid').textContent = fmt(s.historicalDataValid, 0);
    $('fundamentalCoverage').textContent = fmt(s.fundamentalCoverage, 0);
    $('fundamentalEligible').textContent = fmt(s.fundamentalScored, 0);
    $('newsCoverage').textContent = fmt(s.newsDisclosureCoverage, 0);
    const financial = state.acquisition?.summary?.financialCoverage || {};
    $('financialHigh').textContent = fmt(financial.HIGH, 0);
    $('financialMedium').textContent = fmt(financial.MEDIUM, 0);
    $('financialLow').textContent = fmt(financial.LOW, 0);
    $('financialUnavailable').textContent = fmt(financial.UNAVAILABLE, 0);
    $('verifiedNewsCoverage').textContent = fmt(state.acquisition?.summary?.verifiedSecondaryNewsCoverage, 0);
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
    const pilot = state.acquisition?.summary;
    const insufficient = s.fundamentalCoverage === 0 || s.newsDisclosureCoverage === 0;
    $('coverageWarning').textContent = insufficient
      ? 'تنبيه جودة: التغطية المالية أو الإخبارية الموثقة غير متاحة حاليًا؛ لذلك لا يصدر النظام درجات استثمارية متكاملة أو مرشحين إيجابيين مصطنعين.'
      : pilot?.verifiedSecondaryNewsCoverage === 0
        ? `تغطية تجريبية جزئية: ${fmt(pilot.normalizedFinancialCompanies, 0)} من ٩ شركات لها دليل مالي منظم، ولا توجد أخبار ثانوية موثقة مؤهلة حاليًا. تستمر جميع بوابات المخاطر والثقة.`
        : 'توجد تغطية مالية وإخبارية موثقة جزئيًا، مع استمرار تطبيق بوابات المخاطر والثقة.';
  }

  function renderAcquisitionCoverage() {
    const acquisition = state.acquisition;
    if (!acquisition) return;
    const s = acquisition.summary;
    const cards = [
      ['السعر والتاريخ', `${fmt(state.data.summary.historicalDataValid, 0)} من ${fmt(state.data.summary.canonicalEquityUniverse, 0)}`],
      ['البيانات المالية في التجربة', `${fmt(s.normalizedFinancialCompanies, 0)} من ${fmt(s.pilotCompanies, 0)}`],
      ['صالحة لحساب جودة مالية', fmt(s.scoredFinancialCompanies, 0)],
      ['الإفصاحات الرسمية المفحوصة', fmt(s.officialDisclosureCoverage, 0)],
      ['الأخبار الثانوية الموثقة', fmt(s.verifiedSecondaryNewsCoverage, 0)],
      ['أحداث مؤهلة لتغيير القرار', fmt(s.verifiedDecisionEligibleEvents, 0)],
    ];
    $('evidenceCoverage').innerHTML = cards.map(([label, value]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('');
    $('pilotCoverageRows').innerHTML = acquisition.companies.map(row => `<tr><td class="share-name">${esc(row.companyNameAr || row.companyNameEn || row.ticker)}</td><td class="ticker" dir="ltr">${esc(row.ticker)}</td><td>${esc(confidenceAr(row.identityConfidence))}</td><td>${esc(confidenceAr(row.financialCoverage))}</td><td>${dateAr(row.latestFinancialPeriod)}</td><td>${esc(statementScopeAr(row.statementScope))}</td><td>${row.sourceUrl ? `<a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener">${esc(sourceTypeAr(row.sourceType))}</a>` : 'غير متاح'}</td><td>${esc(valuationStatusAr(row.valuationStatus))}</td><td class="reasons">${esc((row.missingFields || []).map(reviewReasonAr).join(' '))}</td></tr>`).join('');
    const labels = { companyIdentity: 'مراجعة هوية الشركة', financialDocument: 'مراجعة مستند مالي', publicationTiming: 'مراجعة توقيت النشر', currencyUnit: 'مراجعة العملة والوحدة', sourceConflict: 'مراجعة اختلاف المصادر', corporateAction: 'مراجعة إجراء رأسمالي', disclosure: 'مراجعة إفصاح', newsClassification: 'مراجعة تصنيف الخبر' };
    $('reviewQueues').innerHTML = Object.entries(acquisition.reviewQueues || {}).map(([key, items]) => `<article><h3>${esc(labels[key] || 'مراجعة')}</h3><strong>${fmt(items.length, 0)}</strong>${items.length ? `<ul>${items.slice(0, 12).map(item => `<li><span dir="ltr">${esc(item.ticker || '—')}</span> — ${esc(reviewReasonAr(item.reason || item.reasons?.[0]))}</li>`).join('')}</ul>` : '<p>لا توجد عناصر.</p>'}</article>`).join('');
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
    populateSummary(rows); renderSourceHealth(); renderAcquisitionCoverage(); renderIntegrated(rows); renderDeep(rows); renderRecovery(rows); renderBottomAndTraps(rows); renderChangesAndNews(rows); renderQuality(rows);
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
        <section><h3>البيانات المالية الأساسية</h3><p>${badge(fundamentalStatus(row), fundamentalTone(row))}</p><dl><dt>آخر فترة مالية</dt><dd>${dateAr(f?.latestReportingPeriod)}</dd><dt>تاريخ النشر</dt><dd>${dateAr(f?.publicationDate)}</dd><dt>نوع القوائم</dt><dd>${esc(statementScopeAr(f?.statementScope))}</dd><dt>العملة</dt><dd>${esc(f?.currency || 'غير متاح')}</dd><dt>الإيرادات</dt><dd>${fmt(f?.metrics?.latest?.revenue)}</dd><dt>نمو الإيرادات</dt><dd>${pct(f?.metrics?.revenueGrowthPct)}</dd><dt>صافي الربح</dt><dd>${fmt(f?.metrics?.latest?.netProfit)}</dd><dt>نمو الأرباح</dt><dd>${pct(f?.metrics?.earningsGrowthPct)}</dd><dt>ربحية السهم</dt><dd>${fmt(f?.metrics?.latest?.eps)}</dd><dt>العائد على حقوق الملكية</dt><dd>${pct(f?.metrics?.roePct)}</dd><dt>العائد على الأصول</dt><dd>${pct(f?.metrics?.roaPct)}</dd><dt>إجمالي الدين</dt><dd>${fmt(f?.metrics?.latest?.totalDebt)}</dd><dt>صافي الدين</dt><dd>${fmt(f?.metrics?.netDebt)}</dd><dt>التدفق النقدي التشغيلي</dt><dd>${fmt(f?.metrics?.latest?.operatingCashFlow)}</dd><dt>التدفق النقدي الحر</dt><dd>${fmt(f?.metrics?.freeCashFlow)}</dd></dl><p>المصدر: ${safeUrl(f?.provenance?.[0]?.sourceUrl) ? `<a href="${esc(f.provenance[0].sourceUrl)}" target="_blank" rel="noopener">عرض المستند الرسمي</a>` : 'غير متاح'}</p></section>
        <section><h3>جودة الشركة ومكونات التحليل</h3><dl><dt>درجة جودة الشركة</dt><dd>${fmt(f?.fundamentalQualityScore)}</dd><dt>الربحية</dt><dd>${fmt(f?.components?.profitability?.score)}</dd><dt>النمو</dt><dd>${fmt(f?.components?.growth?.score)}</dd><dt>الميزانية</dt><dd>${fmt(f?.components?.balanceSheet?.score)}</dd><dt>جودة التدفق النقدي</dt><dd>${fmt(f?.components?.cashFlow?.score)}</dd><dt>استقرار الأرباح</dt><dd>${fmt(f?.components?.earningsStability?.score)}</dd><dt>موثوقية البيانات</dt><dd>${esc(confidenceAr(f?.fundamentalDataConfidence))}</dd></dl></section>
        <section><h3>التقييم والمخاطر</h3><dl><dt>درجة التقييم</dt><dd>${fmt(f?.valuation?.score)}</dd><dt>المقاييس المتاحة</dt><dd>${esc((f?.valuation?.metrics || []).filter(metric => finite(metric.value)).map(metric => `${valuationMetricAr(metric.metric)}: ${fmt(metric.value)}`).join(' · ') || 'غير متاح')}</dd><dt>المقارنة القطاعية</dt><dd>غير متاحة دون مصدر سوق موثوق وكامل.</dd><dt>المخاطرة المالية</dt><dd>${esc(row.risk?.labelAr || 'غير متاح')}</dd><dt>خطر مصيدة القيمة</dt><dd>${esc(row.valueTrapRisk?.labelAr || 'غير متاح')}</dd><dt>الثقة الكلية</dt><dd>${pct(row.overallDataConfidence)}</dd></dl></section>
        <section class="detail-wide"><h3>الأخبار والأحداث</h3>${sourceEvents.length ? sourceEvents.map(event => `<article class="event"><strong>${esc(event.summaryAr || 'حدث موثق')}</strong><p>${esc(event.explanationAr)}</p><span>الأثر: ${fmt(event.newsImpactScore)} · الثقة: ${pct(event.sourceConfidence)} · ${dateAr(event.eventDate)}</span></article>`).join('') : n?.coverageStatus === 'COVERED_NO_MATERIAL_EVENT' ? '<p>تم فحص المصدر الرسمي ضمن نطاق التجربة، ولم يوجد حدث جوهري مكتمل التوقيت ومؤهل لتغيير القرار.</p>' : '<p>تغطية الأخبار والإفصاحات غير متاحة لهذا السهم حاليًا؛ ولا يعني ذلك عدم وجود أخبار.</p>'}</section>
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
      const [response, acquisitionResponse] = await Promise.all([
        fetch(`../../data/v17/historical-recovery/integrated-market.json?v=${Date.now()}`, { cache: 'no-store' }),
        fetch(`../../data/v17/historical-recovery/acquisition/current.json?v=${Date.now()}`, { cache: 'no-store' }),
      ]);
      if (!response.ok || !acquisitionResponse.ok) throw new Error(`HTTP ${response.status}/${acquisitionResponse.status}`);
      [state.data, state.acquisition] = await Promise.all([response.json(), acquisitionResponse.json()]);
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
