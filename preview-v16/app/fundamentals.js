'use strict';

/* EGX Professional V16.1 automated fundamental-analysis layer. */
(() => {
  const FUNDAMENTAL_URL = '../../data/stable/v16-fundamental-analysis.json';
  const original = {
    gate: typeof gate === 'function' ? gate : null,
    ready: typeof ready === 'function' ? ready : null,
    renderReady: typeof renderReady === 'function' ? renderReady : null,
    renderTruth: typeof renderTruth === 'function' ? renderTruth : null,
    renderRecs: typeof renderRecs === 'function' ? renderRecs : null,
    renderSelected: typeof renderSelected === 'function' ? renderSelected : null,
  };
  const local = { report: null, query: '', verdict: 'all', selected: null };
  S.fa = null;

  const financialRecord = ticker => A(local.report?.records).find(item => item.ticker === ticker) || null;
  const recommendationFinancial = ticker => A(local.report?.recommendationAnalysis).find(item => item.ticker === ticker) || financialRecord(ticker);
  const scoreClass = score => N(score) === null ? 'neutral' : score >= 70 ? 'good' : score >= 50 ? 'warn' : 'bad';
  const gradeLabel = item => item?.score === null || item?.score === undefined ? 'غير متاح' : `${item.grade} — ${F(item.score, 0)}/100`;
  const moneyCompact = value => {
    const number = N(value);
    if (number === null) return '—';
    const abs = Math.abs(number);
    if (abs >= 1e9) return `${F(number / 1e9, 2)} مليار`;
    if (abs >= 1e6) return `${F(number / 1e6, 2)} مليون`;
    if (abs >= 1e3) return `${F(number / 1e3, 1)} ألف`;
    return F(number, 0);
  };
  const sourceAgeLabel = item => N(item?.statementAgeDays) === null ? 'العمر غير معروف' : `${F(item.statementAgeDays, 0)} يوم`;
  const sourceBadge = item => item?.dataQuality?.officialVerified ? '<span class="tag good">إفصاح رسمي موثق</span>' : '<span class="tag warn">بيانات معيارية ثانوية</span>';
  const flagIcon = severity => severity === 'CRITICAL' || severity === 'HIGH' ? '✕' : '!';
  const flagClass = severity => severity === 'CRITICAL' || severity === 'HIGH' ? 'fail' : 'warn';

  function automatedFinancialState(item) {
    if (!item || N(item.score) === null) return { score: 0, label: 'غير مكتمل', cls: 'bad', notes: ['البيانات المالية غير كافية أو لم تُجمع بعد.'] };
    return {
      score: item.score,
      label: item.score >= 70 ? 'قوي' : item.score >= 55 ? 'مقبول' : item.score >= 35 ? 'ضعيف' : 'مخاطر مرتفعة',
      cls: scoreClass(item.score),
      notes: [item.verdictAr, ...A(item.redFlags).map(flag => flag.text)],
    };
  }

  if (original.gate) {
    gate = function fundamentalAwareGate(recommendation) {
      const base = original.gate(recommendation);
      const item = recommendationFinancial(recommendation.ticker);
      base.i = A(base.i).filter(issue => !String(issue?.[1] || '').includes('التحليل المالي غير مكتمل'));
      base.ok = A(base.ok).filter(message => !String(message || '').includes('المراجعة المالية مقبولة'));
      const highFlags = A(item?.redFlags).filter(flag => ['CRITICAL', 'HIGH'].includes(flag.severity));
      if (!item || N(item.score) === null) base.i.push(['warn', 'لم تكتمل البيانات المالية الآلية؛ الفرصة فنية قصيرة الأجل فقط.']);
      else if (highFlags.some(flag => flag.severity === 'CRITICAL') || item.score < 25) base.i.push(['fail', `بوابة مالية صلبة: ${highFlags[0]?.text || item.verdictAr}`]);
      else if (item.score < 50 || highFlags.length) base.i.push(['warn', `الدرجة المالية ${F(item.score, 0)}/100 — ${item.verdictAr}`]);
      else base.ok.push(`الدرجة المالية ${F(item.score, 0)}/100 (${item.grade}).`);
      const hardBlocked = base.i.some(issue => issue[0] === 'fail');
      base.status = hardBlocked ? 'blocked' : (base.i.length || base.pilot ? 'caution' : 'eligible');
      base.label = hardBlocked ? 'محجوبة مهنيًا' : base.pilot ? 'Pilot منخفض المخاطرة' : base.i.length ? 'مراجعة بحذر' : 'صالحة للمراجعة';
      base.cls = hardBlocked ? 'bad' : base.status === 'eligible' ? 'good' : 'warn';
      base.f = automatedFinancialState(item);
      base.financialRecord = item;
      return base;
    };
  }

  if (original.ready) {
    ready = function automatedFundamentalReadiness() {
      const result = original.ready();
      const recommendationRows = A(local.report?.recommendationAnalysis);
      const scored = recommendationRows.filter(item => N(item.score) !== null);
      const coverage = recommendationRows.length ? scored.length / recommendationRows.length * 100 : 0;
      const averageScore = scored.length ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length : 0;
      const officialCoverage = recommendationRows.length ? recommendationRows.filter(item => item.dataQuality?.officialVerified).length / recommendationRows.length * 100 : 0;
      result.fs = C(coverage * 0.55 + averageScore * 0.35 + officialCoverage * 0.1, 0, 100);
      result.score = Math.round(result.ds * 0.25 + result.md * 0.25 + result.ls * 0.25 + result.fs * 0.15 + result.rr * 0.1);
      return result;
    };
  }

  renderReady = function renderReadyWithFinancialCoverage() {
    original.renderReady?.();
    if (!local.report) return;
    const summary = local.report.summary || {};
    const note = document.createElement('div');
    note.className = 'financial-readiness-note';
    note.innerHTML = `تغطية مالية آلية: <b>${F(summary.scoredCompanies, 0)}</b> شركة — توصيات اليوم المغطاة <b>${F(summary.currentRecommendationFinancialCoverage, 0)}/${F(summary.currentRecommendationCount, 0)}</b>.`;
    const verdict = $('professionalVerdict');
    verdict?.querySelector('.financial-readiness-note')?.remove();
    verdict?.appendChild(note);
  };

  renderTruth = function renderTruthWithFundamentals() {
    original.renderTruth?.();
    if (!local.report || !$('truthGrid')) return;
    const summary = local.report.summary || {};
    $('truthGrid').insertAdjacentHTML('beforeend', `<div class="truth-card"><small>التغطية المالية</small><b>${F(summary.scoredCompanies, 0)}/${F(summary.marketUniverse, 0)}</b><span>شركات لها درجة قابلة للحكم</span></div><div class="truth-card"><small>إفصاحات رسمية موثقة</small><b>${F(summary.officialVerifiedCompanies, 0)}</b><span>الباقي بيانات معيارية مع وسم المصدر</span></div>`);
  };

  function decorateRecommendationCards() {
    document.querySelectorAll('#recommendationGrid .rec-card').forEach(card => {
      const ticker = card.querySelector('h3')?.textContent?.trim();
      if (!ticker || card.querySelector('.financial-chip')) return;
      const item = recommendationFinancial(ticker);
      const chip = document.createElement('div');
      chip.className = `financial-chip ${scoreClass(item?.score)}`;
      chip.innerHTML = `<span>مالي</span><b>${item && N(item.score) !== null ? `${E(item.grade)} · ${F(item.score, 0)}` : 'قيد الجمع'}</b>`;
      card.querySelector('.rec-name')?.insertAdjacentElement('afterend', chip);
    });
  }
  renderRecs = function renderRecommendationsWithFinancialScore() { original.renderRecs?.(); decorateRecommendationCards(); };

  function financialDetailHtml(item) {
    if (!item || N(item.score) === null) return '<div class="financial-empty"><b>البيانات المالية لم تكتمل بعد</b><span>لا يتم اختراع درجة أو قيمة عادلة. يمكن استخدام الإشارة كتحليل فني فقط إلى أن يكتمل الجمع.</span></div>';
    const l = item.latest || {}, c = item.calculated || {}, fv = item.relativeFairValue || {};
    return `<div class="financial-selected-head"><div class="finance-score ${scoreClass(item.score)}"><strong>${F(item.score, 0)}</strong><span>${E(item.grade)}</span></div><div><b>${E(item.verdictAr)}</b><p>${sourceBadge(item)} <span class="tag neutral">الفترة ${E(item.financialPeriodEnd || 'غير محددة')}</span></p></div></div>${row('نمو الإيرادات', P(c.revenueGrowthPct), N(c.revenueGrowthPct) >= 0 ? 'green' : 'red')}${row('نمو صافي الربح', P(c.netIncomeGrowthPct), N(c.netIncomeGrowthPct) >= 0 ? 'green' : 'red')}${row('هامش صافي الربح', P(l.netMarginPct), N(l.netMarginPct) >= 0 ? 'green' : 'red')}${row('التدفق التشغيلي', moneyCompact(l.operatingCashFlow), N(l.operatingCashFlow) >= 0 ? 'green' : 'red')}${row('الدين / حقوق الملكية', F(l.debtToEquity, 2))}${row('P/E مقابل القطاع', `${F(l.peRatio, 1)} / ${F(item.peerComparison?.medians?.peRatio, 1)}`)}${row('نطاق القيمة النسبية', fv.fairValue ? `${F(fv.low, 2)} – ${F(fv.high, 2)}` : 'غير متاح')}${A(item.redFlags).slice(0, 3).map(flag => `<div class="gate ${flagClass(flag.severity)}"><span>${E(flag.text)}</span><b>${flagIcon(flag.severity)}</b></div>`).join('')}<button class="btn finance-open" type="button" data-financial-open="${E(item.ticker)}">فتح التحليل المالي الكامل</button>`;
  }

  renderSelected = function renderSelectedWithAutomatedFundamentals() {
    original.renderSelected?.();
    if (!S.sel || !$('fundamentalDetail')) return;
    const item = financialRecord(S.sel.ticker) || recommendationFinancial(S.sel.ticker);
    $('fundamentalDetail').innerHTML = financialDetailHtml(item);
    $('fundamentalDetail').querySelector('[data-financial-open]')?.addEventListener('click', event => {
      local.selected = event.currentTarget.dataset.financialOpen;
      document.querySelector('[data-view="fundamentals"]')?.click();
      renderAutomatedFundamentals();
    });
  };

  function breakdownBars(item) {
    const labels = { profitability: 'الربحية', growth: 'النمو', balanceSheet: 'الميزانية', cashFlow: 'التدفقات', valuation: 'التقييم', disclosure: 'الإفصاح' };
    const maximums = { profitability: 25, growth: 20, balanceSheet: 20, cashFlow: 15, valuation: 15, disclosure: 5 };
    return Object.entries(labels).map(([key, label]) => {
      const value = N(item.breakdown?.[key]) || 0, maximum = maximums[key];
      return `<div class="finance-pillar"><span>${label}</span><div class="bar"><i style="width:${C(value / maximum * 100, 0, 100)}%"></i></div><b>${F(value, 0)}/${maximum}</b></div>`;
    }).join('');
  }
  function statementCards(item) {
    const l = item.latest || {}, c = item.calculated || {};
    return [['الإيرادات', moneyCompact(l.revenue), P(c.revenueGrowthPct)], ['صافي الربح', moneyCompact(l.netIncome), P(c.netIncomeGrowthPct)], ['هامش التشغيل', P(l.operatingMarginPct), ''], ['هامش صافي الربح', P(l.netMarginPct), ''], ['التدفق التشغيلي', moneyCompact(l.operatingCashFlow), ''], ['التدفق الحر', moneyCompact(l.freeCashFlow), ''], ['النقدية', moneyCompact(l.cashAndInvestments), ''], ['إجمالي الدين', moneyCompact(l.totalDebt), '']].map(card => `<div class="finance-stat"><small>${card[0]}</small><b>${card[1]}</b><span>${card[2]}</span></div>`).join('');
  }
  function valuationTable(item) {
    const peer = item.peerComparison?.medians || {}, l = item.latest || {};
    return [['P/E', l.peRatio, peer.peRatio], ['P/S', l.priceToSales, peer.priceToSales], ['P/FCF', l.priceToFreeCashFlow, peer.priceToFreeCashFlow], ['P/B', l.priceToBook, peer.priceToBook], ['ROE', l.returnOnEquityPct, peer.returnOnEquityPct, true], ['هامش الربح', l.netMarginPct, peer.netMarginPct, true]].map(([label, company, median, percent]) => `<tr><td>${label}</td><td>${percent ? P(company) : F(company, 2)}</td><td>${percent ? P(median) : F(median, 2)}</td><td>${N(company) === null || N(median) === null ? '—' : percent ? (company >= median ? 'أفضل' : 'أضعف') : (company <= median ? 'أرخص' : 'أغلى')}</td></tr>`).join('');
  }
  function selectedFinancialPanel(item) {
    if (!item) return '<article class="panel"><div class="empty">اختر سهمًا من الجدول لعرض التحليل التفصيلي.</div></article>';
    if (N(item.score) === null) return `<article class="panel"><div class="panel-head"><div><h2>${E(item.ticker)} — ${E(item.companyNameAr)}</h2><p>لا توجد بيانات كافية لحساب درجة مالية.</p></div></div><div class="body"><div class="professional-verdict bad">${E(item.verdictAr)}</div>${A(item.redFlags).map(flag => `<div class="gate warn"><span>${E(flag.text)}</span><b>!</b></div>`).join('')}</div></article>`;
    const fv = item.relativeFairValue || {};
    const sourceLinks = [item.source?.officialUrl ? `<a target="_blank" rel="noopener" href="${E(item.source.officialUrl)}">الإفصاح الرسمي</a>` : '', item.source?.overviewUrl ? `<a target="_blank" rel="noopener" href="${E(item.source.overviewUrl)}">القوائم المعيارية</a>` : '', item.source?.statisticsUrl ? `<a target="_blank" rel="noopener" href="${E(item.source.statisticsUrl)}">النسب والإحصاءات</a>` : ''].filter(Boolean).join(' · ');
    return `<article class="panel finance-detail-panel"><div class="panel-head split"><div><h2>${E(item.ticker)} — ${E(item.companyNameAr)}</h2><p>${E(item.classification?.sector || item.classification?.template || 'قطاع غير محدد')} | الفترة ${E(item.financialPeriodEnd || 'غير معروفة')} | عمر البيانات ${sourceAgeLabel(item)}</p></div><div class="finance-score large ${scoreClass(item.score)}"><strong>${F(item.score, 0)}</strong><span>${E(item.grade)}</span></div></div><div class="body"><div class="finance-verdict ${scoreClass(item.score)}"><b>${E(item.verdictAr)}</b><span>اكتمال البيانات ${P(item.dataQuality?.completenessPct)} — ${item.dataQuality?.officialVerified ? 'موثقة رسميًا' : 'تحتاج مطابقة مع الإفصاح الرسمي'}</span></div><div class="finance-pillars">${breakdownBars(item)}</div><div class="finance-stat-grid">${statementCards(item)}</div><div class="finance-two-columns"><div class="finance-block"><h3>التقييم النسبي</h3><div class="fair-value"><small>السعر الحالي</small><b>${F(item.currentPrice, 3)}</b><small>القيمة النسبية المركزية</small><b>${F(fv.fairValue, 3)}</b><small>النطاق</small><b>${fv.low ? `${F(fv.low, 3)} – ${F(fv.high, 3)}` : 'غير متاح'}</b><small>هامش القيمة</small><b class="${N(fv.marginOfSafetyPct) >= 0 ? 'green' : 'red'}">${P(fv.marginOfSafetyPct)}</b></div><p class="finance-disclaimer">القيمة نسبية مبنية على مضاعفات النظراء وليست DCF أو ضمانًا لسعر مستقبلي.</p></div><div class="finance-block"><h3>مقارنة القطاع</h3><div class="table-wrap"><table><thead><tr><th>المؤشر</th><th>الشركة</th><th>وسيط النظراء</th><th>الحكم</th></tr></thead><tbody>${valuationTable(item)}</tbody></table></div></div></div><div class="finance-two-columns"><div class="finance-block"><h3>إشارات الخطر</h3>${A(item.redFlags).length ? A(item.redFlags).map(flag => `<div class="gate ${flagClass(flag.severity)}"><span>${E(flag.text)}</span><b>${flagIcon(flag.severity)}</b></div>`).join('') : '<div class="gate pass"><span>لم تظهر إشارة خطر مالية صلبة ضمن البيانات المتاحة.</span><b>✓</b></div>'}</div><div class="finance-block"><h3>المصدر والجودة</h3>${row('نوع المصدر', item.dataQuality?.sourceTier)}${row('موثق رسميًا', item.dataQuality?.officialVerified ? 'نعم' : 'لا')}${row('مدقق', item.dataQuality?.audited ? 'نعم' : 'غير مؤكد')}${row('اكتمال المؤشرات', P(item.dataQuality?.completenessPct))}<div class="finance-source-links">${sourceLinks || 'لا توجد روابط مصدر محفوظة.'}</div></div></div></div></article>`;
  }
  function filteredRows() {
    const query = norm(local.query);
    return A(local.report?.records).filter(item => {
      if (local.verdict !== 'all' && item.verdict !== local.verdict) return false;
      if (!query) return true;
      return norm(`${item.ticker} ${item.companyNameAr} ${item.classification?.sector || ''} ${item.classification?.industry || ''}`).includes(query);
    });
  }
  function renderFinancialTable() {
    const body = $('automatedFinancialRows');
    if (!body) return;
    const rows = filteredRows().slice(0, 200);
    body.innerHTML = rows.length ? rows.map(item => `<tr data-financial-row="${E(item.ticker)}" class="${local.selected === item.ticker ? 'selected-row' : ''}"><td><b>${E(item.ticker)}</b><span>${E(item.companyNameAr)}</span></td><td><span class="badge ${scoreClass(item.score)}">${gradeLabel(item)}</span></td><td>${E(item.verdictAr)}</td><td>${P(item.calculated?.revenueGrowthPct)}</td><td>${P(item.calculated?.netIncomeGrowthPct)}</td><td>${P(item.latest?.netMarginPct)}</td><td>${moneyCompact(item.latest?.operatingCashFlow)}</td><td>${F(item.latest?.debtToEquity, 2)}</td><td>${F(item.latest?.peRatio, 1)}</td><td>${P(item.relativeFairValue?.marginOfSafetyPct)}</td><td>${sourceAgeLabel(item)}</td></tr>`).join('') : '<tr><td colspan="11" class="empty">لا توجد نتائج مطابقة.</td></tr>';
    body.querySelectorAll('[data-financial-row]').forEach(rowElement => rowElement.addEventListener('click', () => {
      local.selected = rowElement.dataset.financialRow;
      renderFinancialTable();
      $('automatedFinancialDetail').innerHTML = selectedFinancialPanel(financialRecord(local.selected));
      $('automatedFinancialDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }
  function renderAutomatedFundamentals() {
    const view = $('view-fundamentals');
    if (!view) return;
    if (!local.report) { view.innerHTML = '<article class="panel"><div class="loading">جارٍ تحميل قاعدة التحليل المالي…</div></article>'; return; }
    const summary = local.report.summary || {}, recs = A(local.report.recommendationAnalysis);
    if (!local.selected) local.selected = recs.find(item => N(item.score) !== null)?.ticker || A(local.report.records)[0]?.ticker || null;
    view.innerHTML = `<div class="finance-summary-grid"><div class="truth-card"><small>تغطية السوق</small><b>${F(summary.rawCoverage, 0)}/${F(summary.marketUniverse, 0)}</b><span>تم جمع بيانات مالية</span></div><div class="truth-card"><small>درجات قابلة للحكم</small><b>${F(summary.scoredCompanies, 0)}</b><span>اجتازت حد اكتمال البيانات</span></div><div class="truth-card"><small>قوائم حديثة</small><b>${F(summary.freshStatements, 0)}</b><span>حتى 240 يومًا</span></div><div class="truth-card"><small>توثيق رسمي</small><b>${F(summary.officialVerifiedCompanies, 0)}</b><span>تمت مطابقة الإفصاح</span></div><div class="truth-card"><small>توصيات اليوم المغطاة</small><b>${F(summary.currentRecommendationFinancialCoverage, 0)}/${F(summary.currentRecommendationCount, 0)}</b><span>درجة مالية متاحة</span></div></div><article class="panel"><div class="panel-head"><div><h2>الحكم المالي على توصيات اليوم</h2><p>القرار الفني القصير الأجل منفصل عن صلاحية السهم للاستثمار. الدرجة المالية لا تحوّل التوصية إلى أمر شراء.</p></div></div><div class="financial-recommendation-strip">${recs.map(item => `<button type="button" data-fin-rec="${E(item.ticker)}" class="financial-rec-item ${scoreClass(item.score)}"><b>${E(item.ticker)}</b><strong>${N(item.score) === null ? 'قيد الجمع' : `${E(item.grade)} · ${F(item.score, 0)}`}</strong><span>${E(item.verdictAr)}</span></button>`).join('')}</div></article><article class="panel"><div class="panel-head split"><div><h2>ماسح التحليل المالي</h2><p>ربحية ونمو وتدفقات ومديونية وتقييم نسبي وجودة إفصاح.</p></div><div class="filters"><input id="financialSearch" class="control" placeholder="بحث بالرمز أو الاسم أو القطاع"><select id="financialVerdictFilter" class="control"><option value="all">كل الأحكام</option><option value="INVESTMENT_REVIEW">مراجعة استثمارية</option><option value="WATCH">مراقبة</option><option value="WEAK">ضعيف</option><option value="AVOID_INVESTMENT_REVIEW">مخاطر مرتفعة</option><option value="DATA_INSUFFICIENT">بيانات غير كافية</option></select></div></div><div class="table-wrap finance-table-wrap"><table class="finance-table"><thead><tr><th>السهم</th><th>الدرجة</th><th>الحكم</th><th>نمو الإيرادات</th><th>نمو الربح</th><th>هامش الربح</th><th>OCF</th><th>D/E</th><th>P/E</th><th>هامش القيمة</th><th>عمر القوائم</th></tr></thead><tbody id="automatedFinancialRows"></tbody></table></div></article><div id="automatedFinancialDetail">${selectedFinancialPanel(financialRecord(local.selected) || recommendationFinancial(local.selected))}</div><article class="panel"><div class="panel-head"><div><h2>منهجية وحدود التحليل</h2><p>حماية من الأرقام المضللة والخلط بين القيمة النسبية والقيمة الجوهرية.</p></div></div><div class="body"><ul class="method-list">${A(local.report.methodology?.principles).map(item => `<li>${E(item)}</li>`).join('')}</ul></div></article>`;
    $('financialSearch').value = local.query; $('financialVerdictFilter').value = local.verdict;
    $('financialSearch').addEventListener('input', event => { local.query = event.target.value; renderFinancialTable(); });
    $('financialVerdictFilter').addEventListener('change', event => { local.verdict = event.target.value; renderFinancialTable(); });
    view.querySelectorAll('[data-fin-rec]').forEach(button => button.addEventListener('click', () => { local.selected = button.dataset.finRec; renderAutomatedFundamentals(); $('automatedFinancialDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    renderFinancialTable();
  }

  try { renderFund = renderAutomatedFundamentals; } catch (_) {}
  document.querySelector('[data-view="fundamentals"]')?.addEventListener('click', () => setTimeout(renderAutomatedFundamentals, 0));
  async function loadFundamentalReport() {
    try {
      local.report = await J(FUNDAMENTAL_URL); S.fa = local.report;
      renderReady(); renderTruth(); renderRecs(); if (S.sel) renderSelected();
      if ($('view-fundamentals')?.classList.contains('active')) renderAutomatedFundamentals();
    } catch (error) {
      console.error('Fundamental report unavailable', error); local.report = null;
      if ($('view-fundamentals')?.classList.contains('active')) $('view-fundamentals').innerHTML = '<article class="panel"><div class="professional-verdict bad">تعذر تحميل قاعدة التحليل المالي. لم يتم عرض أي أرقام بديلة أو تخمينية.</div></article>';
    }
  }
  loadFundamentalReport();
})();
