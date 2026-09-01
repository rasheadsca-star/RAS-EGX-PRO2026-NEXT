export const TECHNICAL_VISUALIZATION_CONTRACT = Object.freeze({
  moduleId: 'V16_9_TECHNICAL_VISUALIZATION_EXTENSION_V1',
  historyRouteOnly: true,
  maxHistorySessions: 260,
  scoringImpact: 'NONE',
  recommendationMutationAllowed: false,
  executionAllowed: false,
  automaticOrders: false,
  horizons: Object.freeze(['SHORT', 'MEDIUM', 'LONG']),
  overlays: Object.freeze(['REGRESSION_PRICE_CHANNEL', 'FIBONACCI_RETRACEMENT']),
});

const API = '/api/index';
const DEFAULTS = Object.freeze({ channel: true, channelWindow: 60, fibonacci: true, fibWindow: 120 });
const STATE = { ticker: null, bars: [], settings: { ...DEFAULTS }, applying: false, requested: null };

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const format = (value, digits = 2) => finite(value) === null
  ? '—'
  : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits });
const pct = (value, digits = 1) => finite(value) === null ? '—' : `${format(value, digits)}%`;

export function normalizeTechnicalBars(rows = []) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = String(row?.date ?? '').slice(0, 10);
    const close = finite(row?.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) continue;
    const high = finite(row?.high);
    const low = finite(row?.low);
    byDate.set(date, {
      date,
      open: finite(row?.open),
      high: high !== null ? high : close,
      low: low !== null ? low : close,
      close,
      volume: Math.max(0, finite(row?.volume) ?? 0),
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function sma(values = [], period = 20) {
  const p = Math.max(1, Math.trunc(period));
  const clean = (Array.isArray(values) ? values : []).map(finite).filter((x) => x !== null);
  if (clean.length < p) return null;
  const sample = clean.slice(-p);
  return sample.reduce((sum, value) => sum + value, 0) / p;
}

export function rsi14(rows = []) {
  const bars = normalizeTechnicalBars(rows);
  if (bars.length < 15) return null;
  const sample = bars.slice(-15);
  let gains = 0, losses = 0;
  for (let i = 1; i < sample.length; i += 1) {
    const delta = sample[i].close - sample[i - 1].close;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function regressionPriceChannel(rows = [], lookback = 60, widthSigma = 2) {
  const bars = normalizeTechnicalBars(rows);
  const n = Math.min(Math.max(5, Math.trunc(lookback)), bars.length);
  if (n < 5) return null;
  const sample = bars.slice(-n);
  const meanX = (n - 1) / 2;
  const meanY = sample.reduce((sum, row) => sum + row.close, 0) / n;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - meanX) * (sample[i].close - meanY);
    denominator += (i - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  const fitted = sample.map((_, i) => intercept + slope * i);
  const residuals = sample.map((row, i) => row.close - fitted[i]);
  const sigma = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / n);
  const width = Math.max(0, sigma * Math.max(0, finite(widthSigma) ?? 2));
  const centerStart = fitted[0], centerEnd = fitted.at(-1);
  return {
    lookback: n,
    startDate: sample[0].date,
    endDate: sample.at(-1).date,
    slope,
    slopePctPerSession: meanY > 0 ? (slope / meanY) * 100 : 0,
    sigma,
    centerStart,
    centerEnd,
    upperStart: centerStart + width,
    upperEnd: centerEnd + width,
    lowerStart: centerStart - width,
    lowerEnd: centerEnd - width,
  };
}

export function fibonacciRetracement(rows = [], lookback = 120) {
  const bars = normalizeTechnicalBars(rows);
  const n = Math.min(Math.max(10, Math.trunc(lookback)), bars.length);
  if (n < 10) return null;
  const sample = bars.slice(-n);
  let low = { value: Infinity, index: -1, date: null };
  let high = { value: -Infinity, index: -1, date: null };
  sample.forEach((row, index) => {
    if (row.low < low.value) low = { value: row.low, index, date: row.date };
    if (row.high > high.value) high = { value: row.high, index, date: row.date };
  });
  if (!(high.value > low.value)) return null;
  const direction = low.index <= high.index ? 'UP' : 'DOWN';
  const range = high.value - low.value;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const levels = ratios.map((ratio) => ({
    ratio,
    price: direction === 'UP'
      ? high.value - range * ratio
      : low.value + range * ratio,
  }));
  return { lookback: n, direction, low, high, range, levels };
}

function horizonVerdict(sample, movingAveragePeriod, moveThresholdPct) {
  if (sample.length < 5) return null;
  const closes = sample.map((row) => row.close);
  const last = closes.at(-1);
  const first = closes[0];
  const changePct = first > 0 ? (last / first - 1) * 100 : null;
  const movingAverage = sma(closes, Math.min(movingAveragePeriod, closes.length));
  const channel = regressionPriceChannel(sample, sample.length, 1.5);
  const rsi = rsi14(sample);
  let score = 0;
  if (changePct !== null) score += changePct > moveThresholdPct ? 1 : changePct < -moveThresholdPct ? -1 : 0;
  if (movingAverage !== null) score += last > movingAverage * 1.005 ? 1 : last < movingAverage * 0.995 ? -1 : 0;
  if (channel) score += channel.slopePctPerSession > 0.03 ? 1 : channel.slopePctPerSession < -0.03 ? -1 : 0;
  const trend = score >= 2 ? 'صاعد' : score <= -2 ? 'هابط' : 'محايد';
  const support = Math.min(...sample.map((row) => row.low));
  const resistance = Math.max(...sample.map((row) => row.high));
  return { trend, score, last, changePct, movingAverage, rsi, support, resistance, channel };
}

export function buildArabicTechnicalAnalysis(rows = []) {
  const bars = normalizeTechnicalBars(rows);
  if (bars.length < 20) {
    return {
      available: false,
      reasonAr: 'التاريخ المتاح غير كافٍ لبناء تحليل فني متعدد الآجال.',
      scoringImpact: 'NONE', executionAllowed: false,
    };
  }
  const horizons = [
    { key: 'short', labelAr: 'قصير الأجل', sessions: Math.min(20, bars.length), ma: 20, threshold: 2 },
    { key: 'medium', labelAr: 'متوسط الأجل', sessions: Math.min(60, bars.length), ma: 50, threshold: 5 },
    { key: 'long', labelAr: 'طويل الأجل', sessions: Math.min(200, bars.length), ma: 200, threshold: 10 },
  ];
  const result = {};
  for (const horizon of horizons) {
    const sample = bars.slice(-horizon.sessions);
    const value = horizonVerdict(sample, horizon.ma, horizon.threshold);
    const maLabel = horizon.key === 'short' ? 'SMA20' : horizon.key === 'medium' ? 'SMA50' : (bars.length >= 200 ? 'SMA200' : `متوسط ${horizon.sessions} جلسة`);
    const momentum = value?.rsi === null || value?.rsi === undefined
      ? 'زخم غير مكتمل'
      : value.rsi >= 70 ? 'زخم مرتفع/تشبع شرائي محتمل'
      : value.rsi <= 30 ? 'زخم ضعيف/تشبع بيعي محتمل'
      : value.rsi >= 55 ? 'زخم إيجابي'
      : value.rsi <= 45 ? 'زخم سلبي'
      : 'زخم محايد';
    result[horizon.key] = {
      labelAr: horizon.labelAr,
      sessions: horizon.sessions,
      trendAr: value?.trend ?? 'غير متاح',
      changePct: value?.changePct ?? null,
      movingAverage: value?.movingAverage ?? null,
      movingAverageLabelAr: maLabel,
      rsi14: value?.rsi ?? null,
      momentumAr: momentum,
      support: value?.support ?? null,
      resistance: value?.resistance ?? null,
      summaryAr: value
        ? `${value.trend}؛ تغير ${pct(value.changePct)} خلال ${horizon.sessions} جلسة، والسعر ${value.last >= value.movingAverage ? 'أعلى' : 'أسفل'} ${maLabel}. ${momentum}.`
        : 'بيانات غير كافية.',
    };
  }
  return {
    available: true,
    asOf: bars.at(-1)?.date ?? null,
    barsAvailable: bars.length,
    short: result.short,
    medium: result.medium,
    long: result.long,
    scoringImpact: 'NONE',
    recommendationMutationAllowed: false,
    executionAllowed: false,
  };
}

function inferTicker() {
  const title = document.getElementById('selectedTitle')?.textContent ?? '';
  const match = title.match(/^([A-Z0-9._-]{2,12})\s*[—-]/i);
  return match ? match[1].toUpperCase() : null;
}

async function fetchHistory(ticker) {
  const query = new URLSearchParams({ route: 'history', ticker, limit: String(TECHNICAL_VISUALIZATION_CONTRACT.maxHistorySessions), t: String(Date.now()) });
  const response = await fetch(`${API}?${query.toString()}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return normalizeTechnicalBars(data.bars);
}

function ensureStyle() {
  if (document.getElementById('taToolsStyle')) return;
  const style = document.createElement('style');
  style.id = 'taToolsStyle';
  style.textContent = `
    .ta-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0;padding:9px 10px;border:1px solid #244b62;border-radius:10px;background:#081b27;font-size:11px}
    .ta-tools label{display:inline-flex;align-items:center;gap:5px;color:#b8cfdb}.ta-tools select{background:#061722;color:#e9f7ff;border:1px solid #315269;border-radius:7px;padding:5px 7px}
    .ta-tools-note{margin-inline-start:auto;color:#7fa2b4}.ta-horizons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}
    .ta-horizon{padding:10px 11px;border:1px solid #24475b;border-radius:10px;background:#071923;line-height:1.65}.ta-horizon h4{margin:0 0 5px;font-size:12px}.ta-horizon b{font-size:13px}.ta-horizon p{margin:5px 0 0;color:#b9ccd6;font-size:10px}
    .ta-up{color:#78e6af}.ta-down{color:#ff8995}.ta-flat{color:#ffd77e}.ta-levels{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;color:#91adbc;font-size:10px}
    @media(max-width:760px){.ta-horizons{grid-template-columns:1fr}.ta-tools-note{width:100%;margin:0}}
  `;
  document.head.appendChild(style);
}

function ensureControls() {
  const chart = document.getElementById('chartBox');
  if (!chart) return null;
  let tools = document.getElementById('taTools');
  if (!tools) {
    tools = document.createElement('div');
    tools.id = 'taTools';
    tools.className = 'ta-tools';
    tools.innerHTML = `
      <label><input id="taChannelToggle" type="checkbox" checked> قناة سعرية</label>
      <label>الفترة<select id="taChannelWindow"><option value="20">20</option><option value="60" selected>60</option><option value="120">120</option></select></label>
      <label><input id="taFibToggle" type="checkbox" checked> فيبوناتشي</label>
      <label>Fib<select id="taFibWindow"><option value="60">60</option><option value="120" selected>120</option></select></label>
      <span class="ta-tools-note">أدوات عرض فقط · لا تغيّر التوصية</span>`;
    chart.insertAdjacentElement('afterend', tools);
    tools.querySelector('#taChannelToggle').addEventListener('change', (event) => { STATE.settings.channel = event.target.checked; renderExtension(); });
    tools.querySelector('#taChannelWindow').addEventListener('change', (event) => { STATE.settings.channelWindow = Number(event.target.value); renderExtension(); });
    tools.querySelector('#taFibToggle').addEventListener('change', (event) => { STATE.settings.fibonacci = event.target.checked; renderExtension(); });
    tools.querySelector('#taFibWindow').addEventListener('change', (event) => { STATE.settings.fibWindow = Number(event.target.value); renderExtension(); });
  }
  return tools;
}

function ensureAnalysisPanel() {
  const tools = ensureControls();
  if (!tools) return null;
  let panel = document.getElementById('taHorizonPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'taHorizonPanel';
    tools.insertAdjacentElement('afterend', panel);
  }
  return panel;
}

function renderAnalysis() {
  const panel = ensureAnalysisPanel();
  if (!panel) return;
  const analysis = buildArabicTechnicalAnalysis(STATE.bars);
  if (!analysis.available) {
    panel.innerHTML = `<div class="rc2-note">${escapeHtml(analysis.reasonAr)}</div>`;
    return;
  }
  const card = (item) => {
    const cls = item.trendAr === 'صاعد' ? 'ta-up' : item.trendAr === 'هابط' ? 'ta-down' : 'ta-flat';
    return `<div class="ta-horizon"><h4>${escapeHtml(item.labelAr)}</h4><b class="${cls}">${escapeHtml(item.trendAr)}</b><p>${escapeHtml(item.summaryAr)}</p><div class="ta-levels"><span>دعم ${format(item.support,3)}</span><span>مقاومة ${format(item.resistance,3)}</span><span>RSI ${format(item.rsi14,1)}</span></div></div>`;
  };
  panel.innerHTML = `<div class="ta-horizons">${card(analysis.short)}${card(analysis.medium)}${card(analysis.long)}</div>`;
}

function parsePriceToY(svg) {
  const labels = [...svg.querySelectorAll('text')]
    .map((text) => ({ x: finite(text.getAttribute('x')), y: finite(text.getAttribute('y')), value: finite(String(text.textContent || '').replace(/,/g, '')) }))
    .filter((x) => x.x !== null && x.x <= 10 && x.y !== null && x.value !== null);
  if (labels.length < 2) return null;
  labels.sort((a, b) => a.value - b.value);
  const lo = labels[0], hi = labels.at(-1);
  if (hi.value === lo.value) return null;
  const slope = (hi.y - lo.y) / (hi.value - lo.value);
  const intercept = lo.y - slope * lo.value;
  return (price) => slope * price + intercept;
}

function svgLine(group, x1, y1, x2, y2, color, width = 1.2, dash = '') {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  [['x1',x1],['y1',y1],['x2',x2],['y2',y2],['stroke',color],['stroke-width',width]].forEach(([key,value]) => line.setAttribute(key, String(value)));
  if (dash) line.setAttribute('stroke-dasharray', dash);
  group.appendChild(line);
}

function svgLabel(group, x, y, textValue, color) {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String(x)); text.setAttribute('y', String(y)); text.setAttribute('fill', color);
  text.setAttribute('font-size', '8'); text.setAttribute('text-anchor', 'end');
  text.textContent = textValue; group.appendChild(text);
}

function renderOverlay() {
  const svg = document.querySelector('#chartBox svg');
  if (!svg || !STATE.bars.length) return;
  svg.querySelector('#taOverlay')?.remove();
  const priceToY = parsePriceToY(svg);
  if (!priceToY) return;
  const viewBox = (svg.getAttribute('viewBox') || '0 0 920 320').trim().split(/\s+/).map(Number);
  const width = Number.isFinite(viewBox[2]) ? viewBox[2] : 920;
  const height = Number.isFinite(viewBox[3]) ? viewBox[3] : 320;
  const left = 55, right = width - 20, top = 20, bottom = height - 36;
  const chartBars = STATE.bars.slice(-120);
  const xFor = (index) => left + index * (right - left) / Math.max(1, chartBars.length - 1);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.id = 'taOverlay'; group.setAttribute('pointer-events', 'none');

  if (STATE.settings.channel) {
    const lookback = Math.min(STATE.settings.channelWindow, chartBars.length);
    const channel = regressionPriceChannel(chartBars, lookback, 2);
    if (channel) {
      const startIndex = chartBars.length - channel.lookback;
      const x1 = xFor(startIndex), x2 = xFor(chartBars.length - 1);
      const channelLines = [
        [channel.upperStart, channel.upperEnd, '#ffd166', 'Channel +2σ'],
        [channel.centerStart, channel.centerEnd, '#f4a261', 'Channel Mid'],
        [channel.lowerStart, channel.lowerEnd, '#ffd166', 'Channel -2σ'],
      ];
      channelLines.forEach(([start, end, color, label]) => {
        const y1 = priceToY(start), y2 = priceToY(end);
        if ([y1,y2].every((y) => Number.isFinite(y))) {
          svgLine(group, x1, y1, x2, y2, color, label === 'Channel Mid' ? 1.5 : 1.1, label === 'Channel Mid' ? '' : '5 4');
          if (y2 >= top && y2 <= bottom) svgLabel(group, right - 4, y2 - 3, label, color);
        }
      });
    }
  }

  if (STATE.settings.fibonacci) {
    const fib = fibonacciRetracement(chartBars, Math.min(STATE.settings.fibWindow, chartBars.length));
    if (fib) {
      const colors = ['#7bdff2','#b2f7ef','#eff7a8','#f7d6e0','#f2b5d4','#cdb4db','#a0c4ff'];
      fib.levels.forEach((level, index) => {
        const y = priceToY(level.price);
        if (!Number.isFinite(y) || y < top || y > bottom) return;
        svgLine(group, left, y, right, y, colors[index], 0.9, '3 5');
        svgLabel(group, right - 4, y - 2, `Fib ${format(level.ratio * 100,1)}% ${format(level.price,3)}`, colors[index]);
      });
    }
  }
  svg.appendChild(group);
}

function renderExtension() {
  if (STATE.applying) return;
  STATE.applying = true;
  try { renderAnalysis(); renderOverlay(); } finally { STATE.applying = false; }
}

async function refreshForSelection() {
  const ticker = inferTicker();
  if (!ticker || /جارٍ/.test(document.getElementById('selectedTitle')?.textContent || '')) return;
  if (ticker === STATE.ticker && STATE.bars.length) { renderExtension(); return; }
  if (STATE.requested === ticker) return;
  STATE.requested = ticker;
  try {
    const bars = await fetchHistory(ticker);
    if (inferTicker() !== ticker) return;
    STATE.ticker = ticker; STATE.bars = bars;
    renderExtension();
  } catch (error) {
    const panel = ensureAnalysisPanel();
    if (panel) panel.innerHTML = `<div class="rc2-note">تعذر تحميل التحليل الفني الإضافي: ${escapeHtml(error?.message || 'خطأ غير معروف')}</div>`;
  } finally {
    if (STATE.requested === ticker) STATE.requested = null;
  }
}

function bootBrowserExtension() {
  ensureStyle(); ensureControls();
  const title = document.getElementById('selectedTitle');
  const chart = document.getElementById('chartBox');
  if (!title || !chart) return;
  let queued = false;
  const schedule = () => {
    if (queued || STATE.applying) return;
    queued = true;
    queueMicrotask(() => { queued = false; refreshForSelection(); });
  };
  const titleObserver = new MutationObserver(schedule);
  titleObserver.observe(title, { childList: true, subtree: true, characterData: true });
  const chartObserver = new MutationObserver((mutations) => {
    const meaningful = mutations.some((mutation) => [...mutation.addedNodes].some((node) => !(node?.nodeType === 1 && node.id === 'taOverlay')));
    if (meaningful) schedule();
  });
  chartObserver.observe(chart, { childList: true });
  schedule();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootBrowserExtension, { once: true });
  else bootBrowserExtension();
}
