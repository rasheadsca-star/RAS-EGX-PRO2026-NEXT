#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const MARKET_PATH = P('data/market.json');
const PRICE_TRUTH_PATH = P('data/stable/v15-price-truth.json');
const OUT_PATH = P('data/stable/v16-market-second-source-evidence.json');
const HISTORY_DIR = P('data/history');
const TIMEOUT_MS = Math.max(5000, Math.min(Number(process.env.EGX_SECOND_SOURCE_TIMEOUT_MS || 18000), 45000));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.EGX_SECOND_SOURCE_CONCURRENCY || 3), 6));
const MAX_PRICE_DIFF_PCT = Math.max(0.25, Math.min(Number(process.env.EGX_SECOND_SOURCE_MAX_PRICE_DIFF_PCT || 2.5), 8));

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
const round = (v, d = 4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const norm = v => String(v || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
function cairoDateFromEpoch(epochSeconds) {
  if (!Number.isFinite(Number(epochSeconds))) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Number(epochSeconds) * 1000));
  const map = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function priceDiffPct(a, b) {
  const x = n(a), y = n(b);
  if (!(x > 0 && y > 0)) return null;
  return Math.abs(x / y - 1) * 100;
}
function pricesAgree(primary, secondary) {
  const diff = priceDiffPct(primary, secondary);
  if (diff === null) return false;
  const abs = Math.abs(Number(primary) - Number(secondary));
  const pennyTolerance = Math.max(0.01, Math.min(Number(primary), Number(secondary)) * 0.08);
  return diff <= MAX_PRICE_DIFF_PCT || (Math.max(Number(primary), Number(secondary)) < 1 && abs <= pennyTolerance);
}
function decodeHtml(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c))).replace(/\s+/g, ' ').trim();
}
function parseNum(value) {
  const raw = String(value || '').replace(/,/g, '').replace(/%/g, '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const m = raw.match(/^\(?(-?\d+(?:\.\d+)?)\)?\s*([KMBT])?$/i);
  if (!m) return n(raw);
  let valueNum = Number(m[1]);
  if (/^\(/.test(raw)) valueNum = -Math.abs(valueNum);
  const mul = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[String(m[2] || '').toUpperCase()] || 1;
  return valueNum * mul;
}
async function fetchText(url, accept = 'text/html,application/xhtml+xml') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, cache: 'no-store', headers: {
      accept, 'accept-language': 'en-US,en;q=0.9', 'cache-control': 'no-cache',
      'user-agent': 'Mozilla/5.0 EGX-Pro-Market-Second-Source/16.9.2'
    }});
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
async function fetchJson(url) {
  const text = await fetchText(url, 'application/json,text/plain,*/*');
  return JSON.parse(text);
}
function historyIdentity(ticker) {
  const history = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
  const warnings = Array.isArray(history.warnings) ? history.warnings.map(String) : [];
  const diff = n(history?.symbolVerification?.evidence?.localDifferencePct);
  const conflict = warnings.some(w => /latest_close_conflict|local_price_conflict/i.test(w)) || (diff !== null && diff > 8);
  return { yahooSymbol: history.yahooSymbol || `${ticker}.CA`, conflict, localDifferencePct: diff, warnings };
}
async function yahooEvidence(ticker, expectedSession, primaryClose, allowStaleReplacement = false) {
  const identity = historyIdentity(ticker);
  if (identity.conflict) return { provider: 'YAHOO_CHART', status: 'REJECTED_IDENTITY_CONFLICT', identity };
  const start = Math.floor(Date.parse(`${expectedSession}T00:00:00Z`) / 1000) - 86400 * 3;
  const end = start + 86400 * 8;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(identity.yahooSymbol)}?period1=${start}&period2=${end}&interval=1d&events=history&includeAdjustedClose=true`;
  try {
    const json = await fetchJson(url);
    const result = json?.chart?.result?.[0];
    const meta = result?.meta || {};
    const returned = norm(meta.symbol);
    const exchangeOk = /CAI|EGX/i.test(`${meta.exchangeName || ''} ${meta.fullExchangeName || ''}`);
    const currencyOk = !meta.currency || String(meta.currency).toUpperCase() === 'EGP';
    if (returned !== ticker || !exchangeOk || !currencyOk) return { provider: 'YAHOO_CHART', status: 'REJECTED_SYMBOL_IDENTITY', url, returned, exchangeName: meta.exchangeName || null, currency: meta.currency || null };
    const timestamps = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
    const rows = timestamps.map((ts, i) => ({ date: cairoDateFromEpoch(ts), timestamp: ts, open: n(q.open?.[i]), high: n(q.high?.[i]), low: n(q.low?.[i]), close: n(q.close?.[i]), adjustedClose: n(adj[i]), volume: n(q.volume?.[i]) })).filter(r => r.date && r.close > 0);
    const row = rows.find(r => r.date === expectedSession);
    if (!row) return { provider: 'YAHOO_CHART', status: 'NO_EXPECTED_SESSION', url, availableDates: rows.map(r => r.date) };
    const prior = rows.filter(r => r.date < expectedSession).at(-1) || null;
    const diff = priceDiffPct(primaryClose, row.close);
    if (!allowStaleReplacement && !pricesAgree(primaryClose, row.close)) return { provider: 'YAHOO_CHART', status: 'PRICE_DISAGREEMENT', url, sessionDate: row.date, close: row.close, primaryClose, priceDifferencePct: round(diff, 3) };
    return { provider: 'YAHOO_CHART', status: 'APPROVED', url, sessionDate: row.date, close: row.close, open: row.open, high: row.high, low: row.low, volume: row.volume, previousClose: prior?.close ?? null, priceDifferencePct: round(diff, 3), identity, primaryPriceAgreementRequired: !allowStaleReplacement, replacementForStalePrimary: allowStaleReplacement };
  } catch (error) { return { provider: 'YAHOO_CHART', status: 'FETCH_FAILED', url, error: String(error?.message || error) }; }
}
function parseStockAnalysisRows(html) {
  const rows = [];
  for (const tr of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(m => decodeHtml(m[1]));
    if (cells.length < 5) continue;
    const time = Date.parse(cells[0]);
    if (!Number.isFinite(time)) continue;
    rows.push({ date: new Date(time).toISOString().slice(0, 10), raw: cells, open: parseNum(cells[1]), high: parseNum(cells[2]), low: parseNum(cells[3]), close: parseNum(cells[4]), volume: parseNum(cells.find((_, i) => i >= 5 && /[KMBT]|\d[\d,]{3,}/i.test(cells[i])) || cells[6]) });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
async function stockAnalysisEvidence(ticker, expectedSession, primaryClose, allowStaleReplacement = false) {
  const urls = [`https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/history/`, `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/history/?p=1`];
  const attempts = [];
  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const rows = parseStockAnalysisRows(html);
      const row = rows.find(r => r.date === expectedSession);
      if (!row) { attempts.push({ url, status: 'NO_EXPECTED_SESSION', latestAvailableSession: rows.at(-1)?.date || null, latestAvailableClose: rows.at(-1)?.close ?? null }); continue; }
      const diff = priceDiffPct(primaryClose, row.close);
      if (!allowStaleReplacement && !pricesAgree(primaryClose, row.close)) { attempts.push({ url, status: 'PRICE_DISAGREEMENT', close: row.close, priceDifferencePct: round(diff, 3) }); continue; }
      return { provider: 'STOCKANALYSIS_EGX_HISTORY', status: 'APPROVED', url, sessionDate: expectedSession, close: row.close, open: row.open, high: row.high, low: row.low, volume: row.volume, previousClose: rows.filter(r => r.date < expectedSession).at(-1)?.close ?? null, priceDifferencePct: round(diff, 3), primaryPriceAgreementRequired: !allowStaleReplacement, replacementForStalePrimary: allowStaleReplacement };
    } catch (error) { attempts.push({ url, status: 'FETCH_FAILED', error: String(error?.message || error) }); }
  }
  return { provider: 'STOCKANALYSIS_EGX_HISTORY', status: 'UNRESOLVED', attempts };
}
async function resolveTarget(target, marketByTicker, expectedSession) {
  const ticker = norm(target.ticker);
  const primary = marketByTicker.get(ticker) || {};
  const primaryClose = n(primary.price ?? primary.last ?? primary.close ?? target.close);
  const stalePrimary = ['SOURCE_SESSION_MISMATCH', 'SOURCE_SESSION_UNKNOWN'].includes(String(target.reason || ''));
  const attempts = [];
  const yahoo = await yahooEvidence(ticker, expectedSession, primaryClose, stalePrimary); attempts.push(yahoo);
  if (yahoo.status === 'APPROVED') return { ticker, originalReason: target.reason, primary: { source: primary.source || null, sourceUrl: primary.sourceUrl || null, sourceSessionDate: dateOnly(primary.sourceSessionDate), close: primaryClose }, approved: true, approvedEvidence: yahoo, attempts };
  const stock = await stockAnalysisEvidence(ticker, expectedSession, primaryClose, stalePrimary); attempts.push(stock);
  if (stock.status === 'APPROVED') return { ticker, originalReason: target.reason, primary: { source: primary.source || null, sourceUrl: primary.sourceUrl || null, sourceSessionDate: dateOnly(primary.sourceSessionDate), close: primaryClose }, approved: true, approvedEvidence: stock, attempts };
  return { ticker, originalReason: target.reason, primary: { source: primary.source || null, sourceUrl: primary.sourceUrl || null, sourceSessionDate: dateOnly(primary.sourceSessionDate), close: primaryClose }, approved: false, approvedEvidence: null, attempts };
}
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length); let cursor = 0;
  async function run() { while (true) { const i = cursor++; if (i >= items.length) return; out[i] = await worker(items[i]); } }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, run));
  return out;
}
async function main() {
  const market = readJson(MARKET_PATH, { rows: [] });
  const price = readJson(PRICE_TRUTH_PATH, {});
  const expectedSession = price.expectedSession || market?.sourceSessionEvidence?.expectedSession || null;
  if (!expectedSession) throw new Error('Missing expected session');
  const targets = (Array.isArray(price.sampleRejected) ? price.sampleRejected : []).filter(r => r?.ticker && ['SOURCE_SESSION_MISMATCH','SOURCE_SESSION_UNKNOWN','EXTREME_JUMP_REQUIRES_SECOND_SOURCE','REPORTED_CHANGE_MISMATCH','SECOND_SOURCE_HISTORY_PERSIST_FAILED'].includes(r.reason));
  const uniqueTargets = [...new Map(targets.map(r => [norm(r.ticker), { ...r, ticker: norm(r.ticker) }])).values()];
  const marketByTicker = new Map((market.rows || []).map(r => [norm(r.symbol || r.ticker || r.code), r]));
  const records = await mapLimit(uniqueTargets, CONCURRENCY, target => resolveTarget(target, marketByTicker, expectedSession));
  const approved = records.filter(r => r.approved);
  const out = {
    schemaVersion: '16.9.2-market-second-source-evidence-v2', generatedAt: new Date().toISOString(), expectedSession,
    policy: { failClosed: true, providers: ['Yahoo Finance chart with strict EGX identity guard', 'StockAnalysis EGX history'], maximumPrimaryVsSecondaryPriceDifferencePct: MAX_PRICE_DIFF_PCT, strategyMutation: false, rule: 'For a same-session primary anomaly, independent close agreement is mandatory. For a stale or unknown primary session, an independent exact-session EGX row may replace the stale primary without matching the stale price. Yahoo remains disallowed when historical identity/scale warnings exist.' },
    targetCount: uniqueTargets.length, approvedCount: approved.length, unresolvedCount: records.length - approved.length,
    approvedTickers: approved.map(r => r.ticker), unresolvedTickers: records.filter(r => !r.approved).map(r => r.ticker), records: Object.fromEntries(records.map(r => [r.ticker, r]))
  };
  writeJson(OUT_PATH, out);
  console.log(JSON.stringify({ expectedSession, targets: out.targetCount, approved: out.approvedCount, unresolved: out.unresolvedCount, approvedTickers: out.approvedTickers, unresolvedTickers: out.unresolvedTickers }, null, 2));
}
main().catch(error => { console.error(error); process.exit(1); });
