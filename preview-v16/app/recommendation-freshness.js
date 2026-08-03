'use strict';
(() => {
  const DECISION_URL = '../../data/stable/v15-practical-decision.json';
  const REPORT_URL = '../../data/stable/v16-recommendation-freshness.json';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  async function json(url) {
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch { return null; }
  }
  function ensureStyle() {
    if (document.getElementById('recommendationFreshnessStyle')) return;
    const style = document.createElement('style');
    style.id = 'recommendationFreshnessStyle';
    style.textContent = `
      .rec-freshness-banner{margin:0 0 16px;padding:14px 16px;border-radius:14px;border:1px solid #2d7358;background:#0d3028;color:#dffff1;line-height:1.75}
      .rec-freshness-banner.stale{border-color:#a94444;background:#3a171b;color:#ffe5e5}
      .rec-freshness-banner b{display:block;margin-bottom:4px;font-size:15px}
      .rec-freshness-banner small{display:block;opacity:.85;margin-top:5px}
      .recommendation-grid[data-reference-only="true"] .rec-card{opacity:.82;border-color:#7b4b50!important}
      .reference-session-badge{display:inline-flex;margin:8px 0 0;padding:5px 8px;border-radius:999px;background:#5a262c;color:#ffe5e5;font-size:11px;font-weight:700}
    `;
    document.head.appendChild(style);
  }
  function addReferenceBadges(sessionDate) {
    const grid = document.getElementById('recommendationGrid');
    if (!grid) return;
    grid.dataset.referenceOnly = 'true';
    grid.querySelectorAll('.rec-card').forEach(card => {
      if (card.querySelector('.reference-session-badge')) return;
      const badge = document.createElement('div');
      badge.className = 'reference-session-badge';
      badge.textContent = `مرجع جلسة ${sessionDate} — ليست توصية اليوم`;
      const verdict = card.querySelector('.rec-verdict');
      (verdict || card).insertAdjacentElement(verdict ? 'beforebegin' : 'beforeend', badge);
    });
  }
  function render(decision, report) {
    ensureStyle();
    const freshness = decision?.freshness || report || {};
    const fresh = freshness.isFresh === true;
    const session = decision?.sessionDate || freshness.decisionSession || '—';
    const expected = freshness.expectedSession || '—';
    const panel = document.querySelector('#view-dashboard .recommendation-grid')?.closest('.panel');
    if (!panel) return;
    let banner = document.getElementById('recommendationFreshnessBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'recommendationFreshnessBanner';
      panel.insertBefore(banner, panel.firstChild);
    }
    banner.className = `rec-freshness-banner${fresh ? '' : ' stale'}`;
    banner.innerHTML = fresh
      ? `<b>التوصيات محدثة لجلسة ${escapeHtml(session)}</b><span>تم اعتماد أسعار الجلسة قبل عرض قائمة الفرص.</span>`
      : `<b>التوصيات لم تتغير لأنها تخص آخر جلسة موثقة: ${escapeHtml(session)}</b><span>لم يتم اعتماد بيانات جلسة ${escapeHtml(expected)} بدرجة تنفيذ، لذلك يعرض التطبيق القائمة السابقة كمرجع فقط ولا يعتبرها توصيات اليوم.</span><small>لن يتم تغيير الأسهم قسرًا من بيانات غير موثوقة.</small>`;
    const title = panel.querySelector('.panel-head h2');
    if (title) title.textContent = fresh ? 'أفضل فرص الجلسة المعتمدة' : `توصيات آخر جلسة موثقة (${session})`;
    if (!fresh) {
      addReferenceBadges(session);
      const button = document.getElementById('addPortfolioBtn');
      if (button) {
        button.disabled = true;
        button.title = 'متوقف حتى اعتماد توصيات جلسة جديدة';
      }
      const observer = new MutationObserver(() => addReferenceBadges(session));
      const grid = document.getElementById('recommendationGrid');
      if (grid) observer.observe(grid, { childList: true, subtree: true });
    }
  }
  async function start() {
    const [decision, report] = await Promise.all([json(DECISION_URL), json(REPORT_URL)]);
    let attempts = 0;
    const apply = () => {
      if (document.getElementById('recommendationGrid')) render(decision, report);
      else if (attempts++ < 40) setTimeout(apply, 250);
    };
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
