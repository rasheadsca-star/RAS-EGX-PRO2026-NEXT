'use strict';

(() => {
  const CURRENT_URL = '../../data/v17/current.json';
  const STATUS_URL = '../../data/v17/resilient-session-status.json';
  const finite = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = (value, digits = 1) => finite(value) === null ? '—' : Number(value).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  async function readJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function ensureSemantics() {
    const panel = document.querySelector('.recommendation-panel');
    const grid = document.getElementById('recommendationGrid');
    if (!panel || !grid || document.getElementById('recommendationSemantics')) return;
    const note = document.createElement('div');
    note.id = 'recommendationSemantics';
    note.className = 'recommendation-semantics';
    note.innerHTML = '<strong>معنى الدرجات</strong><span><b>Research Score</b> هو درجة ترتيب بحثي من 100 بعد قيود جودة المصدر، وليس احتمال نجاح أو ربح. <b>Execution Confidence</b> يعبّر عن أهلية التنفيذ بعد بوابات الجلسة والسيولة وS/R وExecution Grade؛ وعند غلق أي بوابة لا تُعرض نسبة تنفيذ مضللة.</span>';
    grid.insertAdjacentElement('beforebegin', note);
  }

  function executionState(row, current, status) {
    const health = current?.systemHealth || {};
    const checks = [
      ['Execution Grade', status?.executionGrade === true || health.executionGrade === true],
      ['تزامن الجلسة', status?.sessionAligned === true && health.sessionAligned === true],
      ['دعم/مقاومة موثق', row?.srVerified === true],
      ['سيولة تنفيذية', row?.liquidity?.executionLiquidityOk === true],
      ['سماح السهم بالتنفيذ', row?.executionAllowed === true],
    ];
    const passed = checks.filter(([, ok]) => ok).length;
    const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
    if (failed.length === 0) {
      return {
        tone: 'good',
        label: 'مؤهل مشروط',
        detail: `${passed}/${checks.length} بوابات مكتملة — يظل التنفيذ خاضعًا لقواعد الافتتاح وعدم مطاردة السعر.`,
      };
    }
    const structuralBlock = status?.executionGrade !== true && health.executionGrade !== true;
    return {
      tone: structuralBlock ? 'blocked' : 'warn',
      label: 'غير مؤهل للتنفيذ',
      detail: `المكتمل ${passed}/${checks.length}. البوابات غير المكتملة: ${failed.join('، ')}.`,
    };
  }

  function researchScore(row, status) {
    const raw = finite(row?.probabilityTop10Pct);
    const cap = finite(status?.confidencePolicy?.confidenceCapPct);
    const displayed = raw === null ? null : cap === null ? raw : Math.min(raw, cap);
    return { raw, cap, displayed, capped: raw !== null && cap !== null && displayed < raw };
  }

  function decorate(current, status) {
    ensureSemantics();
    const rows = new Map((current?.recommendations || []).map(row => [String(row.ticker || '').toUpperCase(), row]));
    document.querySelectorAll('.recommendation-card[data-ticker]').forEach(card => {
      const ticker = String(card.dataset.ticker || '').toUpperCase();
      const row = rows.get(ticker);
      if (!row) return;

      const meta = card.querySelector('.rec-meta');
      if (meta) {
        meta.querySelectorAll('.chip').forEach(chip => {
          if (/ثقة البحث|ثقة العرض/.test(chip.textContent || '')) chip.classList.add('legacy-confidence-chip');
        });
      }

      const research = researchScore(row, status);
      const execution = executionState(row, current, status);
      const rawText = research.raw === null ? 'غير متاح' : `${fmt(research.displayed, 1)} / 100`;
      const researchDetail = research.capped
        ? `الدرجة الخام ${fmt(research.raw, 1)}/100، وتم خفض العرض إلى ${fmt(research.displayed, 1)}/100 بسبب سقف جودة المصدر ${fmt(research.cap, 0)}/100.`
        : 'درجة ترتيب بحثي للمقارنة بين الفرص؛ ليست احتمال نجاح أو نسبة ربح.';
      const signature = JSON.stringify([research.raw, research.cap, research.displayed, research.capped, execution.tone, execution.label, execution.detail]);

      let block = card.querySelector('.recommendation-confidence');
      if (!block) {
        block = document.createElement('div');
        block.className = 'recommendation-confidence';
        const prices = card.querySelector('.rec-prices');
        if (prices) prices.insertAdjacentElement('afterend', block);
        else card.appendChild(block);
      }
      if (block.dataset.signature === signature) return;

      block.dataset.signature = signature;
      block.dataset.researchRaw = research.raw === null ? '' : String(research.raw);
      block.dataset.researchDisplayed = research.displayed === null ? '' : String(research.displayed);
      block.dataset.executionEligible = execution.tone === 'good' ? 'true' : 'false';
      block.innerHTML = `
        <div class="confidence-box research">
          <small>Research Score · درجة البحث</small>
          <strong>${esc(rawText)}</strong>
          <span>${esc(researchDetail)}</span>
          ${research.capped ? '<span class="score-cap-note">مقيد بجودة المصدر</span>' : ''}
        </div>
        <div class="confidence-box execution ${esc(execution.tone)}">
          <small>Execution Confidence · أهلية التنفيذ</small>
          <strong>${esc(execution.label)}</strong>
          <span>${esc(execution.detail)}</span>
        </div>`;
    });

    const legend = document.querySelector('.recommendation-panel .legend');
    if (legend && !legend.textContent.includes('Research Score')) {
      legend.innerHTML = '<span><i class="dot good"></i>Research Score = ترتيب بحثي</span><span><i class="dot warn"></i>Execution Confidence = بوابات التنفيذ</span>';
    }
    const subtitle = document.getElementById('engineSubtitle');
    const cap = finite(status?.confidencePolicy?.confidenceCapPct);
    if (subtitle && cap !== null && !subtitle.textContent.includes('Research Score')) {
      subtitle.textContent += ` — سقف Research Score الحالي ${fmt(cap, 0)}/100`;
    }
  }

  let current = null;
  let status = null;
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (current && status) decorate(current, status);
    }, 30);
  });

  Promise.all([readJson(CURRENT_URL), readJson(STATUS_URL)])
    .then(([currentValue, statusValue]) => {
      current = currentValue;
      status = statusValue;
      decorate(current, status);
      const grid = document.getElementById('recommendationGrid');
      if (grid) observer.observe(grid, { childList: true, subtree: true, characterData: true });
    })
    .catch(error => console.warn('V17 recommendation confidence semantics unavailable:', error));
})();
