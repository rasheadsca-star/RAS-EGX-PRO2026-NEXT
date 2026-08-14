'use strict';
(() => {
  const DECISION_URL = '../../data/stable/v16-v169-primary-decision.json';
  const PRICE_TRUTH_URL = '../../data/stable/v15-price-truth.json';
  const STYLE_ID = 'v169BasketOverlayStyle';
  const PANEL_ID = 'v169BasketPanel';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const num = value => Number.isFinite(Number(value)) ? Number(value) : null;

  const fmt = (value, digits = 2) =>
    num(value) === null
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
    do {
      date.setUTCDate(date.getUTCDate() + 1);
    } while (date.getUTCDay() === 5 || date.getUTCDay() === 6);
    return date.toISOString().slice(0, 10);
  }

  function friendlySession(sessionDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return sessionDate || '—';
    const date = new Date(`${sessionDate}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return sessionDate;
    return new Intl.DateTimeFormat('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{margin-bottom:18px;border-color:#2a7d68;background:linear-gradient(145deg,#0b3028,#0b2232)}
      #${PANEL_ID}.session-stale{border-color:#9b4a53;background:linear-gradient(145deg,#34191f,#0b2232)}
      #${PANEL_ID} .v169-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}
      #${PANEL_ID} .v169-head h2{margin:0 0 7px}
      #${PANEL_ID} .v169-head p{margin:0;color:#a9c6d4;line-height:1.7}
      #${PANEL_ID} .v169-badge{padding:7px 10px;border-radius:999px;background:#124f40;color:#d9fff1;font-weight:800;white-space:nowrap}
      #${PANEL_ID}.session-stale .v169-badge{background:#5b252c;color:#ffe4e7}
      #${PANEL_ID} .v169-session-truth{margin:0 0 14px;padding:11px 13px;border:1px solid #2c6e66;border-radius:12px;background:#0b2927;color:#d8f8ef;line-height:1.75}
      #${PANEL_ID}.session-stale .v169-session-truth{border-color:#92505a;background:#371a20;color:#ffe1e5}
      #${PANEL_ID} .v169-session-truth b{display:block;margin-bottom:2px}
      #${PANEL_ID} .v169-summary{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:10px;margin:12px 0 15px}
      #${PANEL_ID} .v169-summary div{padding:12px;border:1px solid #24566a;border-radius:12px;background:#091d2a}
      #${PANEL_ID} .v169-summary small{display:block;color:#9db9c8;margin-bottom:6px}
      #${PANEL_ID} .v169-summary b{font-size:17px}
      #${PANEL_ID} .v169-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      #${PANEL_ID} .v169-card{padding:15px;border:1px solid #24566a;border-radius:15px;background:#0a2130}
      #${PANEL_ID} .v169-card.hot{border-color:#8c692d}
      #${PANEL_ID}.session-stale .v169-card{opacity:.86;border-color:#75404a}
      #${PANEL_ID} .v169-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      #${PANEL_ID} .v169-card h3{margin:0;font-size:20px;direction:ltr;text-align:right}
      #${PANEL_ID} .v169-name{margin-top:5px;color:#bed4df}
      #${PANEL_ID} .v169-weight{padding:6px 9px;border-radius:999px;background:#153d50;font-weight:800;white-space:nowrap}
      #${PANEL_ID}.session-stale .v169-weight{background:#4a252c;color:#ffe0e3}
      #${PANEL_ID} .v169-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
      #${PANEL_ID} .v169-metric{padding:9px;border-radius:10px;background:#071823;border:1px solid #17384a}
      #${PANEL_ID} .v169-metric span{display:block;color:#8eacbc;font-size:11px;margin-bottom:5px}
      #${PANEL_ID} .v169-rule{margin-top:11px;padding:10px;border-radius:10px;background:#172b35;color:#d4e5ed;line-height:1.65;font-size:12px}
      #${PANEL_ID}.session-stale .v169-rule{background:#351e24;color:#ffe2e5}
      #${PANEL_ID} .v169-hot{display:inline-flex;margin-top:8px;padding:4px 7px;border-radius:999px;background:#50391a;color:#ffe2a5;font-size:11px;font-weight:700}
      #${PANEL_ID} .v169-error{padding:18px;border:1px dashed #8b4c56;border-radius:12px;color:#ffd8de;background:#341820}
      @media(max-width:1050px){#${PANEL_ID} .v169-summary{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:900px){
        #${PANEL_ID} .v169-grid{grid-template-columns:1fr}
        #${PANEL_ID} .v169-summary{grid-template-columns:repeat(2,1fr)}
      }
      @media(max-width:560px){#${PANEL_ID} .v169-head{flex-direction:column}#${PANEL_ID} .v169-badge{white-space:normal}}
    `;

    document.head.appendChild(style);
  }

  function card(row, sessionAligned) {
    const hot = num(row.rsi14) > 80;
    const weightLabel = sessionAligned
      ? `${fmt(row.portfolioWeightPct, 1)}% من المحفظة`
      : 'مرجع فقط — الوزن غير مفعّل';
    const rule = sessionAligned
      ? (row.morningConfirmation?.ruleAr || 'التنفيذ معلق على افتتاح داخل النطاق وسيولة مؤكدة خلال أول 10–15 دقيقة.')
      : 'هذه الخطة معروضة كمرجع فقط لأن جلسة التوصية لا تطابق آخر جلسة سوق موثقة. لا تنفيذ حتى إعادة بناء السلة بنفس المحرك على الجلسة الصحيحة.';

    return `
      <article class="v169-card${hot ? ' hot' : ''}">
        <div class="v169-card-head">
          <div>
            <h3>${esc(row.ticker)}</h3>
            <div class="v169-name">${esc(row.companyNameAr)}</div>
          </div>
          <div class="v169-weight">${esc(weightLabel)}</div>
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

        <div class="v169-rule">${esc(rule)}</div>
      </article>`;
  }

  function render(decision, priceTruth) {
    ensureStyle();

    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard) return false;

    const rows = Array.isArray(decision?.recommendations) ? decision.recommendations : [];
    const recommendationSession = decision?.sessionDate || null;
    const latestMarketSession = priceTruth?.expectedSession || null;
    const sessionAligned = Boolean(
      recommendationSession &&
      latestMarketSession &&
      recommendationSession === latestMarketSession
    );
    const executionGrade = priceTruth?.executionGrade === true;
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
    panel.dataset.recommendationSession = recommendationSession || '';
    panel.dataset.marketSession = latestMarketSession || '';
    panel.dataset.sessionAligned = String(sessionAligned);

    const plan = decision?.basketPlan || {};

    if (!rows.length) {
      panel.innerHTML = `<div class="v169-error">ملف V16.9 لم يُرجع أعضاء سلة حاليًا. هذه الرسالة لا تخفي باقي نوافذ التطبيق.</div>`;
      return true;
    }

    const title = sessionAligned ? 'سلة V16.9 للجلسة التالية' : 'سلة V16.9 مرجعية — غير متزامنة';
    const badge = sessionAligned
      ? (executionGrade ? 'متزامنة — تأكيد الافتتاح مطلوب' : 'متزامنة بحثيًا — Execution Grade غير مكتمل')
      : 'محجوبة للتنفيذ — اختلاف جلسة';
    const truthTitle = sessionAligned
      ? `السلة مبنية على آخر جلسة سوق مكتملة: ${friendlySession(recommendationSession)}`
      : `تنبيه: جلسة السلة ${recommendationSession || '—'} لا تطابق جلسة السوق ${latestMarketSession || '—'}`;
    const truthDetail = sessionAligned
      ? `وقت تشغيل النظام لا يغيّر جلسة السوق. الخطة مخصصة لأول جلسة تداول تالية: ${friendlySession(targetSession)}.`
      : 'لن تُعامل الأسهم كخطة حالية حتى يعيد نفس محرك V16.9 بناء السلة على آخر جلسة موثقة.';

    panel.innerHTML = `
      <div class="v169-head">
        <div>
          <h2>${esc(title)}</h2>
          <p>نفس محرك V16.9 ونفس أسلوب الاختيار والأوزان؛ التغيير هنا يخص حقيقة الجلسة والعرض فقط.</p>
        </div>
        <span class="v169-badge">${esc(badge)}</span>
      </div>

      <div class="v169-session-truth">
        <b>${esc(truthTitle)}</b>
        <span>${esc(truthDetail)}</span>
      </div>

      <div class="v169-summary">
        <div><small>جلسة الإشارة</small><b>${esc(recommendationSession || '—')}</b></div>
        <div><small>الجلسة التالية</small><b>${esc(targetSession || '—')}</b></div>
        <div><small>عدد الأسهم</small><b>${rows.length}</b></div>
        <div><small>إجمالي التعرض</small><b>${sessionAligned ? `${fmt(plan.totalAllocationPct, 1)}%` : '0% تنفيذ'}</b></div>
        <div><small>السيولة المحتفظ بها</small><b>${sessionAligned ? `${fmt(plan.cashReservePct, 1)}%` : '100% تنفيذ'}</b></div>
      </div>

      <div class="v169-grid">${rows.map(row => card(row, sessionAligned)).join('')}</div>`;

    const legacyGrid = document.getElementById('recommendationGrid');
    const legacyPanel = legacyGrid?.closest('.panel');
    if (legacyPanel && legacyPanel !== panel) legacyPanel.style.display = 'none';

    return true;
  }

  async function start() {
    try {
      const [decision, priceTruth] = await Promise.all([
        loadJson(DECISION_URL),
        loadJson(PRICE_TRUTH_URL)
      ]);
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
