'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIRAGE_URL = 'https://miragebrokerage.eg/';
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const BENCHMARK_SYMBOL = '^CASE30';
const DEFAULT_SEED = [
  'ABUK','ADIB','ALCN','AMOC','AUTO','BTFH','CCAP','CIRA','CLHO','COMI','DOMT','EAST','EFIH','EGAL','EGCH','ESRS','ETEL','FWRY','HELI','HRHO','ISPH','JUFO','MASR','MFPC','MNHD','OCDI','OIH','ORAS','ORHD','PHDC','RMDA','SKPC','SWDY','TMGH'
];

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripTags(s) {
  return decodeHtml(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function num(v) {
  const n = Number(String(v ?? '').replace(/[,٬،%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function normTicker(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}

async function fetchWithTimeout(url, { fetchImpl = global.fetch, timeoutMs = 15000, headers = {}, retries = 2 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('QUANT_EDGE_FETCH_UNAVAILABLE');
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        signal: controller?.signal,
        headers: {
          accept: 'text/html,application/json,text/plain,*/*',
          'accept-language': 'en-US,en;q=0.8,ar;q=0.7',
          'user-agent': 'Mozilla/5.0 QUANT-EDGE/1.1 independent-shadow-research',
          ...headers,
        },
      });
      if (!res || !res.ok) throw new Error(`HTTP_${res?.status || 'ERR'}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError;
}

function parseMirageMarketTable(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(String(html || '')))) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) cells.push(stripTags(cm[1]));
    if (cells.length < 3) continue;
    const ticker = normTicker(cells[0]);
    if (!/^[A-Z][A-Z0-9._-]{1,11}$/.test(ticker) || ['REUTERS','EGX30','EGX70','EGX100'].includes(ticker)) continue;
    const last = num(cells[2]);
    const high = num(cells[3]);
    const low = num(cells[4]);
    if (!Number.isFinite(last) || last <= 0) continue;
    rows.push({ ticker, name: cells[1] || ticker, last, high, low, source: 'MIRAGE_PUBLIC_DELAYED_TABLE' });
  }
  const unique = new Map();
  for (const r of rows) if (!unique.has(r.ticker)) unique.set(r.ticker, r);
  return [...unique.values()];
}

async function discoverUniverse({ fetchImpl = global.fetch, url = MIRAGE_URL, seed = DEFAULT_SEED } = {}) {
  try {
    const res = await fetchWithTimeout(url, { fetchImpl, timeoutMs: 20000, retries: 2 });
    const html = await res.text();
    const parsed = parseMirageMarketTable(html);
    if (parsed.length >= 20) return { source: 'MIRAGE_PUBLIC_DELAYED_TABLE', url, rows: parsed, fallbackUsed: false };
    return { source: 'STATIC_PUBLIC_TICKER_SEED', url, rows: seed.map(ticker => ({ ticker, name: ticker, last: null })), fallbackUsed: true, warning: `MIRAGE_DISCOVERY_LOW_COVERAGE:${parsed.length}` };
  } catch (err) {
    return { source: 'STATIC_PUBLIC_TICKER_SEED', url, rows: seed.map(ticker => ({ ticker, name: ticker, last: null })), fallbackUsed: true, warning: `MIRAGE_DISCOVERY_FAILED:${err.message}` };
  }
}

function normalizeYahooChart(payload, { allowZeroVolume = false } = {}) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = Number(quote.open?.[i]), high = Number(quote.high?.[i]), low = Number(quote.low?.[i]), close = Number(quote.close?.[i]);
    let volume = Number(quote.volume?.[i]);
    if (![open, high, low, close].every(Number.isFinite) || Math.min(open, high, low, close) <= 0) continue;
    if (!Number.isFinite(volume) || volume < 0) volume = 0;
    if (!allowZeroVolume && volume <= 0) continue;
    out.push({ date: new Date(Number(timestamps[i]) * 1000).toISOString().slice(0, 10), open, high, low, close, volume });
  }
  const deduped = new Map();
  for (const b of out) deduped.set(b.date, b);
  return [...deduped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function yahooChartUrl(host, symbol, lookbackDays = 540) {
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - lookbackDays * 86400;
  return `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
}

async function fetchYahooBars(symbol, { fetchImpl = global.fetch, lookbackDays = 540, allowZeroVolume = false } = {}) {
  let lastError;
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetchWithTimeout(yahooChartUrl(host, symbol, lookbackDays), { fetchImpl, timeoutMs: 15000, retries: 1, headers: { accept: 'application/json' } });
      const payload = await res.json();
      if (payload?.chart?.error) throw new Error(payload.chart.error.description || 'YAHOO_CHART_ERROR');
      const bars = normalizeYahooChart(payload, { allowZeroVolume });
      if (!bars.length) throw new Error('YAHOO_NO_VALID_BARS');
      return { symbol, host, bars };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('YAHOO_FETCH_FAILED');
}

async function resolveTickerHistory(ticker, opts = {}) {
  const aliases = opts.aliases || {};
  const candidates = [...new Set([aliases[ticker], `${ticker}.CA`, ticker].filter(Boolean))];
  let lastError;
  for (const symbol of candidates) {
    try {
      return await fetchYahooBars(symbol, opts);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`YAHOO_SYMBOL_UNRESOLVED:${ticker}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, worker));
  return out;
}

async function buildIndependentSnapshot(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const minHistoryBars = Number(options.minHistoryBars || process.env.QE_MIN_HISTORY_BARS || 120);
  const minSymbols = Number(options.minSymbols || process.env.QE_MIN_SYMBOLS || 20);
  const minCoverage = Number(options.minCoverage || process.env.QE_MIN_COVERAGE || 0.55);
  const lookbackDays = Number(options.lookbackDays || process.env.QE_LOOKBACK_DAYS || 540);
  const concurrency = Number(options.concurrency || process.env.QE_FETCH_CONCURRENCY || 4);
  const manualUniverse = String(options.manualUniverse || process.env.QE_UNIVERSE || '').split(',').map(normTicker).filter(Boolean);
  const discovery = manualUniverse.length
    ? { source: 'MANUAL_PUBLIC_TICKER_LIST', rows: manualUniverse.map(ticker => ({ ticker, name: ticker, last: null })), fallbackUsed: false }
    : await discoverUniverse({ fetchImpl, seed: options.seed || DEFAULT_SEED });

  const benchmarkResult = await fetchYahooBars(BENCHMARK_SYMBOL, { fetchImpl, lookbackDays, allowZeroVolume: true });
  if (benchmarkResult.bars.length < minHistoryBars) throw new Error(`QUANT_EDGE_BENCHMARK_HISTORY_INSUFFICIENT:${benchmarkResult.bars.length}`);

  const errors = [];
  const attempts = await mapLimit(discovery.rows, concurrency, async row => {
    try {
      const hist = await resolveTickerHistory(row.ticker, { fetchImpl, lookbackDays, allowZeroVolume: false, aliases: options.aliases || {} });
      if (hist.bars.length < minHistoryBars) throw new Error(`HISTORY_INSUFFICIENT:${hist.bars.length}`);
      const latest = hist.bars[hist.bars.length - 1];
      const divergencePct = Number.isFinite(row.last) && row.last > 0 ? Math.abs(latest.close / row.last - 1) : null;
      return {
        ticker: row.ticker,
        name: row.name || row.ticker,
        bars: hist.bars,
        source: { historyProvider: 'YAHOO_CHART', yahooSymbol: hist.symbol, yahooHost: hist.host, universeProvider: discovery.source },
        mirageDelayedLast: Number.isFinite(row.last) ? row.last : null,
        latestHistoricalClose: latest.close,
        latestHistoricalDate: latest.date,
        publicPriceDivergencePct: divergencePct,
      };
    } catch (err) {
      errors.push({ ticker: row.ticker, error: err.message });
      return null;
    }
  });

  const symbols = attempts.filter(Boolean);
  const coverage = discovery.rows.length ? symbols.length / discovery.rows.length : 0;
  const grade = symbols.length >= minSymbols && coverage >= minCoverage ? 'ANALYSIS_GRADE' : 'DISCOVERY_GRADE';
  const asOf = benchmarkResult.bars[benchmarkResult.bars.length - 1].date;
  return {
    schemaVersion: 2,
    origin: 'QUANT_EDGE_INDEPENDENT_PUBLIC_FEED:YAHOO_HISTORY+MIRAGE_UNIVERSE',
    sourceGrade: grade,
    asOf,
    generatedAt: new Date().toISOString(),
    benchmark: { symbol: BENCHMARK_SYMBOL, bars: benchmarkResult.bars, source: { provider: 'YAHOO_CHART', host: benchmarkResult.host } },
    symbols,
    brokerRecommendationsByTicker: {},
    brokerStats: {},
    provenance: {
      independentFromMain: true,
      mainFilesReadForSignalGeneration: [],
      universe: discovery.source,
      history: 'Yahoo Finance chart endpoint',
      benchmark: BENCHMARK_SYMBOL,
      publicMarketCrossCheck: discovery.source === 'MIRAGE_PUBLIC_DELAYED_TABLE' ? MIRAGE_URL : null,
    },
    diagnostics: {
      discoveredSymbols: discovery.rows.length,
      usableSymbols: symbols.length,
      coverage,
      minCoverage,
      minSymbols,
      minHistoryBars,
      fallbackUniverseUsed: Boolean(discovery.fallbackUsed),
      discoveryWarning: discovery.warning || null,
      errors,
    },
  };
}

async function cli() {
  const out = process.argv[2] || path.join(__dirname, 'data', 'independent-snapshot.json');
  const snapshot = await buildIndependentSnapshot();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: snapshot.sourceGrade === 'ANALYSIS_GRADE', sourceGrade: snapshot.sourceGrade, asOf: snapshot.asOf, usableSymbols: snapshot.symbols.length, coverage: snapshot.diagnostics.coverage, output: out }) + '\n');
  if (snapshot.sourceGrade !== 'ANALYSIS_GRADE') process.exitCode = 2;
}

if (require.main === module) cli().catch(err => { console.error(err.stack || err); process.exit(1); });
module.exports = { MIRAGE_URL, BENCHMARK_SYMBOL, DEFAULT_SEED, stripTags, parseMirageMarketTable, normalizeYahooChart, discoverUniverse, fetchYahooBars, resolveTickerHistory, buildIndependentSnapshot, mapLimit };
