(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const numeric = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const num = (value, digits = 2) => { const n = numeric(value); return n === null ? '—' : n.toLocaleString('ar-EG', {maximumFractionDigits:digits}); };
  const pct = value => numeric(value) === null ? '—' : `${num(value,2)}%`;

  async function loadJson(url) {
    const response = await fetch(url, {cache:'no-store'});
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }
  function requiredCount(total, pctThreshold) {
    const t = numeric(total); const p = numeric(pctThreshold);
    return t === null || p === null ? null : Math.ceil(t * p / 100 - 1e-9);
  }
  function gap(required, current) {
    const r = numeric(required); const c = numeric(current);
    return r === null || c === null ? null : Math.max(0, r - c);
  }
  function card(title, currentText, targetText, gapText, passed) {
    return `<article class="quality-card tone-${passed ? 'good' : 'bad'}"><span>${esc(title)}</span><strong>${esc(currentText)}</strong><small>${esc(targetText)}${gapText ? ` • ${esc(gapText)}` : ''}</small></article>`;
  }

  async function render() {
    const [gate, sr] = await Promise.all([
      loadJson('../data/v17/resilient-session-status.json'),
      loadJson('../data/v17/internal-ohlc-support-resistance.json')
    ]);
    const sessionDate = gate.priceTruth?.verifiedSessionDate || null;
    if (!sessionDate || sr.referenceSessionDate !== sessionDate) throw new Error('Execution Gap source-session mismatch');

    const thresholds = sr.thresholds || {};
    const total = numeric(sr.candidateUniverseCount) || 0;
    const trusted = numeric(sr.candidateTrustedCount) || 0;
    const fresh = numeric(sr.candidateTrustedFreshCount) || 0;
    const coveragePct = numeric(sr.candidateCoveragePct);
    const freshnessPct = numeric(sr.candidateFreshnessPct);
    const criticalPct = numeric(sr.criticalFieldsPct);
    const avgConfidence = numeric(sr.averageFreshConfidence);
    const coverageThreshold = numeric(thresholds.minimumCandidateCoveragePct) ?? 95;
    const freshnessThreshold = numeric(thresholds.minimumCandidateFreshnessPct) ?? 98;
    const criticalThreshold = numeric(thresholds.minimumCandidateCriticalFieldsPct) ?? 95;
    const confidenceThreshold = numeric(thresholds.minimumAverageFreshConfidence) ?? 0.8;
    const requiredTrusted = requiredCount(total, coverageThreshold);
    const requiredFresh = requiredCount(total, freshnessThreshold);
    const requiredCritical = requiredCount(total, criticalThreshold);
    const trustedGap = gap(requiredTrusted, trusted);
    const freshGap = gap(requiredFresh, fresh);
    const criticalCurrentCount = total && criticalPct !== null ? Math.round(total * criticalPct / 100) : null;
    const criticalGap = gap(requiredCritical, criticalCurrentCount);
    const conflicts = Array.isArray(sr.sourceConflicts) ? sr.sourceConflicts : [];
    const missing = Array.isArray(sr.missingCandidateSymbols) ? sr.missingCandidateSymbols : [];
    const candidateSet = new Set((sr.candidateSymbols || []).map(String));
    const staleTrusted = (sr.rows || []).filter(row => candidateSet.has(String(row.ticker)) && row.trustedProvenance === true && row.levelSessionDate !== sessionDate).map(row => row.ticker);
    const numericalQualityPassed = trustedGap === 0 && freshGap === 0 && criticalGap === 0 && avgConfidence !== null && avgConfidence >= confidenceThreshold;

    const section = document.createElement('section');
    section.id = 'executionGapPanel';
    section.className = 'health-panel';
    section.setAttribute('aria-labelledby','executionGapTitle');
    section.innerHTML = `
      <div class="panel-heading">
        <div><span class="eyebrow">Derived read-only gap</span><h2 id="executionGapTitle">المتبقي رقميًا للوصول إلى شروط Execution S/R</h2></div>
        <span id="executionGapBadge" class="health-pill ${numericalQualityPassed && conflicts.length === 0 && sr.executionCandidateReady === true ? 'pill-good' : 'pill-bad'}">${sr.executionCandidateReady === true ? 'Ready' : 'Not ready'}</span>
      </div>
      <p class="panel-note">هذه الحسابات مشتقة مباشرة من thresholds وcandidate counts داخل <code>data/v17/internal-ohlc-support-resistance.json</code>. لا تغيّر بوابة V17 ولا تضمن Execution Grade؛ يجب إعادة بناء V17 gate بعد تحسن الأدلة.</p>
      <div class="quality-grid">
        ${card('Trusted coverage', `${trusted}/${total} (${pct(coveragePct)})`, `المطلوب ≥ ${requiredTrusted}/${total} (${pct(coverageThreshold)})`, trustedGap ? `ناقص ${trustedGap} trusted candidate` : 'Passed', trustedGap === 0)}
        ${card('Trusted freshness', `${fresh}/${total} (${pct(freshnessPct)})`, `المطلوب ≥ ${requiredFresh}/${total} (${pct(freshnessThreshold)})`, freshGap ? `ناقص ${freshGap} trusted-fresh slots` : 'Passed', freshGap === 0)}
        ${card('Critical fields', `${criticalCurrentCount ?? '—'}/${total} (${pct(criticalPct)})`, `المطلوب ≥ ${requiredCritical}/${total} (${pct(criticalThreshold)})`, criticalGap ? `ناقص ${criticalGap} candidate-equivalent` : 'Passed', criticalGap === 0)}
        ${card('Average fresh confidence', avgConfidence === null ? '—' : num(avgConfidence,3), `المطلوب ≥ ${num(confidenceThreshold,2)}`, avgConfidence !== null && avgConfidence >= confidenceThreshold ? 'Passed حاليًا — يجب الحفاظ عليه بعد الإصلاح' : 'دون الحد', avgConfidence !== null && avgConfidence >= confidenceThreshold)}
        ${card('Critical candidate conflicts', String(conflicts.length), 'المطلوب 0', conflicts.length ? `حل ${conflicts.map(x=>x.symbol).filter(Boolean).join('، ') || conflicts.length}` : 'Passed', conflicts.length === 0)}
        ${card('Internal execution candidate', sr.executionCandidateReady ? 'true' : 'false', 'المطلوب true بعد إعادة الحساب', sr.executionCandidateReady ? 'Passed' : 'يعاد تقييمه بعد استيفاء الجودة والتعارض', sr.executionCandidateReady === true)}
      </div>
      <div class="health-two-col" style="margin-top:14px">
        <article class="health-panel" style="margin:0"><div class="panel-heading"><div><span class="eyebrow">Missing candidates</span><h3>الرموز الناقصة حاليًا</h3></div><span class="health-pill ${missing.length ? 'pill-bad' : 'pill-good'}">${missing.length}</span></div><div class="symbol-chips">${missing.length ? missing.map(x=>`<span>${esc(x)}</span>`).join('') : '<div class="empty-good">لا يوجد</div>'}</div></article>
        <article class="health-panel" style="margin:0"><div class="panel-heading"><div><span class="eyebrow">Trusted but stale</span><h3>دليل موثوق يحتاج refresh</h3></div><span class="health-pill ${staleTrusted.length ? 'pill-context' : 'pill-good'}">${staleTrusted.length}</span></div><div class="symbol-chips">${staleTrusted.length ? staleTrusted.map(x=>`<span>${esc(x)}</span>`).join('') : '<div class="empty-good">لا يوجد</div>'}</div></article>
      </div>
      <p class="context-warning">الحد الأدنى الرياضي الحالي: Coverage تحتاج +${trustedGap ?? '—'}، Freshness تحتاج +${freshGap ?? '—'}، Critical Fields تحتاج +${criticalGap ?? '—'}، والتعارضات الحرجة تحتاج ${conflicts.length}→0. إصلاح جميع الرموز الناقصة كبيانات trusted/fresh قد يرفع الأعداد، لكنه لا يُعتبر ضمانًا قبل إعادة حساب confidence وV17 gate كاملة.</p>`;

    const blockerPanel = document.querySelector('.blockers-panel');
    if (!blockerPanel) throw new Error('Health blockers panel not found for execution gap insertion');
    blockerPanel.insertAdjacentElement('afterend', section);
  }

  window.addEventListener('DOMContentLoaded', () => {
    render().catch(error => {
      console.error('Execution Readiness Gap failed:', error);
      const target = document.querySelector('.blockers-panel');
      if (target) target.insertAdjacentHTML('afterend', `<section id="executionGapPanel" class="health-panel"><div class="health-error">تعذر حساب Execution Readiness Gap: ${esc(error.message)}</div></section>`);
    });
  });
})();
