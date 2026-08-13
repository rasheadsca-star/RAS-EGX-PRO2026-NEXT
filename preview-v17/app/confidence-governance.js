'use strict';

(() => {
  const STATUS_URL = '../../data/v17/resilient-session-status.json';

  async function readStatus() {
    const response = await fetch(`${STATUS_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function parsePercent(text) {
    const match = String(text || '').match(/ثقة البحث:\s*([0-9]+(?:\.[0-9]+)?)%/);
    return match ? Number(match[1]) : null;
  }

  function applyCap(status) {
    const mode = status?.mode || 'UNKNOWN';
    const cap = Number(status?.confidencePolicy?.confidenceCapPct);
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
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => status && applyCap(status), 20);
  });

  readStatus()
    .then(value => {
      status = value;
      applyCap(status);
      const grid = document.getElementById('recommendationGrid');
      if (grid) observer.observe(grid, { childList: true, subtree: true, characterData: true });
    })
    .catch(error => console.warn('V17 confidence governance unavailable:', error));
})();
