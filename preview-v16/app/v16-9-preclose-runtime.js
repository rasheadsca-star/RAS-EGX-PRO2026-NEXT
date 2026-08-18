'use strict';
(() => {
  if (window.__V169_PRE_CLOSE_RUNTIME__) return;
  window.__V169_PRE_CLOSE_RUNTIME__ = true;

  const TZ = 'Africa/Cairo';
  const DECISION_URL = '../../data/stable/v16-main-app-current.json';
  const SCAN_STATUS_URL = '../../data/stable/v16-immediate-scan-status.json';
  const MARKET_CLOSE_MINUTE = 14 * 60 + 30;
  const PRE_CLOSE_START_MINUTE = MARKET_CLOSE_MINUTE - 15;
  const CHECKPOINTS = [15, 10, 5];
  const POLL_MS = 30000;
  const PANEL_ID = 'v169PreCloseRuntime';
  const STYLE_ID = 'v169PreCloseRuntimeStyle';
  const RELOAD_KEY = 'v169-preclose-last-reload-generated-at';

  let baselineGeneratedAt = null;
  let lastDecision = null;
  let lastScanStatus = null;
  let timer = null;
  let polling = false;
  const completedChecks = new Set();

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
      second: Number(map.second),
      time: `${map.hour}:${map.minute}:${map.second}`
    };
  }

  function isTradingDay(parts) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(parts.weekday);
  }

  function minuteOfDay(parts) {
    return parts.hour * 60 + parts.minute;
  }

  function minutesToClose(parts) {
    return MARKET_CLOSE_MINUTE - minuteOfDay(parts);
  }

  function inPreCloseWindow(parts) {
    const minute = minuteOfDay(parts);
    return isTradingDay(parts) && minute >= PRE_CLOSE_START_MINUTE && minute < MARKET_CLOSE_MINUTE;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{margin:10px 0 12px;padding:12px 14px;border:1px solid #31596d;border-radius:13px;background:#081e2b;color:#eaf8ff;text-align:right;direction:rtl;display:grid;gap:9px}
      #${PANEL_ID}.active{border-color:#2b8a68;background:linear-gradient(135deg,#0a2d24,#081e2b)}
      #${PANEL_ID}.warning{border-color:#9a7130;background:linear-gradient(135deg,#302611,#081e2b)}
      #${PANEL_ID}.error{border-color:#93464e;background:linear-gradient(135deg,#32191d,#081e2b)}
      #${PANEL_ID} .pc-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
      #${PANEL_ID} .pc-head strong{font-size:14px}#${PANEL_ID} .pc-clock{font-size:12px;font-weight:900;direction:ltr;padding:5px 9px;border-radius:999px;background:#15394a}
      #${PANEL_ID} .pc-status{font-size:13px;line-height:1.75;color:#d7edf7}
      #${PANEL_ID} .pc-checks{display:flex;gap:7px;flex-wrap:wrap}
      #${PANEL_ID} .pc-check{font-size:11px;padding:5px 8px;border-radius:999px;background:#122d3b;color:#9fb9c6;border:1px solid #24495b}
      #${PANEL_ID} .pc-check.done{background:#12392e;color:#c9ffe8;border-color:#2b765b}
      #${PANEL_ID} .pc-meta{font-size:10px;color:#8faab8;line-height:1.55}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyle();
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    const basket = document.getElementById('v169BasketPanel');
    if (basket) basket.insertAdjacentElement('beforebegin', panel);
    else {
      const dashboard = document.getElementById('view-dashboard') || document.querySelector('main') || document.body;
      dashboard.insertAdjacentElement('afterbegin', panel);
    }
    return panel;
  }

  function isoMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : 0;
  }

  function snapshotTime(decision) {
    return decision?.snapshotGeneratedAt || decision?.generatedAt || decision?.dataTruth?.decisionBuiltAt || null;
  }

  function scanTime(scan) {
    return scan?.generatedAt || null;
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
  }

  async function loadJson(url) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}pc=${Date.now()}`, {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function readState() {
    const [decisionResult, scanResult] = await Promise.allSettled([
      loadJson(DECISION_URL),
      loadJson(SCAN_STATUS_URL)
    ]);
    if (decisionResult.status !== 'fulfilled') throw decisionResult.reason;
    lastDecision = decisionResult.value;
    if (scanResult.status === 'fulfilled') lastScanStatus = scanResult.value;
    return { decision: lastDecision, scan: lastScanStatus };
  }

  function updateCompletedCheckpoints(parts) {
    if (!inPreCloseWindow(parts)) return;
    const remaining = minutesToClose(parts);
    CHECKPOINTS.forEach(checkpoint => {
      if (remaining <= checkpoint) completedChecks.add(checkpoint);
    });
  }

  function statusMessage(parts, error = null) {
    if (error) return `تعذر التحقق من تحديث قرار ما قبل الإغلاق: ${error.message || error}`;
    if (!isTradingDay(parts)) return 'لا توجد جلسة تداول مجدولة اليوم وفق سياسة التطبيق.';

    const minute = minuteOfDay(parts);
    if (minute < PRE_CLOSE_START_MINUTE) {
      return 'مراقب ما قبل الإغلاق جاهز. يبدأ الفحص التنفيذي لنفس المحرك عند 14:15 بتوقيت القاهرة.';
    }
    if (minute >= MARKET_CLOSE_MINUTE) {
      return 'انتهت نافذة ما قبل الإغلاق. آخر Snapshot منشور ظاهر أدناه مع توقيت بنائه.';
    }

    const decisionAt = snapshotTime(lastDecision);
    const scanAt = scanTime(lastScanStatus);
    const decisionSession = lastDecision?.sessionDate || lastDecision?.dataTruth?.decisionSession || null;
    const scanSession = lastScanStatus?.decisionSession || lastScanStatus?.expectedSession || null;
    const sameDayDecision = decisionSession === parts.date;
    const sameDayScan = scanSession === parts.date || (scanAt && formatTimestamp(scanAt).includes(parts.date.split('-')[0]));
    const freshAfterBaseline = isoMs(decisionAt) > isoMs(baselineGeneratedAt);

    if (freshAfterBaseline && sameDayDecision) {
      const count = Array.isArray(lastDecision?.recommendations) ? lastDecision.recommendations.length : 0;
      return count
        ? `تم نشر تحديث ما قبل الإغلاق من نفس محرك MAIN APP — عدد التوصيات الحالية: ${count}.`
        : 'تم فحص ما قبل الإغلاق ونشر Snapshot جديد — لا توجد توصيات حالية من المحرك.';
    }
    if (sameDayScan && isoMs(scanAt) > isoMs(baselineGeneratedAt)) {
      return 'تم تنفيذ مسح السوق قبل الإغلاق، ويجري انتظار نشر الـCanonical Snapshot بعد تطبيق نفس بوابات MAIN APP.';
    }
    return 'نافذة ما قبل الإغلاق نشطة — جاري التحقق من نتيجة المسح ونشر القرار، بدون أي تغيير في أسلوب اختيار التوصيات.';
  }

  function render(parts, error = null) {
    const panel = ensurePanel();
    const remaining = minutesToClose(parts);
    panel.className = error ? 'error' : inPreCloseWindow(parts) ? 'active' : '';
    const checks = CHECKPOINTS.map(checkpoint => `<span class="pc-check${completedChecks.has(checkpoint) ? ' done' : ''}">T-${checkpoint}${completedChecks.has(checkpoint) ? ' ✓' : ''}</span>`).join('');
    panel.innerHTML = `
      <div class="pc-head"><strong>مراقب ما قبل الإغلاق · MAIN APP</strong><span class="pc-clock">Cairo ${esc(parts.time)}</span></div>
      <div class="pc-status">${esc(statusMessage(parts, error))}</div>
      <div class="pc-checks">${checks}</div>
      <div class="pc-meta">الإغلاق المعتمد في سياسة التطبيق: 14:30 · آخر Snapshot: ${esc(formatTimestamp(snapshotTime(lastDecision)))} · آخر مسح منشور: ${esc(formatTimestamp(scanTime(lastScanStatus)))}${inPreCloseWindow(parts) ? ` · المتبقي تقريبًا ${Math.max(0, remaining)} دقيقة` : ''}</div>`;
  }

  function maybeReloadForNewDecision() {
    const generatedAt = snapshotTime(lastDecision);
    if (!generatedAt || isoMs(generatedAt) <= isoMs(baselineGeneratedAt)) return false;
    const alreadyReloaded = sessionStorage.getItem(RELOAD_KEY);
    if (alreadyReloaded === generatedAt) return false;
    sessionStorage.setItem(RELOAD_KEY, generatedAt);
    window.setTimeout(() => location.reload(), 450);
    return true;
  }

  async function poll(reason = 'timer') {
    if (polling) return;
    polling = true;
    const parts = cairoParts();
    updateCompletedCheckpoints(parts);
    try {
      await readState();
      render(parts);
      if (inPreCloseWindow(parts)) maybeReloadForNewDecision();
    } catch (error) {
      console.warn(`V16.9 pre-close poll failed (${reason})`, error);
      render(parts, error);
    } finally {
      polling = false;
    }
  }

  async function start() {
    try {
      const initial = await loadJson(DECISION_URL);
      lastDecision = initial;
      baselineGeneratedAt = snapshotTime(initial);
    } catch (error) {
      console.warn('V16.9 pre-close baseline unavailable', error);
    }
    await poll('start');
    timer = window.setInterval(() => poll('interval'), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll('visibility');
    });
    window.addEventListener('focus', () => poll('focus'));
    window.addEventListener('pageshow', () => poll('pageshow'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
