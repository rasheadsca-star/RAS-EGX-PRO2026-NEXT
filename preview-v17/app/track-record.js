'use strict';

(() => {
  const TRACK_URL = '../../data/v17/recommendation-track-record.json';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 2) => finite(value) === null ? '—' : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits });
  const pct = (value, digits = 2) => finite(value) === null ? '—' : `${fmt(value, digits)}%`;

  function confidenceClass(grade) {
    const token = String(grade || '').toUpperCase();
    if (['MATURE', 'HIGH', 'MODERATE_PLUS'].includes(token)) return 'good';
    if (['MODERATE', 'DEVELOPING', 'EARLY', 'EXECUTION_GATED'].includes(token)) return 'warn';
    return 'bad';
  }

  function confidenceLabel(grade) {
    const labels = {
      MODERATE_PLUS: 'متوسطة إلى جيدة بحثيًا',
      MODERATE: 'متوسطة بحثيًا',
      LOW: 'منخفضة',
      LOW_SAMPLE: 'عينة حية صغيرة',
      EARLY: 'مبكرة',
      DEVELOPING: 'قيد البناء',
      MATURE: 'عينة ناضجة نسبيًا',
      RESEARCH_ONLY: 'بحث فقط',
      EXECUTION_GATED: 'مشروطة ببوابات التنفيذ',
    };
    return labels[String(grade || '').toUpperCase()] || grade || 'غير محدد';
  }

  function statusClass(status, netReturn) {
    const token = String(status || '').toUpperCase();
    if (finite(netReturn) !== null) return Number(netReturn) > 0 ? 'win' : Number(netReturn) < 0 ? 'loss' : 'pending';
    if (token.includes('TARGET') || token.includes('WIN')) return 'win';
    if (token.includes('STOP') || token.includes('LOSS')) return 'loss';
    return 'pending';
  }

  function statusAr(status) {
    const labels = {
      RESOLVED: 'محسومة',
      ISSUED_PENDING_NEXT_SESSION: 'بانتظار الجلسة التالية',
      PENDING_OUTCOME: 'بانتظار النتيجة',
      ORIGINAL_LIVE_RESULT_PRESERVED: 'نتيجة حية أصلية محفوظة',
      RETROACTIVELY_RESOLVED: 'محسومة بأثر رجعي',
      PENDING_TRUSTED_HISTORY: 'بانتظار تاريخ موثوق',
      TARGET_TOUCHED: 'تحقق الهدف',
      STOP_TOUCHED: 'تحقق الوقف',
      AMBIGUOUS_TREATED_AS_STOP: 'هدف ووقف بنفس الجلسة — حُسب وقفًا',
      TIME_EXIT: 'خروج زمني',
      NOT_ENTERED_GAP_ABOVE_RANGE: 'لم يتم الدخول — فجوة أعلى النطاق',
      NOT_ENTERED_OPEN_BELOW_STOP: 'لم يتم الدخول — افتتاح أسفل الوقف',
      NOT_ENTERED_RANGE_NOT_TOUCHED: 'لم يتم الدخول — النطاق لم يُلمس',
      ENTERED_AWAITING_TRUSTED_OUTCOME: 'تم الدخول — بانتظار نتيجة موثوقة',
      ENTERED_AWAITING_FULL_HOLDING_WINDOW: 'تم الدخول — نافذة الاحتفاظ غير مكتملة',
      AWAITING_NEXT_SESSION: 'بانتظار أول جلسة تالية',
    };
    return labels[String(status || '').toUpperCase()] || status || '—';
  }

  function gradeCard(title, item, metricsHtml) {
    const grade = item?.grade || item?.status || 'UNKNOWN';
    return `<article class="track-confidence-card">
      <h3>${esc(title)}</h3>
      <span class="track-grade ${confidenceClass(grade)}">${esc(item?.labelAr || confidenceLabel(grade))}</span>
      <div class="track-mini">${metricsHtml}</div>
      <p>${esc(item?.rationaleAr || '')}</p>
    </article>`;
  }

  function ensureUi() {
    if ($('view-trackrecord')) return;
    const evidenceButton = document.querySelector('.nav-button[data-view="evidence"]');
    if (!evidenceButton) return;
    const button = document.createElement('button');
    button.className = 'nav-button';
    button.dataset.view = 'trackrecord';
    button.type = 'button';
    button.textContent = 'السجل والتقييم';
    evidenceButton.insertAdjacentElement('afterend', button);

    const section = document.createElement('section');
    section.className = 'view';
    section.id = 'view-trackrecord';
    section.setAttribute('aria-labelledby', 'trackRecordTitle');
    section.innerHTML = `
      <div class="section-heading">
        <div><span class="section-kicker">قابل للتدقيق</span><h2 id="trackRecordTitle">السجل الحي والتقييم الرجعي</h2></div>
        <span class="status-pill neutral" id="trackRecordStatus">جارٍ التحميل</span>
      </div>
      <div class="notice strong track-disclosure" id="trackRecordDisclosure">يتم فصل السجل الحي V17 عن أي Backfill تاريخي.</div>
      <div class="track-confidence-grid" id="trackConfidenceGrid"></div>
      <div class="track-section-stack">
        <article class="panel">
          <div class="panel-head"><div><span class="panel-kicker">نفس التكنيك</span><h3>جلسات V16.9 المسجلة</h3><p>النتيجة الحية الأصلية محفوظة كما هي؛ أي نتيجة رجعية تظهر منفصلة.</p></div></div>
          <div class="track-summary-line" id="exactMethodSummary"></div>
          <div class="table-wrap"><table class="track-table"><thead><tr><th>جلسة الإشارة</th><th>الأسهم</th><th>الحالة الأصلية</th><th>حالة التقييم</th><th>العائد الصافي</th><th>نوع الدليل</th></tr></thead><tbody id="exactMethodRows"></tbody></table></div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><span class="panel-kicker">V17 فقط</span><h3>السجل الحي الأصلي</h3><p>هذا الجزء وحده يدخل في بوابة الدليل الحي V17.</p></div></div>
          <div class="track-summary-line" id="nativeSummary"></div>
          <div class="table-wrap"><table class="track-table"><thead><tr><th>جلسة الإشارة</th><th>المحرك</th><th>الأسهم</th><th>الحالة</th><th>تاريخ النتيجة</th><th>عائد السلة</th></tr></thead><tbody id="nativeRows"></tbody></table></div>
        </article>
        <article class="panel">
          <div class="panel-head split"><div><span class="panel-kicker">Backfill موثق</span><h3>التوصيات المسجلة سابقًا</h3><p>تقييم بأثر رجعي لإشارات كانت محفوظة بالفعل؛ لا يُحتسب كسجل حي V17.</p></div><label class="field"><span>الفلتر</span><select id="trackStrategyFilter"><option value="same">نفس تكنيك V16.9</option><option value="all">كل الاستراتيجيات المسجلة</option></select></label></div>
          <div class="track-summary-line" id="backfillSummary"></div>
          <div class="table-wrap"><table class="track-table"><thead><tr><th>التاريخ</th><th>السهم</th><th>الاستراتيجية</th><th>الحالة</th><th>العائد الصافي</th><th>المصدر</th></tr></thead><tbody id="backfillRows"></tbody></table></div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><span class="panel-kicker">بحث تاريخي</span><h3>Blocked Walk-Forward لنفس الـChampion</h3><p>مرجع بحثي لتقييم متانة التكنيك، وليس أداءً حيًا.</p></div></div>
          <div class="track-summary-line" id="researchSummary"></div>
          <div class="table-wrap"><table class="track-table"><thead><tr><th>الإشارة</th><th>النتيجة</th><th>حجم السلة</th><th>الأسهم</th><th>العائد الصافي</th></tr></thead><tbody id="researchRows"></tbody></table></div>
        </article>
      </div>`;
    const health = $('view-health');
    if (health) health.insertAdjacentElement('beforebegin', section);
    else document.querySelector('main')?.appendChild(section);

    button.addEventListener('click', () => {
      document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'view-trackrecord'));
      document.querySelectorAll('.nav-button').forEach(nav => nav.classList.toggle('active', nav === button));
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  function render(data) {
    const historical = data?.confidence?.techniqueHistorical || {};
    const live = data?.confidence?.exactMethodLive || {};
    const current = data?.confidence?.currentRecommendation || {};
    $('trackConfidenceGrid').innerHTML = [
      gradeCard('ثقة التكنيك التاريخية', historical,
        `<span>${fmt(historical.sessions,0)} جلسة</span><span>Win ${pct(historical.sessionWinRatePct,1)}</span><span>PF ${fmt(historical.profitFactor,2)}</span><span>DD ${pct(historical.maximumDrawdownPct,1)}</span>`),
      gradeCard('الثقة الحية لنفس التكنيك', live,
        `<span>${fmt(live.resolvedSessions,0)} جلسة حية محسومة</span><span>متوسط ${pct(live.averageNetReturnPct,2)}</span><span>Backfill منفصل ${fmt(live.retroactivelyResolvedSessionsShownSeparately,0)}</span>`),
      gradeCard('ثقة التوصيات الحالية', current,
        `<span>${esc(confidenceLabel(current.status))}</span><span>سقف العرض ${pct(current.displayConfidenceCapPct,0)}</span><span>جلسة ${esc(current.currentSessionDate || '—')}</span>`),
    ].join('');

    $('trackRecordStatus').textContent = current.executionReady ? 'تنفيذ مشروط' : 'Research Only';
    $('trackRecordStatus').classList.toggle('blocked', !current.executionReady);
    $('trackRecordDisclosure').textContent = data?.policy?.disclosureAr || 'الـBackfill لا يتحول إلى دليل حي.';

    const exact = data?.exactMethodRecordedSessions || { summary: {}, sessions: [] };
    $('exactMethodSummary').innerHTML = `<span class="chip">المسجل ${fmt(exact.summary.recordedSessions,0)}</span><span class="chip">حي أصلي محسوم ${fmt(exact.summary.originalLiveResolvedSessions,0)}</span><span class="chip">محسوم رجعيًا ${fmt(exact.summary.retroactivelyResolvedSessions,0)}</span><span class="chip">متوسط الحي ${pct(exact.summary.originalLiveAverageNetReturnPct,2)}</span>`;
    $('exactMethodRows').innerHTML = (exact.sessions || []).length ? exact.sessions.map(row => `<tr>
      <td>${esc(row.signalDate)}</td><td class="wide">${esc((row.tickers || []).join(' · '))}</td>
      <td><span class="track-status ${row.originalLiveResolved ? 'win' : 'pending'}">${esc(statusAr(row.originalStatus))}</span></td>
      <td><span class="track-status ${statusClass(row.retroactiveStatus,row.retroactiveNetReturnPct)}">${esc(statusAr(row.retroactiveStatus))}</span></td>
      <td class="${finite(row.retroactiveNetReturnPct)>0?'positive':finite(row.retroactiveNetReturnPct)<0?'negative':'muted'}">${pct(row.retroactiveNetReturnPct,3)}</td>
      <td>${row.originalLiveResolved ? 'Live أصلي' : 'Backfill منفصل'}</td></tr>`).join('') : '<tr><td colspan="6" class="track-empty">لا توجد جلسات مسجلة.</td></tr>';

    const native = data?.nativeV17 || { summary: {}, entries: [] };
    $('nativeSummary').innerHTML = `<span class="chip">صادرة ${fmt(native.summary.issuedSessions,0)}</span><span class="chip">محسومة ${fmt(native.summary.resolvedSessions,0)}</span><span class="chip">فوز ${fmt(native.summary.wins,0)}</span><span class="chip">خسارة ${fmt(native.summary.losses,0)}</span><span class="chip">متوسط ${pct(native.summary.averageBasketReturnPct,3)}</span>`;
    $('nativeRows').innerHTML = (native.entries || []).length ? native.entries.map(row => `<tr><td>${esc(row.signalDate)}</td><td>${esc(row.engineId)}</td><td class="wide">${esc((row.tickers||[]).join(' · '))}</td><td><span class="track-status ${row.resolved?'win':'pending'}">${esc(statusAr(row.status))}</span></td><td>${esc(row.outcomeDate)}</td><td class="${finite(row.basketSleeveReturnPct)>0?'positive':finite(row.basketSleeveReturnPct)<0?'negative':'muted'}">${pct(row.basketSleeveReturnPct,3)}</td></tr>`).join('') : '<tr><td colspan="6" class="track-empty">لم يصدر سجل V17 حي بعد.</td></tr>';

    const backfill = data?.recordedRecommendationBackfill || { summary: {}, records: [] };
    $('backfillSummary').innerHTML = `<span class="chip">مسجلة ${fmt(backfill.summary.recordedRecommendations,0)}</span><span class="chip">محسومة/مقيّمة ${fmt(backfill.summary.resolvedWithStoredOrTrustedBackfill,0)}</span><span class="chip">نفس التكنيك ${fmt(backfill.summary.sameTechniqueRecordedRecommendations,0)}</span><span class="chip">متوسط الكل ${pct(backfill.summary.averageNetReturnPct,3)}</span>`;
    const renderBackfill = () => {
      const sameOnly = $('trackStrategyFilter')?.value !== 'all';
      const rows = (backfill.records || []).filter(row => !sameOnly || row.strategyId === 'V16_9_EQUAL_WEIGHT_BASKET');
      $('backfillRows').innerHTML = rows.length ? rows.map(row => `<tr><td>${esc(row.recommendationDate)}</td><td><b>${esc(row.ticker)}</b></td><td class="wide">${esc(row.strategyLabelAr || row.strategyId)}</td><td><span class="track-status ${statusClass(row.status,row.netReturnPct)}">${esc(statusAr(row.status))}</span></td><td class="${finite(row.netReturnPct)>0?'positive':finite(row.netReturnPct)<0?'negative':'muted'}">${pct(row.netReturnPct,3)}</td><td>${row.provenance === 'RECORDED_ORIGINAL_EVALUATION' ? 'تقييم أصلي مسجل' : row.provenance?.includes('RETROACTIVE') ? 'Backfill OHLC موثوق' : 'بانتظار تاريخ موثوق'}</td></tr>`).join('') : '<tr><td colspan="6" class="track-empty">لا توجد سجلات مطابقة.</td></tr>';
    };
    $('trackStrategyFilter')?.addEventListener('change', renderBackfill);
    renderBackfill();

    const research = data?.historicalResearchSessions || { summary: {}, recentSessions: [] };
    $('researchSummary').innerHTML = `<span class="chip">${fmt(research.summary.sessions,0)} جلسة</span><span class="chip">متوسط ${pct(research.summary.averageNetReturnPct,3)}</span><span class="chip">Win ${pct(research.summary.sessionWinRatePct,1)}</span><span class="chip">PF ${fmt(research.summary.profitFactor,3)}</span><span class="chip">DD ${pct(research.summary.maximumDrawdownPct,2)}</span>`;
    $('researchRows').innerHTML = (research.recentSessions || []).length ? research.recentSessions.slice().reverse().map(row => `<tr><td>${esc(row.signalDate)}</td><td>${esc(row.outcomeDate)}</td><td>${fmt(row.basketSize,0)}</td><td class="wide">${esc((row.tickers||[]).join(' · '))}</td><td class="${finite(row.netReturnPct)>0?'positive':finite(row.netReturnPct)<0?'negative':'muted'}">${pct(row.netReturnPct,3)}</td></tr>`).join('') : '<tr><td colspan="5" class="track-empty">ملخص البحث متاح، لكن تفاصيل الجلسات غير مضمنة.</td></tr>';
  }

  async function load() {
    ensureUi();
    try {
      const response = await fetch(`${TRACK_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.schemaVersion !== '17.0.0-recommendation-track-record-1') throw new Error('Unexpected track-record schema');
      if (data?.policy?.backfillCountsAsNativeV17Evidence !== false) throw new Error('Backfill/live evidence separation failed');
      render(data);
    } catch (error) {
      console.warn('V17 recommendation track record unavailable:', error);
      if ($('trackRecordStatus')) {
        $('trackRecordStatus').textContent = 'غير متاح';
        $('trackRecordStatus').classList.add('blocked');
      }
      if ($('trackRecordDisclosure')) $('trackRecordDisclosure').textContent = 'تعذر تحميل سجل التقييم. لم يتم تغيير التوصيات أو بوابات التنفيذ.';
    }
  }

  load();
})();
