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
function cairoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour) };
}
function cairoDateFromEpoch(epochSeconds) {
  if (!Number.isFinite(Number(epochSeconds))) return null;
  return cairoParts(new Date(Number(epochSeconds) * 1000)).date;
}
function nextIsoDate(date) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
function runtimeCanRepresentExpectedSession(expectedSession) {
  const now = cairoParts();
  return now.date === expectedSession || (now.date === nextIsoDate(expectedSession) && now.hour <= 5);
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
async function fetchJson(url) { return JSON.parse(await fetchText(url, 'application/json,text/plain,*/*')); }
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
function parseSigmaTimestamp(text) {
  const m = String(text || '').match(/\b(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\b/);
  return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, time: `${m[4]}:${m[5]}:${m[6]}` } : null;
}
function parseSigmaTickerRow(html, ticker) {
  for (const tr of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(m => decodeHtml(m[1]));
    const idx = cells.findIndex(c => norm(c) === ticker);
    if (idx < 0) continue;
    const nums = cells.slice(idx + 1).map(parseNum).filter(v => v !== null);
    if (nums.length >= 1) return { raw: cells, close: nums[0], change: nums[1] ?? null, changePct: nums[2] ?? null, volumeOrTurnover: nums[3] ?? null };
  }
  return null;
}
async function sigmaEvidence(ticker, expectedSession, primaryClose, target) {
  if (!runtimeCanRepresentExpectedSession(expectedSession)) return { provider: 'SIGMA_CAPITAL_LIVE_MARKET', status: 'OUTSIDE_SAME_SESSION_GRACE_WINDOW' };
  const urls = [
    'https://www.sigma-cap.com/main/x_homepage?u_sess=1',
    'https://www.sigma-cap.com/main/x_market_page.overview?u_sess=%27',
    'https://sigmacapital.com.eg/main/x_market_page.overview?u_sess=%27'
  ];
  const attempts = [];
  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const text = decodeHtml(html);
      const stamp = parseSigmaTimestamp(text);
      if (stamp && stamp.date !== expectedSession) { attempts.push({ url, status: 'PAGE_SESSION_MISMATCH', pageDate: stamp.date }); continue; }
      if (!stamp && !runtimeCanRepresentExpectedSession(expectedSession)) { attempts.push({ url, status: 'MISSING_PAGE_TIMESTAMP_OUTSIDE_GRACE' }); continue; }
      const row = parseSigmaTickerRow(html, ticker);
      if (!row) { attempts.push({ url, status: 'TICKER_NOT_IN_VISIBLE_MARKET_TABLE', pageDate: stamp?.date || null }); continue; }
      if (!pricesAgree(primaryClose, row.close)) { attempts.push({ url, status: 'PRICE_DISAGREEMENT', close: row.close, primaryClose, priceDifferencePct: round(priceDiffPct(primaryClose, row.close), 3) }); continue; }
      const reported = n(target?.reportedChangePct);
      if (String(target?.reason) === 'REPORTED_CHANGE_MISMATCH' && reported !== null && row.changePct !== null && Math.abs(row.changePct - reported) > 1.25) {
        attempts.push({ url, status: 'CHANGE_PCT_DISAGREEMENT', sigmaChangePct: row.changePct, primaryReportedChangePct: reported }); continue;
      }
      return {
        provider: 'SIGMA_CAPITAL_LIVE_MARKET', status: 'APPROVED', url, sessionDate: expectedSession,
        close: row.close, open: null, high: null, low: null, volume: row.volumeOrTurnover,
        previousClose: null, changePct: row.changePct, priceDifferencePct: round(priceDiffPct(primaryClose, row.close), 3),
        pageTimestamp: stamp, provenance: stamp ? 'SIGMA_PAGE_EXPLICIT_TIMESTAMP' : 'SIGMA_LIVE_PAGE_FETCHED_WITHIN_POST_CLOSE_GRACE_WINDOW'
      };
    } catch (error) { attempts.push({ url, status: 'FETCH_FAILED', error: String(error?.message || error) }); }
  }
  return { provider: 'SIGMA_CAPITAL_LIVE_MARKET', status: 'UNRESOLVED', attempts };
}
async function resolveTarget(target, marketByTicker, expectedSession) {
  const ticker = norm(target.ticker);
  const primary = marketByTicker.get(ticker) || {};
  const primaryClose = n(primary.price ?? primary.last ?? primary.close ?? target.close);
  const stalePrimary = ['SOURCE_SESSION_MISMATCH', 'SOURCE_SESSION_UNKNOWN'].includes(String(target.reason || ''));
  const attempts = [];

  if (!stalePrimary) {
    const sigma = await sigmaEvidence(ticker, expectedSession, primaryClose, target); attempts.push(sigma);
    if (sigma.status === 'APPROVED') return { ticker, originalReason: target.reason, primary: { source: primary.source || null, sourceUrl: primary.sourceUrl || null, sourceSessionDate: dateOnly(primary.sourceSessionDate), close: primaryClose }, approved: true, approvedEvidence: sigma, attempts };
  }
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
    schemaVersion: '16.9.2-market-second-source-evidence-v3', generatedAt: new Date().toISOString(), expectedSession,
    policy: {
      failClosed: true,
      providers: ['Sigma Capital live market tables with explicit timestamp/post-close grace', 'Yahoo Finance chart with strict EGX identity guard', 'StockAnalysis EGX history'],
      maximumPrimaryVsSecondaryPriceDifferencePct: MAX_PRICE_DIFF_PCT,
      strategyMutation: false,
      rule: 'Same-session anomalies require independent same-session price confirmation; reported-change anomalies also compare independent change percent when available. Stale primary rows require an independent exact-session replacement and are never promoted from stale timestamps alone.'
    },
    targetCount: uniqueTargets.length, approvedCount: approved.length, unresolvedCount: records.length - approved.length,
    approvedTickers: approved.map(r => r.ticker), unresolvedTickers: records.filter(r => !r.approved).map(r => r.ticker), records: Object.fromEntries(records.map(r => [r.ticker, r]))
  };
  writeJson(OUT_PATH, out);
  console.log(JSON.stringify({ expectedSession, targets: out.targetCount, approved: out.approvedCount, unresolved: out.unresolvedCount, approvedTickers: out.approvedTickers, unresolvedTickers: out.unresolvedTickers }, null, 2));
}
main().catch(error => { console.error(error); process.exit(1); });
