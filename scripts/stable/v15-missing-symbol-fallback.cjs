#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const HISTORY_DIR = path.join(ROOT, 'data/history');
const REPORT_PATH = path.join(ROOT, 'data/stable/v15-missing-symbol-report.json');
const CONCURRENCY = Math.max(2, Math.min(Number(process.env.EGX_MISSING_SYMBOL_CONCURRENCY || 8), 16));
const TIMEOUT_MS = Number(process.env.EGX_MISSING_SYMBOL_TIMEOUT_MS || 20000);
const MAX_JUMP_PCT = Number(process.env.EGX_MAX_SINGLE_SESSION_JUMP_PCT || 35);

const n = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;
const round = (v, d = 4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const normSymbol = v => String(v || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');

function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function normalizeArabicDigits(value) {
  const map = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','٫':'.','٬':',' };
  return String(value || '').replace(/[٠-٩٫٬]/g, c => map[c] || c);
}
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = normalizeArabicDigits(value).replace(/[,٬،%]/g, '').replace(/[−–—]/g, '-').replace(/[^\d.+\-eE]/g, '');
  const x = Number(cleaned);
  return Number.isFinite(x) ? x : null;
}
function universeSymbols() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs.readdirSync(HISTORY_DIR).filter(name => name.endsWith('.json')).map(name => normSymbol(path.basename(name, '.json'))).filter(Boolean).sort();
}
function historicalRowTrusted(row) {
  const warnings = Array.isArray(row?.warnings) ? row.warnings.map(String) : [];
  if (!(n(row?.close) > 0)) return false;
  if (String(row?.validationStatus || '') === 'source_conflict') return false;
  if (warnings.some(w => /local_price_conflict|latest_close_conflict/i.test(w))) return false;
  const confidence = n(row?.confidence?.overall);
  return confidence === null || confidence >= 60;
}
function previousTrustedClose(symbol, beforeDate) {
  const doc = readJson(path.join(HISTORY_DIR, `${symbol}.json`), {});
  const sessions = (Array.isArray(doc?.sessions) ? doc.sessions : [])
    .filter(row => {
      const date = dateOnly(row?.date || row?.sessionDate);
      return date && date < beforeDate && historicalRowTrusted(row);
    })
    .sort((a, b) => String(a.date || a.sessionDate).localeCompare(String(b.date || b.sessionDate)));
  return n(sessions.at(-1)?.close);
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
        'cache-control': 'no-cache', pragma: 'no-cache',
        referer: 'https://english.mubasher.info/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 EGXProV15Fallback/1.0'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
function firstMatch(text, patterns, group = 1) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    const value = match ? num(match[group]) : null;
    if (value !== null) return value;
  }
  return null;
}
function metricFromWindow(windowText, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = windowText.match(new RegExp(`(?:^|\\s)${escaped}\\s*(?:[:\\-–—])?\\s*([0-9٠-٩][0-9٠-٩,.٫٬]*)`, 'i'));
    if (match) {
      const value = num(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}
function parsePage(html, symbol, url, expectedDate) {
  const plain = stripHtml(html);
  const lastUpdateIndex = plain.search(/Last update:|آخر تحديث/i);
  const before = lastUpdateIndex >= 0 ? plain.slice(Math.max(0, lastUpdateIndex - 220), lastUpdateIndex) : plain.slice(0, 500);
  const quoteWindow = lastUpdateIndex >= 0 ? plain.slice(lastUpdateIndex, Math.min(plain.length, lastUpdateIndex + 7000)) : plain.slice(0, 9000);

  let price = firstMatch(quoteWindow, [
    /Last update:\s*[^.]{0,180}?market time\.\s*([0-9][0-9,.]*)/i,
    /Last update:\s*[^0-9]{0,180}?([0-9][0-9,.]*)/i,
    /آخر تحديث[^0-9٠-٩]{0,180}?([0-9٠-٩][0-9٠-٩,.٫٬]*)/i
  ]);

  if (!(price > 0)) {
    const rawPatterns = [
      /"lastPrice"\s*:\s*"?([0-9][0-9,.]*)"?/i,
      /"last_price"\s*:\s*"?([0-9][0-9,.]*)"?/i,
      /"closingPrice"\s*:\s*"?([0-9][0-9,.]*)"?/i,
      /data-(?:last-)?price=["']([0-9][0-9,.]*)["']/i,
      /class=["'][^"']*(?:last-price|stock-price)[^"']*["'][^>]*>\s*([0-9][0-9,.]*)/i
    ];
    price = firstMatch(html, rawPatterns);
  }
  if (!(price > 0)) return null;

  const previousClose = metricFromWindow(quoteWindow, ['Previous Close', 'Prev. Close', 'الإغلاق السابق']);
  let open = metricFromWindow(quoteWindow, ['Open', 'Opening Price', 'الافتتاح', 'سعر الفتح']);
  let high = metricFromWindow(quoteWindow, ['High', 'Day High', 'الأعلى']);
  let low = metricFromWindow(quoteWindow, ['Low', 'Day Low', 'الأدنى']);
  const volume = metricFromWindow(quoteWindow, ['Volume', 'Traded Volume', 'الحجم', 'كمية التداول']);
  const valueTraded = metricFromWindow(quoteWindow, ['Turnover', 'Value Traded', 'القيمة', 'قيمة التداول']);
  const changePct = firstMatch(quoteWindow, [/[+\-−–]?([0-9][0-9,.]*)%/]);
  const name = before.replace(/\([^)]*\)\s*$/g, '').trim().slice(-180);

  open = open > 0 ? open : (previousClose > 0 ? previousClose : price);
  high = high > 0 ? high : Math.max(open, price);
  low = low > 0 ? low : Math.min(open, price);
  if (high < Math.max(open, price) || low > Math.min(open, price) || low <= 0) {
    high = Math.max(open, price);
    low = Math.min(open, price);
  }

  const priorTrusted = previousTrustedClose(symbol, expectedDate);
  const jumpPct = priorTrusted > 0 ? Math.abs(price / priorTrusted - 1) * 100 : null;
  if (jumpPct !== null && jumpPct > MAX_JUMP_PCT) {
    return { rejected: true, symbol, url, reason: 'EXTREME_JUMP', price: round(price), previousTrustedClose: round(priorTrusted), jumpPct: round(jumpPct, 2) };
  }

  return {
    symbol,
    name_ar: name || symbol,
    name_en: name || symbol,
    price: round(price), last: round(price),
    change: previousClose > 0 ? round(price - previousClose) : null,
    changePct: previousClose > 0 ? round((price / previousClose - 1) * 100, 2) : changePct,
    open: round(open), previousClose: round(previousClose), high: round(high), low: round(low),
    volume: round(volume, 0), valueTraded: round(valueTraded, 0),
    updatedAt: new Date().toISOString(),
    source: 'mubasher_missing_symbol_fallback',
    sourceUrl: url,
    parserVersion: 'v15_flexible_last_update_or_embedded_price',
    previousTrustedClose: round(priorTrusted), jumpPct: round(jumpPct, 2)
  };
}
async function mapLimit(items, limit, fn) {
  const result = new Array(items.length); let cursor = 0;
  async function worker() { while (true) { const index = cursor++; if (index >= items.length) return; result[index] = await fn(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}
async function fetchSymbol(symbol, expectedDate) {
  const urls = [
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`,
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}`
  ];
  const attempts = [];
  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const row = parsePage(html, symbol, url, expectedDate);
      if (row?.rejected) return { ok: false, symbol, rejected: row, attempts };
      if (row) return { ok: true, symbol, row, attempts };
      attempts.push({ url, error: 'price_parse_failed' });
    } catch (error) { attempts.push({ url, error: error.message }); }
  }
  return { ok: false, symbol, attempts };
}
async function main() {
  const market = readJson(MARKET_PATH, {});
  const expectedDate = dateOnly(market?.generatedAt || market?.updatedAt) || new Date().toISOString().slice(0, 10);
  const existingRows = Array.isArray(market?.rows) ? market.rows : [];
  const existingSymbols = new Set(existingRows.map(row => normSymbol(row?.symbol || row?.ticker)).filter(Boolean));
  const universe = universeSymbols();
  const missing = universe.filter(symbol => !existingSymbols.has(symbol));
  const results = await mapLimit(missing, CONCURRENCY, symbol => fetchSymbol(symbol, expectedDate));
  const recovered = results.filter(item => item?.ok && item.row).map(item => item.row);
  const rejected = results.filter(item => item?.rejected).map(item => item.rejected);
  const failed = results.filter(item => !item?.ok && !item?.rejected).map(item => ({ symbol: item.symbol, attempts: item.attempts }));

  const merged = new Map();
  for (const row of existingRows) {
    const symbol = normSymbol(row?.symbol || row?.ticker);
    if (symbol) merged.set(symbol, row);
  }
  for (const row of recovered) merged.set(row.symbol, row);
  market.rows = [...merged.values()];
  market.updatedAt = new Date().toISOString();
  market.fallbackRecoveredRows = recovered.length;
  market.fallbackAttemptedRows = missing.length;
  market.note = `${market.note || ''} Missing-symbol fallback recovered ${recovered.length}/${missing.length}.`.trim();
  writeJson(MARKET_PATH, market);

  const report = {
    schemaVersion: '15.0.0', generatedAt: new Date().toISOString(), expectedDate,
    universeSymbols: universe.length, originalRows: existingRows.length, missingBeforeFallback: missing.length,
    recoveredRows: recovered.length, finalRows: market.rows.length,
    recovered: recovered.map(row => ({ symbol: row.symbol, price: row.price, sourceUrl: row.sourceUrl, previousTrustedClose: row.previousTrustedClose, jumpPct: row.jumpPct })),
    rejected, failed
  };
  writeJson(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  writeJson(REPORT_PATH, { schemaVersion: '15.0.0', generatedAt: new Date().toISOString(), error: error.stack || error.message });
  console.error(error);
  process.exitCode = 1;
});
