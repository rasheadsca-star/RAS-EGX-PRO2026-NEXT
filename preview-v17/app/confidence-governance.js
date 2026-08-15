'use strict';

(() => {
  const STATUS_URL = '../../data/v17/resilient-session-status.json';
  const CURRENT_URL = '../../data/v17/current.json';

  async function readJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function parsePercent(text) {
    const match = String(text || '').match(/(?:ثقة البحث|ثقة العرض):\s*([0-9]+(?:\.[0-9]+)?)%/);
    return match ? Number(match[1]) : null;
  }

  function nextRegularEgxSessionDate(sessionDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return null;
    const cursor = new Date(`${sessionDate}T12:00:00Z`);
    if (Number.isNaN(cursor.getTime())) return null;
    do {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } while (cursor.getUTCDay() === 5 || cursor.getUTCDay() === 6);
    return cursor.toISOString().slice(0, 10);
  }

  function applySessionContext(current) {
    const basisSession = current?.currentResearch?.sessionDate || current?.sessionDate || null;
    const targetSession = nextRegularEgxSessionDate(basisSession);
    const researchOnly = current?.recommendationMode === 'CURRENT_RESEARCH_WATCH_ONLY';

    const sessionMetrics = document.getElementById('sessionMetrics');
    if (sessionMetrics) {
      const metrics = [...sessionMetrics.querySelectorAll('.metric')];
      for (const metric of metrics) {
        const label = metric.querySelector('small');
        if (!label) continue;
        if (label.textContent.trim() === 'جلسة السوق الحالية') label.textContent = 'آخر جلسة سوق مكتملة';
        if (label.textContent.trim() === 'جلسة البحث الحالي') label.textContent = 'جلسة بيانات الأساس';
      }
      if (targetSession && !sessionMetrics.querySelector('[data-v17-target-session="true"]')) {
        const targetMetric = document.createElement('div');
        targetMetric.className = 'metric positive';
        targetMetric.dataset.v17TargetSession = 'true';
        targetMetric.innerHTML = `<small>الجلسة القادمة المستهدفة</small><b>${targetSession}</b>`;
        const firstMetric = sessionMetrics.querySelector('.metric');
        if (firstMetric?.nextSibling) sessionMetrics.insertBefore(targetMetric, firstMetric.nextSibling);
        else sessionMetrics.appendChild(targetMetric);
      }
    }

    const engineTitle = document.getElementById('engineTitle');
    if (engineTitle && researchOnly && targetSession) engineTitle.textContent = `خطة مراقبة الجلسة القادمة — ${targetSession}`;

    const subtitle = document.getElementById('engineSubtitle');
    if (subtitle && basisSession) {
      const count = Array.isArray(current?.recommendations) ? current.recommendations.length : 0;
      const championSession = current?.championReference?.sessionDate || '—';
      subtitle.textContent = targetSession
        ? `${count} فرص — بيانات الأساس: ${basisSession} — الجلسة المستهدفة: ${targetSession} — Champion المرجعي: ${championSession}${researchOnly ? ' — لا أوزان استثمارية' : ' — مراجعة تنفيذية مشروطة'}`
        : `${count} فرص — بيانات الأساس: ${basisSession} — Champion المرجعي: ${championSession}`;
    }

    const disclosure = document.getElementById('decisionDisclosure');
    if (disclosure && basisSession && targetSession && !disclosure.textContent.includes(`الجلسة المستهدفة التالية ${targetSession}`)) {
      disclosure.textContent = `${current.statusAr || 'هذه الفرص للمراجعة وليست أمر شراء آليًا.'} بيانات الأساس من آخر جلسة مكتملة ${basisSession}، والجلسة المستهدفة التالية ${targetSession}.`;
    }
  }

  function applyGovernance(status, current) {
    const mode = status?.mode || 'UNKNOWN';
    const cap = Number(status?.confidencePolicy?.confidenceCapPct);
    const researchOnly = current?.recommendationMode === 'CURRENT_RESEARCH_WATCH_ONLY';

    applySessionContext(current);

    if (researchOnly) {
      const title = document.getElementById('dashboardTitle');
      if (title) title.textContent = 'فرص السوق الحالية — مراقبة فقط';
      const disclosure = document.getElementById('decisionDisclosure');
      if (disclosure && !disclosure.textContent.includes('0%')) {
        disclosure.textContent = `${disclosure.textContent || current.statusAr || 'البحث الحالي للمراقبة فقط.'} التعرض الاستثماري الحالي 0% ولا توجد أوامر شراء.`;
      }
      const legend = document.querySelector('.recommendation-panel .legend');
      if (legend) legend.innerHTML = '<span><i class="dot good"></i>فرصة بحثية</span><span><i class="dot warn"></i>التنفيذ محظور</span>';
    }

    if (!Number.isFinite(cap)) return;
    document.querySelectorAll('.recommendation-card .chip').forEach(chip => {
      const raw = parsePercent(chip.textContent);
      if (!Number.isFinite(raw)) return;
      const displayed = Math.min(raw, cap);
      if (mode === 'NORMAL' || displayed === raw) {
        chip.textContent = `ثقة البحث: ${raw.toFixed(1)}%`;
        chip.title = 'نسبة بحثية وليست ضمانًا للعائد.';
        return;
      }
      chip.textContent = `ثقة العرض: ${displayed.toFixed(1)}%`;
      chip.title = `النموذج الخام ${raw.toFixed(1)}%، لكن وضع ${mode} يفرض سقف جودة مصدر ${cap.toFixed(0)}%. هذه نسبة بحثية وليست احتمال ربح مضمونًا.`;
      chip.classList.add('warn');
    });

    const subtitle = document.getElementById('engineSubtitle');
    if (subtitle && mode !== 'NORMAL') {
      const suffix = ` — سقف ثقة العرض ${cap.toFixed(0)}% بسبب جودة المصدر`;
      if (!subtitle.textContent.includes('سقف ثقة العرض')) subtitle.textContent += suffix;
    }
  }

  let status = null;
  let current = null;
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => status && current && applyGovernance(status, current), 20);
  });

  Promise.all([readJson(STATUS_URL), readJson(CURRENT_URL)])
    .then(([statusValue, currentValue]) => {
      status = statusValue;
      current = currentValue;
      applyGovernance(status, current);
      const grid = document.getElementById('recommendationGrid');
      if (grid) observer.observe(grid, { childList: true, subtree: true, characterData: true });
      setTimeout(() => applyGovernance(status, current), 250);
    })
    .catch(error => console.warn('V17 UI governance unavailable:', error));
})();
