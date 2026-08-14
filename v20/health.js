(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const missing = value => value === null || value === undefined || value === '';
  const numeric = value => { if (missing(value)) return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const num = (value, digits = 1) => { const n = numeric(value); return n === null ? '—' : n.toLocaleString('ar-EG', { maximumFractionDigits: digits }); };
  const pct = value => numeric(value) === null ? '—' : `${num(value, 2)}%`;
  const boolAr = value => value === true ? 'نعم' : value === false ? 'لا' : '—';
  const statusAr = value => ({
    EXECUTION_GRADE:'Execution Grade', RESEARCH_ONLY:'بحث فقط', BLOCKED:'محظور',
    HEALTHY:'سليم', DEGRADED:'متدهور', BULLISH:'صاعد', NEUTRAL:'محايد', BEARISH:'هابط / دفاعي',
    UNVERIFIED_CURRENT_REGIME:'غير متحقق', BLOCKED_UNTIL_VERIFIED_PROVENANCE:'محظور حتى توثيق المصدر'
  }[value] || value || '—');

  const blockerMeta = {
    INTERNAL_SR_COVERAGE_BELOW_95: ['تغطية الدعم والمقاومة الداخلية أقل من حد التنفيذ', 'تغطية S/R الحالية لا تستوفي بوابة V17.'],
    INTERNAL_SR_FRESHNESS_BELOW_98: ['حداثة الدعم والمقاومة الداخلية أقل من حد التنفيذ', 'Freshness الخاصة بـS/R لا تستوفي شرط التنفيذ.'],
    CRITICAL_FIELDS_BELOW_95: ['الحقول الحرجة دون حد التنفيذ', 'نسبة الحقول الحرجة الحالية أقل من متطلب بوابة V17.'],
    CRITICAL_SOURCE_CONFLICT: ['تعارض حرج بين المصادر', 'يوجد تعارض مصدر مصنف Critical داخل بوابة V17.'],
    INTERNAL_SR_NOT_EXECUTION_CANDIDATE: ['S/R ليس Execution Candidate', 'الدعم والمقاومة متاحان للبحث لكن لم يصلا إلى حالة التنفيذ.']
  };

  async function loadJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  function pill(ok, context = false) {
    return context ? 'health-pill pill-context' : ok ? 'health-pill pill-good' : 'health-pill pill-bad';
  }

  function readinessCard({ title, value, detail, ok, context = false }) {
    const state = context ? 'سياق' : ok ? 'Passed' : 'Blocked';
    return `<article class="readiness-card ${context ? 'is-context' : ok ? 'is-good' : 'is-bad'}"><div><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div><em class="${pill(ok, context)}">${esc(state)}</em></article>`;
  }

  function detailRows(rows) {
    return rows.map(([label, value]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function qualityCard(title, main, detail, tone = 'neutral') {
    return `<article class="quality-card tone-${tone}"><span>${esc(title)}</span><strong>${esc(main)}</strong><small>${esc(detail)}</small></article>`;
  }

  async function load() {
    try {
      const [current, sourceHealth, gate, technical, sector, regime, forward] = await Promise.all([
        loadJson('../data/v20/current.json'),
        loadJson('../data/v20/source-health.json'),
        loadJson('../data/v17/resilient-session-status.json'),
        loadJson('../data/v20/technical-history-status.json'),
        loadJson('../data/v20/sector-provenance-audit.json'),
        loadJson('../data/v20/market-regime.json'),
        loadJson('../data/v20/forward-evaluation.json')
      ]);

      if (sourceHealth.sessionDate !== current.sessionDate || gate.priceTruth?.verifiedSessionDate !== current.sessionDate) {
        throw new Error('عدم تطابق جلسة Source Health أو V17 Price Truth مع جلسة V20 الحالية');
      }
      if (technical.asOfSessionDate !== current.sessionDate || regime.asOfSessionDate !== current.sessionDate || forward.asOfSessionDate !== current.sessionDate) {
        throw new Error('إحدى طبقات Technical / Market Regime / Forward ليست متزامنة مع جلسة V20 الحالية');
      }

      renderHero(current, sourceHealth);
      renderBlockers(gate);
      renderReadiness(gate, sourceHealth, technical, sector, regime, forward);
      renderConflicts(sourceHealth);
      renderMissing(sourceHealth);
      renderQuality(sourceHealth, technical, sector, forward);
      renderMarket(regime, current);
      renderForward(forward);
      renderProvenance(sourceHealth);
    } catch (error) {
      $('healthTitle').textContent = 'تعذر إكمال فحص صحة القرار';
      $('healthSubtitle').textContent = 'لم يتم استبدال البيانات المفقودة بقيم افتراضية.';
      $('healthError').classList.remove('hidden');
      $('healthError').textContent = `خطأ تحميل Health Center: ${error.message}`;
    }
  }

  function renderHero(current, sourceHealth) {
    const execution = current.executionStatus || 'BLOCKED';
    $('healthSession').textContent = `جلسة ${current.sessionDate || '—'}`;
    $('healthExecution').textContent = statusAr(execution);
    $('healthDataState').textContent = `Data: ${statusAr(sourceHealth.status)}`;
    $('healthTitle').textContent = execution === 'EXECUTION_GRADE'
      ? 'بوابة التنفيذ مفتوحة وفق الأدلة الحالية'
      : execution === 'RESEARCH_ONLY'
        ? 'المنصة في وضع البحث فقط — بوابة التنفيذ مغلقة'
        : 'التنفيذ محظور وفق البوابة الحالية';
    $('healthSubtitle').textContent = 'هذه الصفحة تشرح حالة الأدلة الحالية كما سجلتها V17 وV20؛ ولا تمنح Execution Grade من تلقاء نفسها.';
    $('healthCoverage').textContent = pct(sourceHealth.coveragePct);
    $('healthFreshness').textContent = pct(sourceHealth.freshnessPct);
    $('healthCritical').textContent = pct(sourceHealth.criticalFieldsPct);
    $('healthSourceAge').textContent = numeric(sourceHealth.sourceAgeMinutes) === null ? '—' : `${num(sourceHealth.sourceAgeMinutes, 1)} دقيقة`;
    $('healthLastUpdate').textContent = sourceHealth.lastSourceUpdate || '—';
  }

  function renderBlockers(gate) {
    const reasons = Array.isArray(gate.reasons) ? gate.reasons : [];
    $('blockerCount').textContent = `${reasons.length} أسباب`;
    $('blockerCount').className = reasons.length ? 'health-pill pill-bad' : 'health-pill pill-good';
    $('blockerGrid').innerHTML = reasons.length ? reasons.map(code => {
      const [title, detail] = blockerMeta[code] || [code, 'سبب مسجل بواسطة بوابة V17 دون إعادة تفسير.'];
      return `<article class="blocker-card"><span class="blocker-code">${esc(code)}</span><strong>${esc(title)}</strong><p>${esc(detail)}</p></article>`;
    }).join('') : '<div class="empty-good">لا توجد أسباب حظر مسجلة في V17 gate.</div>';
  }

  function renderReadiness(gate, sourceHealth, technical, sector, regime, forward) {
    const cards = [
      {
        title:'تزامن جلسة القرار', value: boolAr(gate.sessionAligned),
        detail:`V17 / ${gate.priceTruth?.verifiedSessionDate || '—'}`, ok: gate.sessionAligned === true && gate.priceTruth?.sourceSessionVerified === true
      },
      {
        title:'Price Truth', value: gate.priceTruth?.healthy ? 'سليم' : 'غير سليم',
        detail:`Market coverage ${pct(gate.priceTruth?.marketCoveragePct)} • Source ${pct(gate.priceTruth?.sourceCoveragePct)}`, ok: gate.priceTruth?.healthy === true && gate.priceTruth?.stale === false
      },
      {
        title:'Liquidity Gate', value: gate.executionInputs?.liquidityGatePassed ? 'Passed' : 'Blocked',
        detail:`${num(gate.executionInputs?.liquidity?.candidateExecutionOkCount,0)} مؤهل من ${num(gate.executionInputs?.liquidity?.candidateUniverseCount,0)}`, ok: gate.executionInputs?.liquidityGatePassed === true
      },
      {
        title:'Support / Resistance', value: sourceHealth.supportResistance?.executionCandidateReady ? 'Execution Candidate' : 'Research only',
        detail:`Coverage ${pct(gate.executionInputs?.internal?.coveragePct)} • Freshness ${pct(gate.executionInputs?.internal?.freshnessPct)}`, ok: sourceHealth.supportResistance?.executionCandidateReady === true
      },
      {
        title:'Technical Evidence', value: `${pct(technical.currentTechnicalCoveragePct)} حالي`,
        detail:`${num(technical.currentTechnicalReadyCount,0)}/${num(technical.requestedSymbols,0)} من نطاق الفرص الحالي`, context:true
      },
      {
        title:'Sector Provenance', value: `${num(sector.summary?.productionVerifiedCount,0)}/${num(sector.summary?.universeCount,0)} موثق إنتاجيًا`,
        detail:'Sector concentration غير مفعّل دون مصدر authoritative', context:true
      },
      {
        title:'Market Regime', value: regime.verified ? statusAr(regime.regime) : 'غير متحقق',
        detail:`Evidence coverage ${pct(regime.metrics?.participationPct)} • لا يؤثر في Execution Gate`, context:true
      },
      {
        title:'Forward Evidence', value: `${num(forward.resolutionStatus?.resolvedCount,0)} محسوم / ${num(forward.resolutionStatus?.pendingCount,0)} Pending`,
        detail:`Embedded regression: ${forward.evaluationRegression?.ok === true ? 'Passed' : 'Not passed'}`, context:true
      }
    ];
    $('readinessGrid').innerHTML = cards.map(readinessCard).join('');
  }

  function renderConflicts(sourceHealth) {
    const rows = Array.isArray(sourceHealth.sourceConflicts) ? sourceHealth.sourceConflicts : [];
    $('conflictCount').textContent = String(rows.length);
    $('conflictCount').className = rows.length ? 'health-pill pill-bad' : 'health-pill pill-good';
    $('conflictList').innerHTML = rows.length ? rows.map(row => `<div class="stack-item"><div><strong>${esc(row.symbol || '—')}</strong><small>${esc(row.source || '—')} • ${esc(row.state || '—')}</small></div><span>${numeric(row.maxDiffPct) === null ? '—' : `${num(row.maxDiffPct,2)}%`}</span></div>`).join('') : '<div class="empty-good">لا توجد تعارضات مصادر حرجة مسجلة.</div>';
  }

  function renderMissing(sourceHealth) {
    const rows = Array.isArray(sourceHealth.missingSymbols) ? sourceHealth.missingSymbols : [];
    $('missingCount').textContent = String(rows.length);
    $('missingCount').className = rows.length ? 'health-pill pill-bad' : 'health-pill pill-good';
    $('missingSymbols').innerHTML = rows.length ? rows.map(ticker => `<span>${esc(ticker)}</span>`).join('') : '<div class="empty-good">لا توجد رموز ناقصة مسجلة.</div>';
  }

  function renderQuality(sourceHealth, technical, sector, forward) {
    const semantic = sourceHealth.semanticRowQuality || {};
    const cards = [
      qualityCard('OHLC كامل دلاليًا', `${num(semantic.completeRows,0)} صف`, `${num(semantic.partialRows,0)} Partial • ${num(semantic.ohlcInvalidOrIncompleteRows,0)} OHLC ناقص`, semantic.partialRows ? 'warn' : 'good'),
      qualityCard('Non-positive OHLC معروض كرقم', num(semantic.nonPositiveOhlcExposedAsNumeric,0), 'يجب أن يبقى صفرًا بعد Null Semantics hardening', semantic.nonPositiveOhlcExposedAsNumeric === 0 ? 'good' : 'bad'),
      qualityCard('Technical حالي موثوق', `${num(technical.currentTechnicalReadyCount,0)}/${num(technical.requestedSymbols,0)}`, `Historical ready ${num(technical.historicalIndicatorReadyCount,0)} • Current ${pct(technical.currentTechnicalCoveragePct)}`, 'context'),
      qualityCard('Sector موثق إنتاجيًا', `${num(sector.summary?.productionVerifiedCount,0)}/${num(sector.summary?.universeCount,0)}`, `Research candidates ${num(sector.summary?.researchCandidateCount,0)} • لا inference للإنتاج`, sector.summary?.productionVerifiedCount ? 'good' : 'context'),
      qualityCard('Forward immutable signals', num(forward.resolutionStatus?.signalCount,0), `${num(forward.resolutionStatus?.evaluationCount,0)} evaluations • Regression ${forward.evaluationRegression?.ok === true ? 'Passed' : 'Not passed'}`, forward.evaluationRegression?.ok === true ? 'good' : 'bad'),
      qualityCard('Future rows rejected', num(forward.historyEvidence?.futureRowsRejected,0), 'Forward resolver لا يسمح بتسريب جلسات بعد as-of', forward.historyEvidence?.futureRowsRejected === 0 ? 'good' : 'context')
    ];
    $('qualityGrid').innerHTML = cards.join('');
  }

  function renderMarket(regime, current) {
    $('healthRegimeBadge').textContent = regime.verified ? statusAr(regime.regime) : 'غير متحقق';
    $('healthRegimeBadge').className = pill(regime.verified === true, true);
    $('marketContext').innerHTML = detailRows([
      ['الجلسة', regime.asOfSessionDate || '—'],
      ['الحالة', regime.verified ? statusAr(regime.regime) : 'غير متحقق'],
      ['تغطية الدليل', pct(regime.metrics?.participationPct)],
      ['درجة التصنيف', num(regime.classificationScore,0)],
      ['A/D', `${num(regime.metrics?.advances,0)} صاعد / ${num(regime.metrics?.declines,0)} هابط`],
      ['فوق SMA20 / SMA50', `${pct(regime.metrics?.aboveSma20Pct)} / ${pct(regime.metrics?.aboveSma50Pct)}`],
      ['Execution influence', boolAr(regime.methodology?.executionGateInfluence)],
      ['حالة V20 التنفيذية', statusAr(current.executionStatus)]
    ]);
  }

  function renderForward(forward) {
    const s = forward.resolutionStatus || {};
    $('forwardBadge').textContent = s.resolvedCount ? `${num(s.resolvedCount,0)} Resolved` : `${num(s.pendingCount,0)} Pending`;
    $('forwardBadge').className = s.pendingCount ? 'health-pill pill-context' : 'health-pill pill-good';
    const calendar = (forward.calendarEvidence || [])[0] || {};
    $('forwardContext').innerHTML = detailRows([
      ['As-of', forward.asOfSessionDate || '—'],
      ['Signals', num(s.signalCount,0)],
      ['Evaluations', num(s.evaluationCount,0)],
      ['Resolved / Pending', `${num(s.resolvedCount,0)} / ${num(s.pendingCount,0)}`],
      ['جلسات مستقبلية مقبولة', num((calendar.acceptedSessions || []).length,0)],
      ['Trusted histories', `${num(forward.historyEvidence?.trustedHistoryTickerCount,0)}/${num(forward.historyEvidence?.requestedTickerCount,0)}`],
      ['Embedded regression', forward.evaluationRegression?.ok === true ? 'Passed' : 'Not passed'],
      ['Research → Production', 'ممنوع']
    ]);
  }

  function renderProvenance(sourceHealth) {
    const sources = [
      ['V17 execution gate', '../data/v17/resilient-session-status.json'],
      ['V20 source health', '../data/v20/source-health.json'],
      ['Technical status', '../data/v20/technical-history-status.json'],
      ['Sector provenance', '../data/v20/sector-provenance-audit.json'],
      ['Market regime', '../data/v20/market-regime.json'],
      ['Forward authoritative evidence', '../data/v20/forward-evaluation.json']
    ];
    const declared = sourceHealth.provenance || {};
    $('provenanceList').innerHTML = sources.map(([label,file]) => `<div class="provenance-row"><span>${esc(label)}</span><code>${esc(file)}</code></div>`).join('') + Object.entries(declared).map(([label,file]) => `<div class="provenance-row secondary"><span>${esc(label)}</span><code>${esc(file)}</code></div>`).join('');
  }

  load();
})();
