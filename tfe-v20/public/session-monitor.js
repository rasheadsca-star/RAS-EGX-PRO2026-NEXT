import { evaluateFrozenCandidate, marketPhase, MONITOR_POLICY } from './session-monitor-core.js';

const ARCHIVE_KEY = 'egx-tfe-rc2-v169-forward-archive';
const PANEL_ID = 'rc2SessionMonitorPanel';
const HISTORY_LIMIT = 40;
const historyCache = new Map();
let lastResults = [];
let lastGeneratedAt = null;
let refreshing = false;

const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = (value, digits = 3) => n(value) === null ? '—' : Number(value).toLocaleString('en-GB', { maximumFractionDigits:digits });
const pct = value => n(value) === null ? '—' : `${Number(value).toLocaleString('en-GB',{maximumFractionDigits:2})}%`;

function readFrozenSignals() {
  try {
    const rows = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    if (!Array.isArray(rows) || !rows.length) return [];
    const session = rows.map(x => x.sessionDate).filter(Boolean).sort().at(-1);
    return rows
      .filter(x => x.sessionDate === session && x.ticker && n(x.entryLow) > 0 && n(x.entryHigh) >= n(x.entryLow) && n(x.stop) > 0 && n(x.target1) > 0)
      .sort((a,b) => (n(b.fusionRank) ?? -1) - (n(a.fusionRank) ?? -1) || String(a.ticker).localeCompare(String(b.ticker)));
  } catch { return []; }
}

function publishSnapshot(signals, results = lastResults, quoteData = null, error = null) {
  const detail = {
    monitor:'SESSION_MONITOR_V1',
    generatedAt: quoteData?.generatedAt || lastGeneratedAt || new Date().toISOString(),
    signals: Array.isArray(signals) ? signals : [],
    results: Array.isArray(results) ? results : [],
    quotes: Array.isArray(quoteData?.quotes) ? quoteData.quotes : [],
    errors: Array.isArray(quoteData?.errors) ? quoteData.errors : [],
    error: error || null,
    phase: marketPhase(),
    pollingMs: MONITOR_POLICY.pollingMs,
    delayedMinutes: quoteData?.delayedMinutes ?? 15,
    monitorOnly:true,
    scoringImpact:'NONE',
    recommendationMutationAllowed:false,
    executionAllowed:false,
  };
  window.__RC2_SESSION_MONITOR_LAST__ = detail;
  window.dispatchEvent(new CustomEvent('rc2:session-monitor', { detail }));
}

function stateMeta(state) {
  const map = {
    WAITING_FOR_ENTRY:['في انتظار الدخول','warn'],
    ENTRY_ZONE_TOUCHED:['دخل/لامس منطقة الدخول','good'],
    WAIT_PULLBACK_ABOVE_ENTRY:['فوق منطقة الدخول — انتظار Pullback','warn'],
    WAIT_RECOVERY_BELOW_ENTRY:['أسفل منطقة الدخول — انتظار تعافٍ','warn'],
    ENTRY_EXPIRED:['انتهت مهلة الدخول','neutral'],
    POSITION_OPEN:['دخول مُفعّل — المركز تحت المتابعة','good'],
    TARGET1_REACHED:['تحقق T1','good'],
    TARGET2_REACHED:['تحقق T2','good'],
    STOP:['تحقق الوقف','bad'],
    STOP_SAME_BAR:['وقف محافظ — Stop First','bad'],
    TIME_EXIT:['خروج زمني','neutral'],
    INVALID_SIGNAL:['خطة غير صالحة للمتابعة','bad'],
  };
  return map[state] || [state || 'غير محدد','neutral'];
}

