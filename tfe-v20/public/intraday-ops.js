import { marketPhase, quoteFreshness } from './session-monitor-core.js';
import { assessHolding } from './portfolio-manager.js';

const API = '/api/index';
const INTRADAY_API = '/api/intraday';
const STATE_KEY = 'egx-tfe-rc2-intraday-ops-v1';
const PORTFOLIO_KEY = 'egx-tfe-rc2-v169-eod-manager';
const ARCHIVE_KEY = 'egx-tfe-rc2-v169-forward-archive';
const RISK_KEY = 'egx-tfe-rc2-v169-risk-settings';
const PANEL_ID = 'rc2IntradayOpsPanel';
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 45_000;
const PRIORITY_INTERVAL_MS = 300_000;
const POST_CLOSE_RESCAN_MS = 600_000;

const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits = 2) => n(value) === null ? '—' : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits });
const pct = value => n(value) === null ? '—' : `${fmt(value, 2)}%`;
const money = value => n(value) === null ? '—' : `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })} ج.م`;

function safeLoad(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function safeSave(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const state = {
  officialScan: null,
  universe: [],
  cursor: 0,
  cycle: 0,
  market: new Map(),
  liveActions: new Map(),
  transitions: [],
  fullBusy: false,
  priorityBusy: false,
  officialBusy: false,
  lastFullBatchAt: null,
  lastPriorityAt: null,
  lastOfficialAt: null,
  postCloseResolvedDate: null,
  persisted: safeLoad(STATE_KEY, {}),
};

function ensureStyle() {
  if (document.getElementById('rc2IntradayOpsStyle')) return;
  const style = document.createElement('style');
  style.id = 'rc2IntradayOpsStyle';
  style.textContent = `
    #${PANEL_ID}{margin-top:18px;border-color:#315a80;background:linear-gradient(145deg,#081b2c,#0a2332)}
    #${PANEL_ID} .io-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
    #${PANEL_ID} .io-head h2{margin:0 0 6px}#${PANEL_ID} .io-head p{margin:0;color:#a8c2d2;line-height:1.7}
    #${PANEL_ID} .io-actions{display:flex;gap:8px;flex-wrap:wrap}
    #${PANEL_ID} .io-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}
    #${PANEL_ID} .io-kpi{padding:10px;border:1px solid #23445c;border-radius:10px;background:#071824}
    #${PANEL_ID} .io-kpi small{display:block;color:#8faabc;font-size:9px;margin-bottom:4px}#${PANEL_ID} .io-kpi b{font-size:16px}
    #${PANEL_ID} .io-note{padding:10px 12px;border-radius:10px;background:#102a38;color:#cfe2eb;line-height:1.7;font-size:11px;margin:8px 0}
    #${PANEL_ID} .io-note.warn{background:#342b18;color:#ffe3a0}#${PANEL_ID} .io-note.bad{background:#371b22;color:#ffd2d8}
    #${PANEL_ID} .io-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
    #${PANEL_ID} .io-box{border:1px solid #23445c;border-radius:12px;background:#071824;padding:12px;min-width:0}
    #${PANEL_ID} .io-box h3{margin:0 0 10px;font-size:15px}#${PANEL_ID} .io-list{display:grid;gap:7px}
    #${PANEL_ID} .io-row{display:grid;grid-template-columns:76px 1fr auto;gap:8px;align-items:center;border:1px solid #17374a;border-radius:9px;padding:8px;background:#06151f}
    #${PANEL_ID} .io-row b{direction:ltr;text-align:right}#${PANEL_ID} .io-row small{display:block;color:#91adbd;line-height:1.5}
    #${PANEL_ID} .io-pill{font-size:9px;padding:4px 7px;border-radius:999px;border:1px solid #426278;white-space:nowrap}
    #${PANEL_ID} .io-pill.good{color:#caffdf;border-color:#2d7b5b}#${PANEL_ID} .io-pill.warn{color:#ffe1a0;border-color:#80652e}#${PANEL_ID} .io-pill.bad{color:#ffd0d6;border-color:#8a4350}#${PANEL_ID} .io-pill.neutral{color:#c8d8e1}
    #${PANEL_ID} .io-progress{height:7px;background:#142d3d;border-radius:999px;overflow:hidden;margin:8px 0}#${PANEL_ID} .io-progress i{display:block;height:100%;background:#4c9ed9}
    @media(max-width:980px){#${PANEL_ID} .io-grid{grid-template-columns:1fr}#${PANEL_ID} .io-kpis{grid-template-columns:1fr 1fr}}
    @media(max-width:560px){#${PANEL_ID} .io-kpis{grid-template-columns:1fr}#${PANEL_ID} .io-row{grid-template-columns:64px 1fr}}
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
  const monitor = document.getElementById('rc2SessionMonitorPanel');
  if (monitor) monitor.insertAdjacentElement('afterend', panel);
  else {
    const grid = document.getElementById('recommendationGrid');
    const recPanel = grid?.closest('.panel');
    if (recPanel) recPanel.insertAdjacentElement('afterend', panel);
    else document.getElementById('view-dashboard')?.appendChild(panel);
  }
  return panel;
}

async function api(route, params = {}) {
  const q = new URLSearchParams({ route, ...Object.fromEntries(Object.entries(params).filter(([,v]) => v !== null && v !== undefined && v !== '')), t:String(Date.now()) });
  const response = await fetch(`${API}?${q}`, { cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP_${response.status}`);
  return data;
}

async function intradayBatch(tickers, force = false) {
  const q = new URLSearchParams({ tickers:tickers.join(','), t:String(Date.now()) });
  if (force) q.set('force', '1');
  const response = await fetch(`${INTRADAY_API}?${q}`, { cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `INTRADAY_HTTP_${response.status}`);
  return data;
}

function portfolioState() {
  const p = safeLoad(PORTFOLIO_KEY, {});
  return {
    cash: Math.max(0, n(p.cash) || 0),
    holdings: Array.isArray(p.holdings) ? p.holdings.filter((x) => x?.ticker && n(x.qty) > 0 && n(x.avgCost) > 0) : [],
    maxWeightPct: Math.max(1, Math.min(50, n(p.maxWeightPct) || 10)),
  };
}

function currentRecommendationTickers() {
  const archive = safeLoad(ARCHIVE_KEY, []);
  if (!Array.isArray(archive) || !archive.length) return [];
  const session = archive.map((x) => x?.sessionDate).filter(Boolean).sort().at(-1);
  return [...new Set(archive.filter((x) => x?.sessionDate === session).map((x) => String(x.ticker || '').toUpperCase()).filter(Boolean))];
}

function priorityTickers() {
  const holdings = portfolioState().holdings.map((x) => String(x.ticker).toUpperCase());
  return [...new Set([...holdings, ...currentRecommendationTickers()])];
}

function chunks(items, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function storeResults(results = []) {
  for (const result of results) {
    if (!result?.ticker) continue;
    state.market.set(String(result.ticker).toUpperCase(), result);
  }
  const compact = [...state.market.values()].map((x) => ({
    ticker:x.ticker,
    fetchedAt:x.quote?.fetchedAt ?? null,
    sourceSessionDate:x.quote?.sourceSessionDate ?? null,
    sourceMarketTime:x.quote?.sourceMarketTime ?? null,
    price:x.quote?.price ?? null,
    changePct:x.quote?.changePct ?? null,
    shadowState:x.shadow?.state ?? null,
    technicalGatePass:x.shadow?.technicalGatePass === true,
    research:x.shadow?.scores?.research ?? null,
    core:x.shadow?.scores?.core ?? null,
  }));
  state.persisted.market = compact.slice(-250);
  state.persisted.updatedAt = new Date().toISOString();
  safeSave(STATE_KEY, state.persisted);
}

function officialSet() {
  return new Set((state.officialScan?.recommendations ?? []).map((x) => String(x.ticker ?? '').toUpperCase()));
}

function shadowCandidates() {
  const official = officialSet();
  return [...state.market.values()]
    .filter((x) => x?.shadow?.technicalGatePass === true && !official.has(String(x.ticker).toUpperCase()))
    .filter((x) => ['DELAYED_LIVE','LAGGING','CLOSED_SESSION'].includes(quoteFreshness(x.quote).state))
    .sort((a,b) => (n(b.shadow?.scores?.research) ?? -1) - (n(a.shadow?.scores?.research) ?? -1) || (n(b.shadow?.scores?.core) ?? -1) - (n(a.shadow?.scores?.core) ?? -1))
    .slice(0, 8);
}

function publishedWarnings() {
  const official = officialSet();
  const partialBarNoise = new Set(['LIQUIDITY_GATE_FAIL','RESEARCH_SCORE_LOW']);
  return [...state.market.values()]
    .filter((x) => official.has(String(x.ticker).toUpperCase()))
    .filter((x) => {
      const freshness = quoteFreshness(x.quote).state;
      if (['STALE_SESSION','STALE_INTRADAY','UNAVAILABLE'].includes(freshness)) return true;
      const structuralReasons = (x?.shadow?.nonQualityReasons || []).filter((reason) => !partialBarNoise.has(reason));
      return structuralReasons.length > 0;
    })
    .slice(0, 8);
}

function transitionKey(action) {
  return `${action.action}|${action.price ?? ''}|${action.stop ?? ''}`;
}

function pushTransition(ticker, previous, next) {
  if (!previous || previous.action === next.action) return;
  const item = { at:new Date().toISOString(), ticker, from:previous.action, to:next.action, price:next.price ?? null };
  state.transitions.unshift(item);
  state.transitions = state.transitions.slice(0, 30);
  state.persisted.transitions = state.transitions;
  safeSave(STATE_KEY, state.persisted);
  window.dispatchEvent(new CustomEvent('rc2:intraday-alert', { detail:item }));
}

function computeLivePortfolio() {
  const p = portfolioState();
  if (!p.holdings.length) { state.liveActions.clear(); return { holdings:[], complete:true, equity:p.cash, marketValue:0 }; }
  const resolved = p.holdings.map((holding) => ({ holding, data:state.market.get(String(holding.ticker).toUpperCase()) ?? null }));
  const current = resolved.map(({holding,data}) => {
    const fresh = quoteFreshness(data?.quote);
    const baselineSession = data?.baseline?.sessionDate ?? null;
    const officialSession = state.officialScan?.universe?.sessionDate ?? null;
    const sessionOk = !officialSession || baselineSession === officialSession;
    const quoteOk = ['DELAYED_LIVE','LAGGING','CLOSED_SESSION'].includes(fresh.state);
    return { holding, data, fresh, sessionOk, quoteOk, price:quoteOk ? n(data?.quote?.price) : null };
  });
  const complete = current.every((x) => x.price > 0 && x.sessionOk);
  const marketValue = current.reduce((sum, x) => sum + (x.price > 0 ? (n(x.holding.qty) || 0) * x.price : 0), 0);
  const equity = p.cash + marketValue;
  const next = new Map();
  for (const item of current) {
    const ticker = String(item.holding.ticker).toUpperCase();
    let action;
    if (!(item.price > 0)) {
      action = { ticker, action:'DATA', label:'مراجعة بيانات — لا قرار', cls:'bad', reasons:[item.fresh?.labelAr || 'السعر الحي غير متاح.'], price:null, stop:n(item.holding.stop), riskKnown:false };
    } else if (!item.sessionOk) {
      action = { ticker, action:'DATA', label:'SESSION MISMATCH — لا قرار', cls:'bad', reasons:[`جلسة التحليل ${item.data?.baseline?.sessionDate || '—'} لا تطابق جلسة RC2 ${state.officialScan?.universe?.sessionDate || '—'}.`], price:item.price, stop:n(item.holding.stop), riskKnown:false };
    } else {
      const officialRecommendation = (state.officialScan?.recommendations ?? []).find((row) => String(row?.ticker ?? '').toUpperCase() === ticker) ?? null;
      const baseline = officialRecommendation
        ? { ...officialRecommendation, publicationEligible:true }
        : { ...(item.data?.baseline ?? {}), publicationEligible:false };
      action = assessHolding({ holding:item.holding, analysis:baseline, price:item.price, equity, maxWeightPct:p.maxWeightPct });
      action.reasons = [...(action.reasons ?? []), `سعر متابعة ${item.fresh?.labelAr || 'غير محدد'}؛ القرار تشغيلي ولا يغيّر توصية RC2 الأصلية.`];
    }
    const prev = state.liveActions.get(ticker);
    if (prev && transitionKey(prev) !== transitionKey(action)) pushTransition(ticker, prev, action);
    next.set(ticker, action);
  }
  state.liveActions = next;
  return { holdings:p.holdings, complete, equity, marketValue };
}

function actionMeta(action) {
  const a = action?.action;
  if (['EXIT','REVIEW','DATA'].includes(a)) return 'bad';
  if (['REDUCE','NOADD','CAUTION'].includes(a)) return 'warn';
  if (['ADD','T1','T2'].includes(a)) return 'good';
  return 'neutral';
}

function render() {
  const panel = ensurePanel();
  const phase = marketPhase();
  const total = state.universe.length;
  const processed = Math.min(total, state.cursor);
  const progress = total ? Math.round(processed / total * 100) : 0;
  const candidates = shadowCandidates();
  const warnings = publishedWarnings();
  const live = computeLivePortfolio();
  const phaseText = phase.phase === 'OPEN' ? 'المسح الحي يعمل' : phase.phase === 'PRE_OPEN' ? 'قبل الافتتاح' : phase.phase === 'POST_CLOSE' ? 'بعد الإغلاق — تثبيت المسح الرسمي' : 'السوق مغلق';
  const cycleMinutes = total ? Math.ceil(Math.ceil(total / BATCH_SIZE) * BATCH_INTERVAL_MS / 60000) : 0;
  const actions = [...state.liveActions.values()];
  panel.innerHTML = `
    <div class="io-head">
      <div><h2>Intraday Operations — مسح السوق وإدارة المحفظة</h2><p>مسح Shadow للسوق بالكامل على دفعات + متابعة أسرع للمحفظة والتوصيات الحالية. <b>لا يغيّر التوصيات الرسمية أو Alpha/Fusion.</b></p></div>
      <div class="io-actions"><span class="badge ${phase.phase==='OPEN'?'good':'neutral'}">${esc(phaseText)}</span><button class="btn" id="ioPriorityNow">تحديث المحفظة الآن</button><button class="btn" id="ioBatchNow">مسح الدفعة التالية</button></div>
    </div>
    <div class="io-kpis">
      <div class="io-kpi"><small>تغطية دورة السوق</small><b>${processed}/${total || '—'}</b><span>${progress}%</span></div>
      <div class="io-kpi"><small>زمن الدورة المستهدف</small><b>${cycleMinutes || '—'} دقيقة</b><span>10 أسهم / 45 ثانية</span></div>
      <div class="io-kpi"><small>Shadow Pass جديد</small><b>${candidates.length}</b><span>ليست توصيات رسمية</span></div>
      <div class="io-kpi"><small>تنبيهات توصيات منشورة</small><b>${warnings.length}</b><span>المصدر/البوابات المؤقتة</span></div>
      <div class="io-kpi"><small>المحفظة الحية</small><b>${actions.length}</b><span>${live.complete ? `Equity ${money(live.equity)}` : 'بيانات غير مكتملة'}</span></div>
    </div>
    <div class="io-progress"><i style="width:${progress}%"></i></div>
    <div class="io-note">المسح يستخدم Daily Bar غير مكتمل من مصدر متأخر ~15 دقيقة. أي <b>INTRADAY SHADOW CANDIDATE</b> هو Watch فقط، ولا يصبح توصية رسمية إلا بعد إغلاق الجلسة وظهور بيانات مكتملة ثم اجتياز RC2 الرسمي.</div>
    ${!live.complete && live.holdings.length ? '<div class="io-note bad"><b>Fail-Closed للمحفظة:</b> يوجد سعر أو Session غير مكتمل؛ لا تعتمد على إجمالي Equity/Risk حتى يكتمل.</div>' : ''}
    <div class="io-grid">
      <div class="io-box"><h3>قرارات المحفظة أثناء الجلسة</h3><div class="io-list">${actions.length ? actions.map((x) => `<div class="io-row"><b>${esc(x.ticker)}</b><div><strong>${esc(x.label)}</strong><small>${esc((x.reasons || []).slice(0,2).join(' · '))}<br>السعر ${fmt(x.price,4)} · P/L ${pct(x.pnlPct)}</small></div><span class="io-pill ${actionMeta(x)}">${esc(x.action)}</span></div>`).join('') : '<div class="io-note">لا توجد مراكز محفظة مدخلة.</div>'}</div></div>
      <div class="io-box"><h3>فرص Shadow ظهرت أثناء الجلسة</h3><div class="io-list">${candidates.length ? candidates.map((x) => `<div class="io-row"><b>${esc(x.ticker)}</b><div><strong>مرشح ظل مؤقت</strong><small>Research ${fmt(x.shadow?.scores?.research,1)} · Core ${fmt(x.shadow?.scores?.core,1)} · ${esc(x.shadow?.tradePlan?.alignmentState || '—')}<br>${esc(quoteFreshness(x.quote).labelAr)}</small></div><span class="io-pill warn">WATCH ONLY</span></div>`).join('') : '<div class="io-note">لم يظهر حتى الآن سهم جديد يجتاز البوابات الفنية المؤقتة في الجزء الممسوح.</div>'}</div></div>
      <div class="io-box"><h3>تنبيهات على التوصيات الرسمية الحالية</h3><div class="io-list">${warnings.length ? warnings.map((x) => `<div class="io-row"><b>${esc(x.ticker)}</b><div><strong>Intraday Warning فقط</strong><small>${esc((x.shadow?.nonQualityReasons || []).join(', ') || quoteFreshness(x.quote).labelAr)}</small></div><span class="io-pill warn">NO MUTATION</span></div>`).join('') : '<div class="io-note">لا توجد تحذيرات مؤقتة على التوصيات التي تم فحصها.</div>'}</div></div>
      <div class="io-box"><h3>آخر تغيرات قرارات المحفظة</h3><div class="io-list">${state.transitions.length ? state.transitions.slice(0,8).map((x) => `<div class="io-row"><b>${esc(x.ticker)}</b><div><strong>${esc(x.from)} → ${esc(x.to)}</strong><small>${esc(new Date(x.at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}))} · ${fmt(x.price,4)}</small></div><span class="io-pill ${['EXIT','REVIEW','DATA'].includes(x.to)?'bad':'warn'}">تغير</span></div>`).join('') : '<div class="io-note">لا توجد تغيرات مسجلة في هذه الجلسة.</div>'}</div></div>
    </div>
    <div class="io-note">آخر دفعة سوق: ${state.lastFullBatchAt ? esc(new Date(state.lastFullBatchAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · آخر محفظة: ${state.lastPriorityAt ? esc(new Date(state.lastPriorityAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · آخر Scan رسمي: ${state.lastOfficialAt ? esc(new Date(state.lastOfficialAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · دورة #${state.cycle}</div>
  `;
  panel.querySelector('#ioPriorityNow')?.addEventListener('click', () => refreshPriority(true));
  panel.querySelector('#ioBatchNow')?.addEventListener('click', () => scanNextBatch(true));
}

async function loadOfficialScan() {
  if (state.officialBusy) return;
  state.officialBusy = true;
  try {
    state.officialScan = await api('scan', { limit:50 });
    state.lastOfficialAt = new Date().toISOString();
    state.persisted.officialSession = state.officialScan?.universe?.sessionDate ?? null;
    state.persisted.officialSourceCommit = state.officialScan?.sourceCommit ?? null;
    safeSave(STATE_KEY, state.persisted);
  } catch (error) {
    console.warn('[RC2_INTRADAY_OFFICIAL_SCAN]', error?.message || error);
  } finally {
    state.officialBusy = false;
    render();
  }
}

async function loadUniverse() {
  try {
    const market = await api('market-index');
    state.universe = (market.symbols || [])
      .filter((x) => x.currentRc2UniverseCandidate === true)
      .map((x) => String(x.ticker || '').toUpperCase())
      .filter(Boolean);
    if (state.cursor >= state.universe.length) state.cursor = 0;
  } catch (error) {
    console.warn('[RC2_INTRADAY_UNIVERSE]', error?.message || error);
  }
}

async function refreshPriority(force = false) {
  if (state.priorityBusy) return;
  const tickers = priorityTickers();
  if (!tickers.length) { render(); return; }
  state.priorityBusy = true;
  try {
    const groups = chunks(tickers);
    for (const group of groups) {
      const data = await intradayBatch(group, force);
      storeResults(data.results);
    }
    state.lastPriorityAt = new Date().toISOString();
    computeLivePortfolio();
  } catch (error) {
    console.warn('[RC2_INTRADAY_PRIORITY]', error?.message || error);
  } finally {
    state.priorityBusy = false;
    render();
  }
}

async function scanNextBatch(force = false) {
  if (state.fullBusy || !state.universe.length) return;
  const phase = marketPhase();
  if (!force && phase.phase !== 'OPEN') return;
  state.fullBusy = true;
  try {
    if (state.cursor >= state.universe.length) state.cursor = 0;
    const group = state.universe.slice(state.cursor, state.cursor + BATCH_SIZE);
    if (!group.length) return;
    const data = await intradayBatch(group, force);
    storeResults(data.results);
    state.cursor += group.length;
    if (state.cursor >= state.universe.length) { state.cursor = state.universe.length; state.cycle += 1; }
    state.lastFullBatchAt = new Date().toISOString();
  } catch (error) {
    console.warn('[RC2_INTRADAY_FULL_BATCH]', error?.message || error);
  } finally {
    state.fullBusy = false;
    render();
  }
}

async function postCloseOfficialCheck() {
  const phase = marketPhase();
  if (phase.phase !== 'POST_CLOSE') return;
  if (state.postCloseResolvedDate === phase.date) return;
  await loadOfficialScan();
  if (state.officialScan?.universe?.sessionDate === phase.date) {
    state.postCloseResolvedDate = phase.date;
    state.persisted.postCloseResolvedDate = phase.date;
    state.persisted.postCloseOfficialRecommendations = (state.officialScan.recommendations || []).map((x) => ({ ticker:x.ticker, rank:x.rank, fusionRank:x.scores?.fusionRank ?? null }));
    safeSave(STATE_KEY, state.persisted);
  }
}

function resetForNewSession() {
  const phase = marketPhase();
  const savedDate = state.persisted.sessionDate;
  if (savedDate === phase.date) return;
  state.market.clear();
  state.liveActions.clear();
  state.transitions = [];
  state.cursor = 0;
  state.cycle = 0;
  state.postCloseResolvedDate = null;
  state.persisted = { sessionDate:phase.date, transitions:[] };
  safeSave(STATE_KEY, state.persisted);
}

async function start() {
  state.transitions = Array.isArray(state.persisted.transitions) ? state.persisted.transitions : [];
  resetForNewSession();
  ensurePanel();
  render();
  await Promise.all([loadUniverse(), loadOfficialScan()]);
  const phase = marketPhase();
  if (phase.phase === 'OPEN') {
    await refreshPriority(true);
    await scanNextBatch(false);
  } else if (phase.phase === 'POST_CLOSE') {
    await refreshPriority(false);
    await postCloseOfficialCheck();
  }
  render();
}

setInterval(() => {
  if (document.hidden) return;
  resetForNewSession();
  const phase = marketPhase();
  if (phase.phase === 'OPEN') void scanNextBatch(false);
}, BATCH_INTERVAL_MS);

setInterval(() => {
  if (document.hidden) return;
  const phase = marketPhase();
  if (phase.phase === 'OPEN') void refreshPriority(false);
}, PRIORITY_INTERVAL_MS);

setInterval(() => {
  if (document.hidden) return;
  void postCloseOfficialCheck();
}, POST_CLOSE_RESCAN_MS);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const phase = marketPhase();
  if (phase.phase === 'OPEN') {
    void refreshPriority(false);
    void scanNextBatch(false);
  } else if (phase.phase === 'POST_CLOSE') void postCloseOfficialCheck();
});

window.addEventListener('storage', (event) => {
  if ([PORTFOLIO_KEY, ARCHIVE_KEY, RISK_KEY].includes(event.key)) void refreshPriority(true);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
else void start();
