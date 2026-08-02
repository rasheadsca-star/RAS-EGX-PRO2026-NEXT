#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const FETCH_STATUS_PATH = path.join(ROOT, 'data/fetch-status.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v15-price-truth.json');
const MIN_EXECUTION_ROWS = Number(process.env.EGX_MIN_EXECUTION_ROWS || 80);
const PRICE_TOLERANCE_PCT = Number(process.env.EGX_PRICE_MATCH_TOLERANCE_PCT || 1.75);
const TIMEOUT_MS = Number(process.env.EGX_SOURCE_TIMEOUT_MS || 18000);
const CONCURRENCY = Math.max(2, Math.min(Number(process.env.EGX_PRICE_CONCURRENCY || 10), 20));

const n = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;
const round = (v, d = 4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const normSymbol = v => String(v || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');
const pctDiff = (a, b) => a > 0 && b > 0 ? Math.abs(a - b) / ((a + b) / 2) * 100 : Infinity;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function cairoParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}
function expectedLatestCompletedSessionCairo(now = new Date()) {
  const p = cairoParts(now);
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const hour = Number(p.hour) + Number(p.minute) / 60;
  const trading = () => [0, 1, 2, 3, 4].includes(d.getUTCDay());
  if (trading() && hour < 15) d.setUTCDate(d.getUTCDate() - 1);
  while (!trading()) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function universeSymbols() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs.readdirSync(HISTORY_DIR).filter(x => x.endsWith('.json')).map(x => normSymbol(path.basename(x, '.json'))).filter(Boolean);
}
function asNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[,٬،%]/g, '').replace(/[^\d.+\-eE]/g, '');
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}
function first(obj, keys) {
  for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  return null;
}
function normalizeObject(obj, meta) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const symbol = normSymbol(first(obj, ['symbol', 'ticker', 'code', 'Symbol', 'securityCode', 'stockSymbol', 'localCode']));
  if (!symbol) return null;
  const close = asNumber(first(obj, ['close', 'price', 'last', 'lastPrice', 'regularMarketPrice', 'Last', 'last_price', 'closingPrice']));
  if (!(close > 0)) return null;
  const open = asNumber(first(obj, ['open', 'openPrice', 'regularMarketOpen'])) ?? close;
  const high = asNumber(first(obj, ['high', 'dayHigh', 'regularMarketDayHigh'])) ?? Math.max(open, close);
  const low = asNumber(first(obj, ['low', 'dayLow', 'regularMarketDayLow'])) ?? Math.min(open, close);
  const volume = asNumber(first(obj, ['volume', 'tradedVolume', 'regularMarketVolume', 'volumeTraded'])) ?? 0;
  let date = dateOnly(first(obj, ['date', 'sessionDate', 'priceDate', 'tradingDate', 'asOfDate', 'timestamp', 'updatedAt', 'lastTradeTime']));
  if (!date && meta.allowExpectedDate) date = meta.expectedSession;
  if (!date || !(open > 0) || high < Math.max(open, close) || low > Math.min(open, close) || low <= 0) return null;
  return {
    ticker: symbol,
    date,
    open: round(open), high: round(high), low: round(low), close: round(close), volume: round(volume, 0),
    source: meta.source,
    sourceFamily: meta.sourceFamily,
    authenticated: meta.authenticated === true,
    fetchedAt: meta.fetchedAt,
    rawStatus: first(obj, ['status', 'marketState', 'sessionStatus']) || null
  };
}
function collectObjects(value, out = [], depth = 0) {
  if (depth > 8 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out, depth + 1);
  } else if (typeof value === 'object') {
    out.push(value);
    for (const item of Object.values(value)) collectObjects(item, out, depth + 1);
  }
  return out;
}
function normalizePayload(payload, meta) {
  const rows = [];
  for (const obj of collectObjects(payload)) {
    const row = normalizeObject(obj, meta);
    if (row) rows.push(row);
  }
  const map = new Map();
  for (const row of rows) {
    const key = `${row.ticker}|${row.date}`;
    const old = map.get(key);
    if (!old || (row.volume || 0) > (old.volume || 0)) map.set(key, row);
  }
  return [...map.values()];
}
async function fetchAny(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,text/html,*/*',
        'accept-language': 'ar,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'user-agent': 'Mozilla/5.0 EGX-Pro-V15-Price-Truth/1.0',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    try { return JSON.parse(text); } catch {
      const scripts = [...text.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      for (const m of scripts) { try { return JSON.parse(m[1]); } catch {} }
      throw new Error(`Non-JSON response: ${text.slice(0, 120)}`);
    }
  } finally { clearTimeout(timer); }
}
async function sourceBulk(name, sourceFamily, urls, headers, expectedSession, authenticated = false) {
  const attempts = [];
  for (const url of urls) {
    const fetchedAt = new Date().toISOString();
    try {
      const payload = await fetchAny(url, { headers });
      const rows = normalizePayload(payload, { source: name, sourceFamily, authenticated, fetchedAt, expectedSession, allowExpectedDate: true });
      attempts.push({ url, ok: rows.length > 0, rows: rows.length });
      if (rows.length) return { name, sourceFamily, authenticated, rows, attempts };
    } catch (error) { attempts.push({ url, ok: false, rows: 0, error: error.message }); }
  }
  return { name, sourceFamily, authenticated, rows: [], attempts };
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let cursor = 0;
  async function worker() { while (true) { const i = cursor++; if (i >= items.length) return; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
async function sourcePerSymbol(name, sourceFamily, symbols, urlBuilders, headers, expectedSession, authenticated = false) {
  const attempts = []; const rows = [];
  const results = await mapLimit(symbols, CONCURRENCY, async symbol => {
    for (const build of urlBuilders) {
      const url = build(symbol); const fetchedAt = new Date().toISOString();
      try {
        const payload = await fetchAny(url, { headers });
        const found = normalizePayload(payload, { source: name, sourceFamily, authenticated, fetchedAt, expectedSession, allowExpectedDate: true })
          .filter(x => x.ticker === symbol && x.date === expectedSession);
        if (found.length) return { symbol, row: found.at(-1), url };
      } catch {}
    }
    return { symbol, row: null };
  });
  for (const result of results) {
    if (result.row) rows.push(result.row);
    else attempts.push({ symbol: result.symbol, ok: false });
  }
  return { name, sourceFamily, authenticated, rows, attempts: [{ ok: rows.length > 0, rows: rows.length, missed: attempts.length }] };
}
function sourceExistingMarket(expectedSession) {
  const status = readJson(FETCH_STATUS_PATH, {});
  const doc = readJson(MARKET_PATH, {});
  const fetchedAt = doc.generatedAt || doc.updatedAt || status.generatedAt || new Date().toISOString();
  const rows = normalizePayload(doc, {
    source: String(doc.source || status.sourceName || 'existing_market'),
    sourceFamily: 'mubasher_or_configured_public',
    authenticated: false,
    fetchedAt, expectedSession,
    allowExpectedDate: status.realFetch === true
  }).filter(x => x.date === expectedSession);
  return {
    name: 'existing_market_after_legacy_fetch', sourceFamily: 'mubasher_or_configured_public', authenticated: false, rows,
    attempts: [{ ok: status.realFetch === true && rows.length > 0, rows: rows.length, realFetch: status.realFetch === true, mode: status.mode || null }]
  };
}
function chooseAcceptedRows(sources, expectedSession) {
  const byTicker = new Map();
  for (const source of sources) for (const row of source.rows || []) {
    if (row.date !== expectedSession) continue;
    const list = byTicker.get(row.ticker) || [];
    list.push(row); byTicker.set(row.ticker, list);
  }
  const accepted = [], rejected = [];
  for (const [ticker, candidates] of byTicker) {
    const current = candidates.filter(x => x.date === expectedSession && x.close > 0);
    const authenticated = current.filter(x => x.authenticated);
    let picked = null, mode = null, matchedSources = [];
    outer: for (let i = 0; i < current.length; i++) for (let j = i + 1; j < current.length; j++) {
      if (current[i].sourceFamily === current[j].sourceFamily) continue;
      const diff = pctDiff(current[i].close, current[j].close);
      if (diff <= PRICE_TOLERANCE_PCT) {
        picked = [current[i], current[j]]; mode = 'MULTI_SOURCE_MATCH'; matchedSources = picked.map(x => x.source); break outer;
      }
    }
    if (!picked && authenticated.length) {
      picked = [authenticated[0]]; mode = 'AUTHENTICATED_SINGLE_SOURCE'; matchedSources = picked.map(x => x.source);
    }
    if (!picked) {
      rejected.push({ ticker, reason: 'NO_INDEPENDENT_PRICE_MATCH', candidates: current.map(x => ({ source: x.source, price: x.close, family: x.sourceFamily })) });
      continue;
    }
    const median = key => {
      const arr = picked.map(x => n(x[key])).filter(Number.isFinite).sort((a, b) => a - b);
      if (!arr.length) return null; const m = Math.floor(arr.length / 2); return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
    };
    const close = median('close'), open = median('open') ?? close, high = Math.max(median('high') ?? close, open, close), low = Math.min(median('low') ?? close, open, close);
    accepted.push({
      ticker, date: expectedSession, open: round(open), high: round(high), low: round(low), close: round(close), volume: round(median('volume') ?? 0, 0),
      source: 'v15_multi_source_price_truth', primarySource: 'v15_multi_source_price_truth', officialVerified: false,
      verifiedBy: matchedSources, fetchedAt: new Date().toISOString(), validatedAt: new Date().toISOString(),
      confidence: { overall: mode === 'MULTI_SOURCE_MATCH' ? 92 : 88, ohlc: 88, volume: 80, symbolIdentity: 95 },
      validationStatus: mode === 'MULTI_SOURCE_MATCH' ? 'multi_source_confirmed' : 'authenticated_source_confirmed',
      warnings: [], priceTruthMode: mode
    });
  }
  return { accepted, rejected };
}
function mergeIntoHistory(rows) {
  let updated = 0;
  for (const row of rows) {
    const file = path.join(HISTORY_DIR, `${row.ticker}.json`);
    if (!fs.existsSync(file)) continue;
    const doc = readJson(file, {});
    const sessions = Array.isArray(doc.sessions) ? doc.sessions : [];
    const map = new Map(sessions.map(x => [dateOnly(x.date || x.sessionDate), x]).filter(x => x[0]));
    map.set(row.date, row);
    doc.sessions = [...map.values()].sort((a, b) => String(a.date || a.sessionDate).localeCompare(String(b.date || b.sessionDate)));
    doc.lastSession = doc.sessions.at(-1)?.date || doc.sessions.at(-1)?.sessionDate || null;
    doc.availableSessions = doc.sessions.length;
    doc.staleData = false;
    doc.updateFailed = false;
    doc.generatedAt = new Date().toISOString();
    writeJson(file, doc); updated++;
  }
  return updated;
}
async function main() {
  const expectedSession = expectedLatestCompletedSessionCairo();
  const symbols = universeSymbols();
  const sources = [];
  sources.push(sourceExistingMarket(expectedSession));

  const configuredUrl = process.env.EGX_MARKET_JSON_URL || process.env.PUBLIC_MARKET_JSON_URL || '';
  if (configuredUrl) sources.push(await sourceBulk('configured_market_json', 'configured_json', [configuredUrl], {}, expectedSession, false));

  sources.push(await sourceBulk('egxpilot_public', 'egxpilot', [
    'https://egxpilot.com/api/stocks/all',
    'https://www.egxpilot.com/api/stocks/all'
  ], {}, expectedSession, false));

  const egxKey = process.env.EGXAPI_KEY || process.env.EGX_KEY || '';
  if (egxKey) {
    const headers = { Authorization: `Bearer ${egxKey}`, 'X-EGX-Env': 'paper' };
    sources.push(await sourceBulk('egxapi_bulk', 'egxapi', [
      'https://api.egxapi.com/v2/market-data/quotes?exchange=EGX',
      'https://api.egxapi.com/v2/market-data/snapshot?exchange=EGX',
      'https://api.egxapi.com/v2/market-data/quotes'
    ], headers, expectedSession, true));
    if (!(sources.at(-1)?.rows || []).length) {
      sources.push(await sourcePerSymbol('egxapi_symbol', 'egxapi', symbols, [
        s => `https://api.egxapi.com/v2/market-data/quotes?symbols=${encodeURIComponent(s)}`,
        s => `https://api.egxapi.com/v2/market-data/quote?symbol=${encodeURIComponent(s)}`,
        s => `https://api.egxapi.com/v2/market-data/bars?symbol=${encodeURIComponent(s)}&limit=1`
      ], headers, expectedSession, true));
    }
  } else {
    sources.push({ name: 'egxapi', sourceFamily: 'egxapi', authenticated: true, rows: [], attempts: [{ ok: false, error: 'EGXAPI_KEY_NOT_CONFIGURED' }] });
  }

  const { accepted, rejected } = chooseAcceptedRows(sources, expectedSession);
  const updatedHistoryFiles = mergeIntoHistory(accepted);
  const ready = accepted.length >= MIN_EXECUTION_ROWS;
  const report = {
    schemaVersion: '15.1.0', generatedAt: new Date().toISOString(), expectedSession,
    ready, executionGrade: ready, minimumExecutionRows: MIN_EXECUTION_ROWS,
    acceptedRows: accepted.length, rejectedRows: rejected.length, updatedHistoryFiles,
    priceTolerancePct: PRICE_TOLERANCE_PCT,
    sources: sources.map(s => ({ name: s.name, family: s.sourceFamily, authenticated: s.authenticated, rows: (s.rows || []).length, attempts: s.attempts })),
    sampleAccepted: accepted.slice(0, 20).map(x => ({ ticker: x.ticker, close: x.close, mode: x.priceTruthMode, verifiedBy: x.verifiedBy })),
    sampleRejected: rejected.slice(0, 30)
  };
  writeJson(OUT_PATH, report);
  writeJson(FETCH_STATUS_PATH, {
    ok: ready, realFetch: sources.some(s => (s.rows || []).length > 0), scriptExists: true,
    generatedAt: report.generatedAt, mode: ready ? 'v15_multi_source_execution_grade' : 'v15_multi_source_insufficient_matches',
    sourceName: 'v15_multi_source_price_truth', marketRows: accepted.length, coveragePct: symbols.length ? round(accepted.length / symbols.length * 100, 2) : 0,
    message: ready ? `Validated ${accepted.length} current-session EGX rows from independent sources.` : `Only ${accepted.length} current-session rows passed independent-source matching; ${MIN_EXECUTION_ROWS} required.`,
    executionGrade: ready, expectedSession, currentSessionRows: accepted.length
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  const generatedAt = new Date().toISOString();
  const expectedSession = expectedLatestCompletedSessionCairo();
  writeJson(OUT_PATH, { schemaVersion: '15.1.0', generatedAt, expectedSession, ready: false, executionGrade: false, error: error.stack || error.message });
  writeJson(FETCH_STATUS_PATH, { ok: false, realFetch: false, scriptExists: true, generatedAt, mode: 'v15_multi_source_exception', executionGrade: false, expectedSession, message: error.message });
  console.error(error);
  process.exitCode = 1;
});