function ensureStyle() {
  if (document.getElementById('rc2SessionMonitorStyle')) return;
  const style = document.createElement('style');
  style.id = 'rc2SessionMonitorStyle';
  style.textContent = `
    #${PANEL_ID}{border-color:#2b6f68;background:linear-gradient(145deg,#0a2730,#0b1d2a);margin-top:18px}
    #${PANEL_ID} .sm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
    #${PANEL_ID} .sm-head h2{margin:0 0 6px}#${PANEL_ID} .sm-head p{margin:0;color:#a9c6d4;line-height:1.7}
    #${PANEL_ID} .sm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    #${PANEL_ID} .sm-source{margin:13px 0;padding:11px 13px;border:1px solid #24566a;border-radius:12px;background:#081b26;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}
    #${PANEL_ID} .sm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    #${PANEL_ID} .sm-card{padding:14px;border:1px solid #24566a;border-radius:14px;background:#091f2c}
    #${PANEL_ID} .sm-card.good{border-color:#2d7358}#${PANEL_ID} .sm-card.warn{border-color:#8b692d}#${PANEL_ID} .sm-card.bad{border-color:#8b4b55}
    #${PANEL_ID} .sm-card-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}#${PANEL_ID} .sm-card h3{font-size:21px;margin:0;direction:ltr;text-align:right}
    #${PANEL_ID} .sm-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:11px}
    #${PANEL_ID} .sm-metric{padding:8px;border:1px solid #17384a;border-radius:9px;background:#071823}#${PANEL_ID} .sm-metric small{display:block;color:#8eacbc;margin-bottom:4px;font-size:10px}#${PANEL_ID} .sm-metric b{font-size:13px}
    #${PANEL_ID} .sm-note{margin-top:10px;padding:9px 10px;border-radius:9px;background:#122b35;color:#cfe1e9;font-size:11px;line-height:1.65}
    #${PANEL_ID} .sm-empty{padding:18px;text-align:center;color:#9eb9c7;border:1px dashed #315469;border-radius:12px}
    @media(max-width:980px){#${PANEL_ID} .sm-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function ensurePanel() {
  ensureStyle();
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('article');
  panel.id = PANEL_ID;
  panel.className = 'panel';
  const grid = document.getElementById('recommendationGrid');
  const recPanel = grid?.closest('.panel');
  const selected = document.getElementById('selectedPanel');
  if (recPanel) recPanel.insertAdjacentElement('afterend', panel);
  else if (selected) selected.insertAdjacentElement('beforebegin', panel);
  else document.getElementById('view-dashboard')?.appendChild(panel);
  return panel;
}

async function loadHistory(ticker, sessionDate) {
  const phase = marketPhase();
  const key = `${ticker}|${sessionDate}|${phase.date}`;
  if (historyCache.has(key)) return historyCache.get(key);
  const q = new URLSearchParams({route:'history',ticker,limit:String(HISTORY_LIMIT),t:String(Date.now())});
  const response = await fetch(`/api/index?${q}`, { cache:'no-store' });
  if (!response.ok) throw new Error(`HISTORY_HTTP_${response.status}`);
  const data = await response.json();
  const bars = Array.isArray(data?.bars) ? data.bars : [];
  historyCache.set(key, bars);
  return bars;
}

async function loadQuotes(tickers, force = false) {
  const q = new URLSearchParams({ tickers:tickers.join(','), t:String(Date.now()) });
  if (force) q.set('force','1');
  const response = await fetch(`/api/session-monitor?${q}`, { cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `MONITOR_HTTP_${response.status}`);
  return data;
}

function freshnessSummary(results) {
  if (!results.length) return ['لا توجد بيانات متابعة','neutral'];
  const states = results.map(x => x.freshness?.state);
  if (states.some(x => ['STALE_SESSION','STALE_INTRADAY','UNAVAILABLE'].includes(x))) return ['يوجد مصدر متأخر/غير متاح','bad'];
  if (states.some(x => ['LAGGING','CURRENT_SESSION_UNKNOWN_AGE'].includes(x))) return ['المتابعة تعمل مع تحذير حداثة','warn'];
  if (states.some(x => x === 'DELAYED_LIVE')) return ['المتابعة الدورية نشطة','good'];
  return ['متابعة مرجعية خارج الجلسة','neutral'];
}

function render(signals, results = lastResults, error = null) {
  const panel = ensurePanel();
  const phase = marketPhase();
  const [summary, summaryCls] = freshnessSummary(results);
  const phaseLabel = phase.phase === 'OPEN' ? 'الجلسة متوقعة مفتوحة' : phase.phase === 'PRE_OPEN' ? 'قبل الافتتاح' : phase.phase === 'POST_CLOSE' ? 'بعد الإغلاق' : 'خارج أيام التداول المعتادة';
  panel.innerHTML = `
    <div class="sm-head">
      <div><h2>متابعة الجلسة للمرشحين</h2><p>تحديث تلقائي كل 5 دقائق أثناء نافذة جلسة EGX. السعر من مصدر متأخر 15 دقيقة ويحدّث <b>موقف الخطة المجمدة فقط</b> — لا يغيّر RC2 أو Fusion Rank.</p></div>
      <div class="sm-actions"><span class="badge ${summaryCls}">${esc(summary)}</span><button class="btn" id="sessionMonitorRefresh" type="button">تحديث المتابعة الآن</button></div>
    </div>
    <div class="sm-source"><span>${esc(phaseLabel)} · القاهرة ${esc(phase.time)}</span><span>آخر جلب: ${lastGeneratedAt ? esc(new Date(lastGeneratedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · Poll 5m · Source delay 15m</span></div>
    ${error ? `<div class="sm-empty red">تعذر تحديث مصدر المتابعة: ${esc(error)}</div>` : !signals.length ? '<div class="sm-empty">في انتظار تحميل توصيات RC2 المجمدة من الواجهة…</div>' : `
      <div class="sm-grid">${results.map(result => {
        const [label, cls] = stateMeta(result.state);
        const fresh = result.freshness || {};
        const entered = result.entered ? `دخول ${fmt(result.entryPrice,4)} · ${esc(result.entryDate)}` : `منطقة ${fmt(result.entryLow,4)}–${fmt(result.entryHigh,4)}`;
        return `<article class="sm-card ${cls}">
          <div class="sm-card-head"><div><h3>${esc(result.ticker)}</h3><small>إشارة ${esc(result.signalDate)}</small></div><span class="badge ${cls}">${esc(label)}</span></div>
          <div class="sm-metrics">
            <div class="sm-metric"><small>السعر المتابع</small><b>${fmt(result.currentPrice,4)}</b></div>
            <div class="sm-metric"><small>الموقف</small><b>${esc(result.zone)}</b></div>
            <div class="sm-metric"><small>الدخول</small><b>${esc(entered)}</b></div>
            <div class="sm-metric"><small>T1 / T2</small><b>${fmt(result.target1,4)} / ${fmt(result.target2,4)}</b></div>
            <div class="sm-metric"><small>Stop</small><b>${fmt(result.stop,4)}</b></div>
            <div class="sm-metric"><small>من الدخول</small><b>${result.pnlFromEntryPct === null || result.pnlFromEntryPct === undefined ? '—' : pct(result.pnlFromEntryPct)}</b></div>
          </div>
          <div class="sm-note"><b>${esc(fresh.labelAr || 'حالة المصدر غير معروفة')}</b>${fresh.ageMinutes !== undefined ? ` · عمر السعر ${esc(fresh.ageMinutes)} دقيقة` : ''}<br>لا تنفيذ آلي · لا تعديل للتوصية · STOP_FIRST عند غموض نفس الجلسة.</div>
        </article>`;
      }).join('')}</div>`}
  `;
  panel.querySelector('#sessionMonitorRefresh')?.addEventListener('click', () => refresh(true));
}

async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  const signals = readFrozenSignals();
  if (!signals.length) {
    render(signals, [], null);
    publishSnapshot(signals, [], null, null);
    refreshing = false;
    return;
  }
  render(signals, lastResults, null);
  try {
    const [quoteData, histories] = await Promise.all([
      loadQuotes(signals.map(x => x.ticker), force),
      Promise.all(signals.map(x => loadHistory(x.ticker, x.sessionDate).catch(() => []))),
    ]);
    const quoteMap = new Map((quoteData.quotes || []).map(x => [x.ticker, x]));
    lastResults = signals.map((signal, index) => evaluateFrozenCandidate(signal, histories[index], quoteMap.get(signal.ticker) || null));
    lastGeneratedAt = quoteData.generatedAt || new Date().toISOString();
    render(signals, lastResults, null);
    publishSnapshot(signals, lastResults, quoteData, null);
  } catch (error) {
    const message = error?.message || 'UNKNOWN_ERROR';
    render(signals, lastResults, message);
    publishSnapshot(signals, lastResults, null, message);
  } finally {
    refreshing = false;
  }
}

function startWhenArchiveReady() {
  let attempts = 0;
  const tryStart = () => {
    const signals = readFrozenSignals();
    if (signals.length || attempts++ >= 60) {
      render(signals, [], null);
      refresh(true);
      return;
    }
    setTimeout(tryStart, 250);
  };
  tryStart();
}

setInterval(() => {
  const phase = marketPhase();
  if (phase.phase === 'OPEN' && !document.hidden) refresh(false);
  else render(readFrozenSignals(), lastResults, null);
}, MONITOR_POLICY.pollingMs);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && marketPhase().phase === 'OPEN') refresh(false);
});
window.addEventListener('storage', event => {
  if (event.key === ARCHIVE_KEY) refresh(true);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWhenArchiveReady, { once:true });
else startWhenArchiveReady();
