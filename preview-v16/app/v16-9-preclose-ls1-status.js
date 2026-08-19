'use strict';
(() => {
  if (window.__V169_PRE_CLOSE_LS1_STATUS__) return;
  window.__V169_PRE_CLOSE_LS1_STATUS__ = true;

  const TZ = 'Africa/Cairo';
  const LS1_URL = '../../data/stable/v16-ls1-late-session-opportunities.json';
  const PANEL_ID = 'v169PreCloseLs1Status';
  const STYLE_ID = 'v169PreCloseLs1StatusStyle';
  const POLL_MS = 30000;
  let polling = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function cairoParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return {
      weekday: map.weekday,
      date: `${map.year}-${map.month}-${map.day}`,
      hour: Number(map.hour),
      minute: Number(map.minute),
      time: `${map.hour}:${map.minute}:${map.second}`
    };
  }

  function isTradingDay(parts) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(parts.weekday);
  }

  function minuteOfDay(parts) {
    return parts.hour * 60 + parts.minute;
  }

  function relevantWindow(parts) {
    const minute = minuteOfDay(parts);
    return isTradingDay(parts) && minute >= (14 * 60 + 10) && minute <= (15 * 60);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{margin:0 0 12px;padding:12px 14px;border:1px solid #35546a;border-radius:13px;background:#0b1b27;color:#edf8ff;direction:rtl;text-align:right;display:grid;gap:9px}
      #${PANEL_ID}.ok{border-color:#2f8366;background:linear-gradient(135deg,#0b2b23,#0b1b27)}
      #${PANEL_ID}.blocked{border-color:#a87b35;background:linear-gradient(135deg,#302613,#0b1b27)}
      #${PANEL_ID}.stale{border-color:#6e7882}
      #${PANEL_ID} .ls1-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      #${PANEL_ID} .ls1-head strong{font-size:14px}
      #${PANEL_ID} .ls1-badge{font-size:11px;font-weight:900;padding:5px 8px;border-radius:999px;background:#173445;color:#d8f0fb}
      #${PANEL_ID} .ls1-main{font-size:13px;line-height:1.8;color:#e1f1f8}
      #${PANEL_ID} .ls1-reason{font-size:12px;line-height:1.7;color:#f2d9a2}
      #${PANEL_ID} .ls1-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px}
      #${PANEL_ID} .ls1-card{padding:8px 9px;border:1px solid #28495b;border-radius:10px;background:#102735;font-size:11px;line-height:1.65}
      #${PANEL_ID} .ls1-card strong{font-size:12px;color:#fff}
      #${PANEL_ID} .ls1-card .ticker{direction:ltr;display:inline-block;font-weight:900}
      #${PANEL_ID} .ls1-watch-title{font-size:11px;font-weight:900;color:#b8cfdb}
      #${PANEL_ID} .ls1-meta{font-size:10px;color:#90a9b6;line-height:1.55}
      @media(max-width:520px){#${PANEL_ID}{padding:10px 11px}#${PANEL_ID} .ls1-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyle();
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    const runtime = document.getElementById('v169PreCloseRuntime');
    if (runtime) runtime.insertAdjacentElement('afterend', panel);
    else {
      const basket = document.getElementById('v169BasketPanel');
      if (basket) basket.insertAdjacentElement('beforebegin', panel);
      else (document.getElementById('view-dashboard') || document.querySelector('main') || document.body).insertAdjacentElement('afterbegin', panel);
    }
    return panel;
  }

  async function loadLs1() {
    const response = await fetch(`${LS1_URL}?ls1ui=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function blockerAr(code, evidence = {}) {
    const map = {
      SOURCE_SESSION_EVIDENCE_BELOW_THRESHOLD: `دليل جلسة المصدر أقل من الحد المطلوب (${Number(evidence.sourceSessionVerifiedRows || 0)}/${Number(evidence.requiredVerifiedRows || 0)} سهم موثّق).`,
      GLOBAL_SESSION_EVIDENCE_NOT_READY: 'توثيق الجلسة الحالية غير مكتمل.',
      TICKER_SESSION_DATE_NOT_VERIFIED: 'تاريخ جلسة السهم غير موثّق من المصدر الحالي.',
      TIER_NOT_BUY_ELIGIBLE: 'السهم في طبقة مراقبة وليس طبقة شراء.',
      STATE_NOT_BUY_ELIGIBLE: 'السعر الحالي خارج حالة الدخول المسموح بها.',
      SESSION_WEAKNESS_TOO_HIGH: 'ضعف الجلسة أعلى من الحد المسموح.',
      PRICE_OUTSIDE_ACCEPTABLE_ENTRY_EXTENSION: 'السعر خارج امتداد الدخول المقبول.',
      DECISION_SCORE_BELOW_MIN: 'درجة القرار أقل من الحد الأدنى.'
    };
    return map[code] || code;
  }

  function signalRows(data) {
    const rows = Array.isArray(data?.signals) ? data.signals : [];
    return rows.filter(row => row?.eligible === true || row?.active === true || row?.executionEligible === true);
  }

  function planHtml(row) {
    const plan = row?.plan || row?.tradePlan || {};
    const entryLow = plan.entryLow ?? row.entryLow;
    const entryHigh = plan.entryHigh ?? row.entryHigh;
    const stop = plan.stopLoss ?? plan.stop ?? row.stopLoss ?? row.stop;
    const target = plan.target1 ?? row.target1;
    const range = entryLow != null && entryHigh != null ? `${esc(entryLow)} – ${esc(entryHigh)}` : '—';
    return `دخول: <span dir="ltr">${range}</span><br>وقف: <span dir="ltr">${esc(stop ?? '—')}</span> · هدف1: <span dir="ltr">${esc(target ?? '—')}</span>`;
  }

  function renderSignalCards(rows) {
    return rows.slice(0, 5).map(row => `
      <div class="ls1-card">
        <strong><span class="ticker">${esc(row.ticker || row.symbol || '—')}</span></strong><br>
        ${planHtml(row)}<br>
        LS1: <span dir="ltr">${esc(row.ls1Score ?? row.score ?? '—')}</span>
      </div>`).join('');
  }

  function renderWatchCards(rows) {
    return rows.slice(0, 3).map(row => `
      <div class="ls1-card">
        <strong><span class="ticker">${esc(row.ticker || row.symbol || '—')}</span></strong> · مراقبة فقط<br>
        الحالة: ${esc(row.stateLabelAr || row.state || '—')} · LS1: <span dir="ltr">${esc(row.ls1Score ?? '—')}</span><br>
        ${planHtml(row)}
      </div>`).join('');
  }

  function render(data, error = null) {
    const parts = cairoParts();
    const panel = ensurePanel();
    if (!relevantWindow(parts) && data?.cairoDate !== parts.date) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'grid';

    if (error) {
      panel.className = 'stale';
      panel.innerHTML = `
        <div class="ls1-head"><strong>نتيجة فحص 14:15 · LS1</strong><span class="ls1-badge">Cairo ${esc(parts.time)}</span></div>
        <div class="ls1-main">تعذر تحميل نتيجة فحص ما قبل الإغلاق الآن.</div>
        <div class="ls1-meta">${esc(error.message || error)}</div>`;
      return;
    }

    const sameDay = data?.cairoDate === parts.date;
    if (!sameDay) {
      panel.className = 'stale';
      panel.innerHTML = `
        <div class="ls1-head"><strong>نتيجة فحص 14:15 · LS1</strong><span class="ls1-badge">في انتظار فحص اليوم</span></div>
        <div class="ls1-main">لم تصل نتيجة فحص ما قبل الإغلاق لجلسة ${esc(parts.date)} حتى الآن.</div>
        <div class="ls1-meta">سيتم تحديث هذه البطاقة تلقائيًا كل 30 ثانية.</div>`;
      return;
    }

    const active = signalRows(data);
    const watch = Array.isArray(data?.watchTop) ? data.watchTop : [];
    const blockers = Array.isArray(data?.evidenceBlockers) ? data.evidenceBlockers : [];
    const evidence = data?.evidence || {};
    const publishedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString('ar-EG', { timeZone: TZ, hour12: false }) : '—';

    if (active.length > 0) {
      panel.className = 'ok';
      panel.innerHTML = `
        <div class="ls1-head"><strong>توصيات ما قبل الإغلاق · LS1</strong><span class="ls1-badge">${active.length} إشارة</span></div>
        <div class="ls1-main">تم فحص السوق قرب 14:15 وظهرت إشارات تكتيكية اجتازت بوابات LS1. هذه طبقة مستقلة ولا تغيّر ترتيب محرك V16.9 النهائي.</div>
        <div class="ls1-grid">${renderSignalCards(active)}</div>
        <div class="ls1-meta">آخر فحص: ${esc(data.cairoTime || publishedAt)} · المرحلة: ${esc(data.phase || '—')} · منهج V16.9 لم يتغير.</div>`;
      return;
    }

    const reasonText = blockers.length
      ? blockers.map(code => blockerAr(code, evidence)).join(' ')
      : 'لم تجتز أي فرصة جميع بوابات LS1 التنفيذية في هذا الفحص.';

    panel.className = 'blocked';
    panel.innerHTML = `
      <div class="ls1-head"><strong>فحص 14:15 اكتمل · لا توجد توصيات تنفيذية جديدة</strong><span class="ls1-badge">0 إشارة</span></div>
      <div class="ls1-main">المحرك فحص السوق بالفعل ولم يصدر توصية تنفيذية جديدة بدلًا من تمرير إشارة غير مكتملة.</div>
      <div class="ls1-reason"><strong>السبب:</strong> ${esc(reasonText)}</div>
      ${watch.length ? `<div class="ls1-watch-title">أقرب فرص للمراقبة — ليست توصيات تنفيذية</div><div class="ls1-grid">${renderWatchCards(watch)}</div>` : ''}
      <div class="ls1-meta">آخر فحص: ${esc(data.cairoTime || publishedAt)} · الحالة: ${esc(data.statusAr || data.status || '—')} · المصدر المتأخر: ${evidence.publicDelayedData === true ? 'نعم' : 'لا'} · منهج V16.9 لم يتغير.</div>`;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      render(await loadLs1());
    } catch (error) {
      console.warn('V16.9 LS1 pre-close status load failed', error);
      render(null, error);
    } finally {
      polling = false;
    }
  }

  async function start() {
    await poll();
    window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('focus', poll);
    window.addEventListener('pageshow', poll);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
