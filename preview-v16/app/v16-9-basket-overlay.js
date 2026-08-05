'use strict';
(() => {
  const DECISION_URL = '../../data/stable/v15-practical-decision.json';
  const STYLE_ID = 'v169BasketOverlayStyle';
  const PANEL_ID = 'v169BasketPanel';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 2) => num(value) === null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });

  async function loadDecision() {
    const response = await fetch(`${DECISION_URL}?v=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{margin-bottom:18px;border-color:#2a7d68;background:linear-gradient(145deg,#0b3028,#0b2232)}
      #${PANEL_ID} .v169-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}
      #${PANEL_ID} .v169-head h2{margin:0 0 7px}
      #${PANEL_ID} .v169-head p{margin:0;color:#a9c6d4;line-height:1.7}
      #${PANEL_ID} .v169-badge{padding:7px 10px;border-radius:999px;background:#124f40;color:#d9fff1;font-weight:800;white-space:nowrap}
      #${PANEL_ID} .v169-summary{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin:12px 0 15px}
      #${PANEL_ID} .v169-summary div{padding:12px;border:1px solid #24566a;border-radius:12px;background:#091d2a}
      #${PANEL_ID} .v169-summary small{display:block;color:#9db9c8;margin-bottom:6px}
      #${PANEL_ID} .v169-summary b{font-size:18px}
      #${PANEL_ID} .v169-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      #${PANEL_ID} .v169-card{padding:15px;border:1px solid #24566a;border-radius:15px;background:#0a2130}
      #${PANEL_ID} .v169-card.hot{border-color:#8c692d}
      #${PANEL_ID} .v169-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      #${PANEL_ID} .v169-card h3{margin:0;font-size:20px;direction:ltr;text-align:right}
      #${PANEL_ID} .v169-name{margin-top:5px;color:#bed4df}
      #${PANEL_ID} .v169-weight{padding:6px 9px;border-radius:999px;background:#153d50;font-weight:800;white-space:nowrap}
      #${PANEL_ID} .v169-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
      #${PANEL_ID} .v169-metric{padding:9px;border-radius:10px;background:#071823;border:1px solid #17384a}
      #${PANEL_ID} .v169-metric span{display:block;color:#8eacbc;font-size:11px;margin-bottom:5px}
      #${PANEL_ID} .v169-rule{margin-top:11px;padding:10px;border-radius:10px;background:#172b35;color:#d4e5ed;line-height:1.65;font-size:12px}
      #${PANEL_ID} .v169-hot{display:inline-flex;margin-top:8px;padding:4px 7px;border-radius:999px;background:#50391a;color:#ffe2a5;font-size:11px;font-weight:700}
      #${PANEL_ID} .v169-error{padding:18px;border:1px dashed #8b4c56;border-radius:12px;color:#ffd8de;background:#341820}
      @media(max-width:900px){#${PANEL_ID} .v169-grid{grid-template-columns:1fr}#${PANEL_ID} .v169-summary{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function card(row) {
    const hot = num(row.rsi14) > 80;
    return `
      <article class="v169-card${hot ? ' hot' : ''}">
        <div class="v169-card-head">
          <div><h3>${esc(row.ticker)}</h3><div class="v169-name">${esc(row.companyNameAr)}</div></div>
          <div class="v169-weight">${fmt(row.portfolioWeightPct, 1)}% من المحفظة</div>
        </div>
        ${hot ? `<span class="v169-hot">زخم ساخن — ممنوع المطاردة</span>` : ''}
        <div class="v169-metrics">
          <div class="v169-metric"><span>الدخول من</span><b>${fmt(row.entryLow, 4)}</b></div>
          <div class="v169-metric"><span>الدخول إلى</span><b>${fmt(row.entryHigh, 4)}</b></div>
          <div class="v169-metric"><span>الهدف</span><b>${fmt(row.target1, 4)}</b></div>
          <div class="v169-metric"><span>الوقف</span><b>${fmt(row.stopLoss, 4)}</b></div>
          <div class="v169-metric"><span>RSI</span><b>${fmt(row.rsi14, 1)}</b></div>
          <div class="v169-metric"><span>الحجم النسبي</span><b>${fmt(row.volumeRatio20, 2)}×</b></div>
        </div>
        <div class="v169-rule">${esc(row.morningConfirmation?.ruleAr || 'التنفيذ معلق على افتتاح داخل النطاق وسيولة مؤكدة خلال أول 10–15 دقيقة.')}</div>
      </article>`;
  }

  function render(decision) {
    ensureStyle();
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard) return false;
    const rows = Array.isArray(decision?.recommendations) ? decision.recommendations : [];
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('article');
      panel.id = PANEL_ID;
      panel.className = 'panel';
      const hero = dashboard.querySelector('.hero-grid');
      if (hero) hero.insertAdjacentElement('afterend', panel);
      else dashboard.insertAdjacentElement('afterbegin', panel);
    }

    const plan = decision?.basketPlan || {};
    if (!rows.length) {
      panel.innerHTML = `<div class="v169-error">ملف V16.9 لم يُرجع أعضاء سلة حاليًا. هذه الرسالة لا تخفي باقي نوافذ التطبيق.</div>`;
      return true;
    }

    panel.innerHTML = `
      <div class="v169-head">
        <div><h2>سلة V16.9 الحالية</h2><p>النتائج الجديدة داخل التطبيق الكامل؛ نوافذ بحث السوق والمحفظة والتحليل المالي والسجل الحي لم تُحذف.</p></div>
        <span class="v169-badge">معلقة على تأكيد الافتتاح</span>
      </div>
      <div class="v169-summary">
        <div><small>عدد الأسهم</small><b>${rows.length}</b></div>
        <div><small>إجمالي التعرض</small><b>${fmt(plan.totalAllocationPct, 1)}%</b></div>
        <div><small>السيولة المحتفظ بها</small><b>${fmt(plan.cashReservePct, 1)}%</b></div>
        <div><small>مدة الخطة</small><b>${fmt(plan.holdingSessions, 0)} جلسة</b></div>
      </div>
      <div class="v169-grid">${rows.map(card).join('')}</div>`;

    const legacyGrid = document.getElementById('recommendationGrid');
    const legacyPanel = legacyGrid?.closest('.panel');
    if (legacyPanel && legacyPanel !== panel) legacyPanel.style.display = 'none';
    return true;
  }

  async function start() {
    try {
      const decision = await loadDecision();
      let attempts = 0;
      const apply = () => {
        if (!render(decision) && attempts++ < 50) setTimeout(apply, 200);
      };
      apply();
    } catch (error) {
      console.error('V16.9 basket overlay failed', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
