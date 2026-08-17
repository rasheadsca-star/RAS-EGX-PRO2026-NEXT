'use strict';
(() => {
  const DECISION_URL = '../../data/stable/v16-main-app-current.json';
  const PRICE_TRUTH_URL = '../../data/stable/v15-price-truth.json';
  const STYLE_ID = 'v169BasketOverlayStyle';
  const PANEL_ID = 'v169BasketPanel';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 2) => num(value) === null
    ? '—'
    : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });

  async function loadJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function nextEgxTradingSession(sessionDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return null;
    const date = new Date(`${sessionDate}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    do date.setUTCDate(date.getUTCDate() + 1);
    while (date.getUTCDay() === 5 || date.getUTCDay() === 6);
    return date.toISOString().slice(0, 10);
  }

  function shortSession(sessionDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return sessionDate || '—';
    const [year, month, day] = sessionDate.split('-');
    return `${day}/${month}/${year}`;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{margin-bottom:18px;border-color:#2a7d68;background:linear-gradient(145deg,#0b3028,#0b2232);font-size:16px}
      #${PANEL_ID}.session-stale{border-color:#9b4a53;background:linear-gradient(145deg,#34191f,#0b2232)}
      #${PANEL_ID}.execution-blocked{border-color:#8c692d;background:linear-gradient(145deg,#302617,#0b2232)}
      #${PANEL_ID} .v169-head{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:12px}
      #${PANEL_ID} .v169-head h2{margin:0;font-size:25px;line-height:1.35}
      #${PANEL_ID} .v169-head p{margin:5px 0 0;color:#a9c6d4;line-height:1.55;font-size:15px}
      #${PANEL_ID} .v169-badge{padding:9px 12px;border-radius:999px;background:#124f40;color:#d9fff1;font-weight:900;white-space:nowrap;font-size:14px}
      #${PANEL_ID}.session-stale .v169-badge{background:#5b252c;color:#ffe4e7}
      #${PANEL_ID}.execution-blocked .v169-badge{background:#50391a;color:#ffe2a5}
      #${PANEL_ID} .v169-session-truth{margin:0 0 12px;padding:10px 13px;border:1px solid #2c6e66;border-radius:12px;background:#0b2927;color:#d8f8ef;line-height:1.55;font-size:15px}
      #${PANEL_ID}.session-stale .v169-session-truth{border-color:#92505a;background:#371a20;color:#ffe1e5}
      #${PANEL_ID}.execution-blocked .v169-session-truth{border-color:#8c692d;background:#332713;color:#ffe6ad}
      #${PANEL_ID} .v169-summary{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:9px;margin:10px 0 14px}
      #${PANEL_ID} .v169-summary div{padding:11px 12px;border:1px solid #24566a;border-radius:11px;background:#091d2a}
      #${PANEL_ID} .v169-summary small{display:block;color:#9db9c8;margin-bottom:4px;font-size:13px}
      #${PANEL_ID} .v169-summary b{font-size:18px}
      #${PANEL_ID} .v169-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      #${PANEL_ID} .v169-card{padding:18px;border:1px solid #24566a;border-radius:16px;background:#0a2130;box-shadow:0 8px 28px rgba(0,0,0,.12)}
      #${PANEL_ID} .v169-card.hot{border-color:#8c692d}
      #${PANEL_ID}.session-stale .v169-card{opacity:.9;border-color:#75404a}
      #${PANEL_ID}.execution-blocked .v169-card{border-color:#705625}
      #${PANEL_ID} .v169-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      #${PANEL_ID} .v169-card h3{margin:0;font-size:28px;line-height:1;direction:ltr;text-align:right;letter-spacing:.3px}
      #${PANEL_ID} .v169-name{margin-top:7px;color:#d1e3eb;font-size:17px;line-height:1.45;font-weight:700}
      #${PANEL_ID} .v169-rank{display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:42px;border-radius:12px;background:#14384c;color:#dff6ff;font-size:18px;font-weight:900;direction:ltr}
      #${PANEL_ID} .v169-priority{margin-top:14px;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,#124b3f,#12344a);border:1px solid #2c7b68;display:flex;justify-content:space-between;align-items:center;gap:12px}
      #${PANEL_ID} .v169-priority span{font-size:15px;color:#c8e7df;font-weight:700}
      #${PANEL_ID} .v169-priority b{font-size:26px;color:#f1fff9;direction:ltr}
      #${PANEL_ID} .v169-weight-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
      #${PANEL_ID} .v169-weight{padding:7px 10px;border-radius:999px;background:#153d50;font-weight:800;font-size:14px;white-space:nowrap}
      #${PANEL_ID}.session-stale .v169-weight{background:#4a252c;color:#ffe0e3}
      #${PANEL_ID}.execution-blocked .v169-weight{background:#493717;color:#ffe2a5}
      #${PANEL_ID} .v169-hot{display:inline-flex;padding:7px 10px;border-radius:999px;background:#50391a;color:#ffe2a5;font-size:14px;font-weight:800}
      #${PANEL_ID} .v169-metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:14px}
      #${PANEL_ID} .v169-metric{padding:12px;border-radius:11px;background:#071823;border:1px solid #17384a}
      #${PANEL_ID} .v169-metric span{display:block;color:#a4bdca;font-size:13px;margin-bottom:5px}
      #${PANEL_ID} .v169-metric b{font-size:19px;direction:ltr;display:block}
      #${PANEL_ID} .v169-secondary{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;color:#abc2ce;font-size:14px}
      #${PANEL_ID} .v169-secondary span{padding:6px 9px;border-radius:8px;background:#0d2937;border:1px solid #1f4658}
      #${PANEL_ID} .v169-rule{margin-top:10px;padding:10px 12px;border-radius:10px;background:#172b35;color:#e0edf3;line-height:1.5;font-size:15px;font-weight:700}
      #${PANEL_ID}.session-stale .v169-rule{background:#351e24;color:#ffe2e5}
      #${PANEL_ID}.execution-blocked .v169-rule{background:#332713;color:#ffe6ad}
      #${PANEL_ID} .v169-footnote{margin-top:12px;color:#94acb8;font-size:13px;line-height:1.5}
      #${PANEL_ID} .v169-error{padding:18px;border:1px dashed #8b4c56;border-radius:12px;color:#ffd8de;background:#341820;font-size:16px}
      @media(max-width:1050px){#${PANEL_ID} .v169-summary{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:900px){#${PANEL_ID} .v169-grid{grid-template-columns:1fr}}
      @media(max-width:560px){
        #${PANEL_ID}{font-size:17px}
        #${PANEL_ID} .v169-head{flex-direction:column;align-items:stretch}
        #${PANEL_ID} .v169-head h2{font-size:24px}
        #${PANEL_ID} .v169-badge{white-space:normal;text-align:center}
        #${PANEL_ID} .v169-summary{grid-template-columns:1fr 1fr}
        #${PANEL_ID} .v169-card{padding:16px}
        #${PANEL_ID} .v169-card h3{font-size:30px}
        #${PANEL_ID} .v169-name{font-size:18px}
        #${PANEL_ID} .v169-priority b{font-size:28px}
        #${PANEL_ID} .v169-metric b{font-size:20px}
      }
    `;
    document.head.appendChild(style);
  }

  function card(row, sessionAligned, executionEligible) {
    const hot = num(row.rsi14) > 80;
    const rank = num(row.rank) || num(row.localRank) || '—';
    const priority = num(row.estimatedTop10ProbabilityPct) ?? num(row.probabilityTop10Pct);
    const weightLabel = executionEligible
      ? `${fmt(row.portfolioWeightPct, 2)}% من المحفظة`
      : sessionAligned ? '0% تنفيذ حاليًا' : 'مرجع فقط';
    const actionText = executionEligible
      ? 'تنفيذ فقط داخل نطاق الدخول مع سيولة مؤكدة.'
      : sessionAligned ? 'التنفيذ مغلق مؤقتًا.' : 'غير صالح للتنفيذ حتى تحديث الجلسة.';

    return `
      <article class="v169-card${hot ? ' hot' : ''}" data-ticker="${esc(row.ticker)}">
        <div class="v169-card-head">
          <div><h3>${esc(row.ticker)}</h3><div class="v169-name">${esc(row.companyNameAr)}</div></div>
          <span class="v169-rank">#${esc(rank)}</span>
        </div>
        <div class="v169-priority"><span>أولوية النموذج</span><b>${fmt(priority, 2)}%</b></div>
        <div class="v169-weight-row">
          <span class="v169-weight">${esc(weightLabel)}</span>
          ${hot ? '<span class="v169-hot">زخم ساخن</span>' : ''}
        </div>
        <div class="v169-metrics">
          <div class="v169-metric"><span>نطاق الدخول</span><b>${fmt(row.entryLow, 4)} – ${fmt(row.entryHigh, 4)}</b></div>
          <div class="v169-metric"><span>السعر المرجعي</span><b>${fmt(row.close, 4)}</b></div>
          <div class="v169-metric"><span>الهدف</span><b>${fmt(row.target1, 4)}</b></div>
          <div class="v169-metric"><span>وقف الخسارة</span><b>${fmt(row.stopLoss, 4)}</b></div>
        </div>
        <div class="v169-secondary"><span>RSI ${fmt(row.rsi14, 1)}</span><span>حجم ${fmt(row.volumeRatio20, 2)}×</span></div>
        <div class="v169-rule">${esc(actionText)}</div>
      </article>`;
  }

  function render(decision, priceTruth) {
    ensureStyle();
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard) return false;

    const rows = Array.isArray(decision?.recommendations) ? decision.recommendations : [];
    const recommendationSession = decision?.sessionDate || null;
    const latestMarketSession = priceTruth?.expectedSession || decision?.dataTruth?.marketSession || null;
    const sessionAligned = Boolean(recommendationSession && latestMarketSession && recommendationSession === latestMarketSession);
    const executionGrade = decision?.dataTruth?.executionGrade === true || priceTruth?.executionGrade === true;
    const executionEligible = Boolean(sessionAligned && executionGrade && decision?.executionAllowed === true && rows.length > 0);
    const targetSession = nextEgxTradingSession(recommendationSession);

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('article');
      panel.id = PANEL_ID;
      panel.className = 'panel';
      const hero = dashboard.querySelector('.hero-grid');
      if (hero) hero.insertAdjacentElement('afterend', panel);
      else dashboard.insertAdjacentElement('afterbegin', panel);
    }

    panel.classList.toggle('session-stale', !sessionAligned);
    panel.classList.toggle('execution-blocked', sessionAligned && !executionEligible);
    panel.dataset.recommendationSession = recommendationSession || '';
    panel.dataset.marketSession = latestMarketSession || '';
    panel.dataset.sessionAligned = String(sessionAligned);
    panel.dataset.executionGrade = String(executionGrade);
    panel.dataset.executionEligible = String(executionEligible);

    const plan = decision?.portfolioPolicy || decision?.basketPlan || {};
    if (!rows.length) {
      panel.innerHTML = '<div class="v169-error">لا توجد توصيات حالية من MAIN APP.</div>';
      return true;
    }

    const title = sessionAligned ? 'توصيات MAIN APP' : 'توصيات مرجعية — جلسة غير متزامنة';
    const badge = !sessionAligned ? 'غير متزامنة' : executionEligible ? 'جاهزة للمراجعة' : 'التنفيذ مغلق';
    const truthTitle = sessionAligned
      ? `جلسة الإشارة: ${shortSession(recommendationSession)} · للجلسة التالية ${shortSession(targetSession)}`
      : `جلسة التوصيات ${shortSession(recommendationSession)} ≠ السوق ${shortSession(latestMarketSession)}`;
    const truthDetail = executionEligible
      ? 'الدخول مشروط بالنطاق والسيولة عند الافتتاح.'
      : sessionAligned ? 'التوصيات محفوظة، لكن التنفيذ متوقف حتى فتح بوابات المصدر.' : 'انتظر إعادة بناء التوصيات على آخر جلسة.';

    const exposurePct = num(plan.plannedAllocationPct) ?? num(plan.totalAllocationPct);
    const cashPct = num(plan.cashReservePct);

    panel.innerHTML = `
      <div class="v169-head">
        <div><h2>${esc(title)}</h2><p>مرتبة من أعلى أولوية نموذجية إلى الأقل.</p></div>
        <span class="v169-badge">${esc(badge)}</span>
      </div>
      <div class="v169-session-truth"><b>${esc(truthTitle)}</b><span>${esc(truthDetail)}</span></div>
      <div class="v169-summary">
        <div><small>عدد التوصيات</small><b>${rows.length}</b></div>
        <div><small>التعرض المخطط</small><b>${fmt(exposurePct, 2)}%</b></div>
        <div><small>النقد</small><b>${fmt(cashPct, 2)}%</b></div>
        <div><small>حالة النظام</small><b>${esc(decision.systemState || decision.state || '—')}</b></div>
      </div>
      <div class="v169-grid">${rows.map(row => card(row, sessionAligned, executionEligible)).join('')}</div>
      <div class="v169-footnote">* أولوية النموذج هي درجة ترتيب داخلية للفرص وليست احتمال ربح.</div>`;

    const legacyGrid = document.getElementById('recommendationGrid');
    const legacyPanel = legacyGrid?.closest('.panel');
    if (legacyPanel && legacyPanel !== panel) legacyPanel.style.display = 'none';
    return true;
  }

  async function start() {
    try {
      const [decision, priceTruth] = await Promise.all([loadJson(DECISION_URL), loadJson(PRICE_TRUTH_URL)]);
      let attempts = 0;
      const apply = () => {
        if (!render(decision, priceTruth) && attempts++ < 50) setTimeout(apply, 200);
      };
      apply();
    } catch (error) {
      console.error('V16.9 basket overlay failed', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
