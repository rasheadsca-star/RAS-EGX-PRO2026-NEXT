'use strict';
(() => {
  if (window.__V169_ACTIVE_POSITION_MANAGER__) return;
  window.__V169_ACTIVE_POSITION_MANAGER__ = true;

  const LOCAL_URL = '../../data/stable/v16-active-position-manager.json';
  const RAW_URL = 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-active-position-manager.json';
  const PORTFOLIO_KEY = 'egx-v137-portfolio';
  const POLL_MS = 60 * 1000;
  const STYLE_ID = 'v169ActivePositionManagerStyle';
  const MARKER_CLASS = 'v169-position-action';
  let latest = null;
  let timer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const fmt = (v, d = 3) => num(v) === null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d });

  function readPortfolio() {
    try {
      const rows = JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || '[]');
      return new Map((Array.isArray(rows) ? rows : []).map(row => [
        String(row.ticker || '').toUpperCase(),
        { quantity: num(row.quantity), averagePrice: num(row.averagePrice) }
      ]));
    } catch {
      return new Map();
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${MARKER_CLASS}{margin-top:12px;padding:11px 12px;border-radius:12px;border:1px solid #31566b;background:#0b1a26;display:grid;gap:7px;direction:rtl;text-align:right}
      .${MARKER_CLASS} .pm-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
      .${MARKER_CLASS} .pm-badge{font-size:14px;font-weight:900;padding:7px 10px;border-radius:999px;background:#17384b;color:#e6f7ff;white-space:nowrap}
      .${MARKER_CLASS}[data-tone="danger"]{border-color:#9b4a53;background:#31191e}.pm-badge[data-tone="danger"]{background:#682d36;color:#ffe6e9}
      .${MARKER_CLASS}[data-tone="profit"]{border-color:#8d6b2c;background:#2e2616}.pm-badge[data-tone="profit"]{background:#68501e;color:#fff0b4}
      .${MARKER_CLASS}[data-tone="hold"]{border-color:#2f7a62;background:#102b25}.pm-badge[data-tone="hold"]{background:#1c5a46;color:#d9fff0}
      .${MARKER_CLASS}[data-tone="reentry"]{border-color:#35718e;background:#102735}.pm-badge[data-tone="reentry"]{background:#1f5670;color:#e0f7ff}
      .${MARKER_CLASS}[data-tone="warning"]{border-color:#8c692d;background:#302617}.pm-badge[data-tone="warning"]{background:#5c431c;color:#ffe4a7}
      .${MARKER_CLASS}[data-tone="watch"]{border-color:#555d78;background:#1b1e2c}.pm-badge[data-tone="watch"]{background:#353b56;color:#eef0ff}
      .${MARKER_CLASS} .pm-reason{font-size:13px;color:#d0e3eb;line-height:1.65;font-weight:700}
      .${MARKER_CLASS} .pm-context{font-size:12px;color:#9cb7c4;line-height:1.55}
      .${MARKER_CLASS} .pm-levels{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:#b8d1dc}
      .${MARKER_CLASS} .pm-levels span{padding:5px 7px;border-radius:8px;background:#0e2937;border:1px solid #244657}
      .${MARKER_CLASS} .pm-local{font-size:11px;color:#a9f1d3;font-weight:800}
      .${MARKER_CLASS} .pm-time{font-size:10px;color:#7895a4}
    `;
    document.head.appendChild(style);
  }

  async function fetchJson(url) {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}pm=${Date.now()}`, {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function loadManager() {
    try {
      return await fetchJson(RAW_URL);
    } catch (_) {
      return fetchJson(LOCAL_URL);
    }
  }

  function personalize(row, holding) {
    const base = { ...(row.action || {}) };
    if (!holding || !(holding.quantity > 0) || !(holding.averagePrice > 0)) {
      return { ...base, localHolding: false };
    }

    const price = num(row.market?.price);
    const stop = num(row.currentRecommendation?.stopLoss);
    const target = num(row.currentRecommendation?.target1);
    const high = num(row.market?.high);
    const avg = holding.averagePrice;
    const plPct = price > 0 ? (price / avg - 1) * 100 : null;
    const targetTouched = target > 0 && ((price || 0) >= target || (high || 0) >= target);

    if (stop > 0 && price !== null && price <= stop) {
      return {
        ...base, code: 'SELL', labelAr: 'بيع / خروج', tone: 'danger',
        reasonAr: 'السهم مسجل في محفظتك والسعر وصل إلى وقف الحماية الحالي.',
        localHolding: true, holding, plPct
      };
    }
    if (targetTouched) {
      return {
        ...base, code: 'REDUCE', labelAr: 'خفف / ثبت الربح', tone: 'profit',
        reasonAr: 'السهم مسجل في محفظتك وتم لمس الهدف الحالي؛ ثبّت جزءًا من الربح بدل تحويل الهدف تلقائيًا إلى احتفاظ طويل.',
        localHolding: true, holding, plPct
      };
    }
    if (row.action?.addEligibleServerSide === true && row.currentRecommendation?.hotMomentumRisk !== true && price > 0 && price <= avg * 1.03) {
      return {
        ...base, code: 'ADD_CAUTIOUS', labelAr: 'زود كمية بحذر', tone: 'reentry',
        reasonAr: 'المركز قائم والسهم ما زال داخل نطاق إضافة صالح، والزخم غير مصنف ساخنًا. الزيادة تظل يدوية وضمن حجم المخاطرة.',
        localHolding: true, holding, plPct
      };
    }
    if (base.code === 'DO_NOT_CHASE') {
      return {
        ...base, code: 'HOLD_TODAY', labelAr: 'احتفظ — لا تزود', tone: 'hold',
        reasonAr: 'أنت تملك السهم بالفعل؛ لا حاجة لمطاردة السعر بزيادة جديدة ما دام الوقف لم يُكسر.',
        localHolding: true, holding, plPct
      };
    }
    return {
      ...base, code: 'HOLD', labelAr: 'احتفظ', tone: 'hold',
      reasonAr: 'السهم مسجل في محفظتك ولم يُكسر الوقف ولم يتحقق هدف الخروج الحالي؛ استمر في إدارة المركز وفق المستويات المنشورة.',
      localHolding: true, holding, plPct
    };
  }

  function contextText(row) {
    const cycle = row.cycle || {};
    if (cycle.repeatAfterTarget) return 'الهدف السابق تحقق · التوصية الحالية دورة جديدة وليست تمديدًا تلقائيًا للصفقة القديمة.';
    if (cycle.state === 'PRIOR_CYCLE_STILL_OPEN') return 'المركز السابق ما زال مفتوحًا حسب سجل التوصيات · إدارة مركز قائم.';
    if (cycle.repeatedRecommendation) return `السهم تكرر في سجل التوصيات ${cycle.recommendationOccurrences || 0} مرات · استمرار قوة، وليس تصنيفًا تلقائيًا طويل الأجل.`;
    return cycle.horizonInterpretationAr || 'دورة توصية حالية.';
  }

  function block(row, holding) {
    const act = personalize(row, holding);
    const local = act.localHolding
      ? `<div class="pm-local">في محفظتك: ${fmt(act.holding.quantity, 2)} سهم · متوسط ${fmt(act.holding.averagePrice, 4)}${num(act.plPct) !== null ? ` · عائد ${fmt(act.plPct, 2)}%` : ''}</div>`
      : '';
    return `
      <div class="${MARKER_CLASS}" data-tone="${esc(act.tone || 'neutral')}">
        <div class="pm-head"><strong>إدارة السهم الآن</strong><span class="pm-badge" data-tone="${esc(act.tone || 'neutral')}">${esc(act.labelAr || 'مراقبة')}</span></div>
        <div class="pm-reason">${esc(act.reasonAr || '')}</div>
        <div class="pm-context">${esc(contextText(row))}</div>
        ${local}
        <div class="pm-levels"><span>السعر ${fmt(row.market?.price, 4)}</span><span>وقف ${fmt(row.currentRecommendation?.stopLoss, 4)}</span><span>هدف ${fmt(row.currentRecommendation?.target1, 4)}</span></div>
        <div class="pm-time">تحديث آلي كل ${esc(latest?.refreshIntervalMinutes || 10)} دقائق · آخر بناء ${esc(latest?.generatedAtCairo || latest?.generatedAt || '—')}</div>
      </div>`;
  }

  function apply() {
    if (!latest || !Array.isArray(latest.recommendations)) return;
    ensureStyle();
    const portfolio = readPortfolio();
    const map = new Map(latest.recommendations.map(row => [String(row.ticker || '').toUpperCase(), row]));
    document.querySelectorAll('#v169BasketPanel .v169-card[data-ticker]').forEach(card => {
      const ticker = String(card.dataset.ticker || '').toUpperCase();
      const row = map.get(ticker);
      if (!row) return;
      const old = card.querySelector(`.${MARKER_CLASS}`);
      if (old) old.remove();
      card.insertAdjacentHTML('beforeend', block(row, portfolio.get(ticker)));
    });
  }

  async function refresh() {
    try {
      latest = await loadManager();
      apply();
    } catch (error) {
      console.warn('Active position manager refresh failed', error);
    }
  }

  const observer = new MutationObserver(() => apply());
  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    refresh();
    timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('storage', event => {
      if (event.key === PORTFOLIO_KEY) apply();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('focus', refresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
