#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const MARKET_PATH = 'data/market.json';
const HISTORY_PATH = 'data/history-50.json';
const OUT_PATH = 'data/mubasher-support-resistance-direct.json';
const REPORT_PATH = 'data/mubasher-support-resistance-direct-report.json';

const CONCURRENCY = Number(process.env.EGX_SR_CONCURRENCY || 8);
const TIMEOUT_MS = Number(process.env.EGX_SR_TIMEOUT_MS || 25000);
const MIN_ROWS = Number(process.env.EGX_SR_MIN_ROWS || 80);
const MIN_COVERAGE_PCT = Number(process.env.EGX_DIRECT_SR_MIN_COVERAGE || 95);
const MIN_FRESHNESS_PCT = Number(process.env.EGX_DIRECT_SR_MIN_FRESHNESS || 98);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readJsonSafe(file, fallback = {}) {
  try { return readJson(file); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function normalizeDigits(value) {
  const digits = '٠١٢٣٤٥٦٧٨٩';
  return String(value ?? '').replace(/[٠-٩]/g, d => String(digits.indexOf(d)));
}
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = normalizeDigits(value)
    .replace(/٫/g, '.')
    .replace(/[٬،,\s%]/g, '')
    .replace(/[^\d.+\-eE]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
function symbol(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\.CA$/, '')
    .replace(/[^A-Z0-9.]/g, '');
}
function priceOf(row) {
  return num(row.price ?? row.lastPrice ?? row.currentPrice ?? row.last);
}
function validSR(row) {
  return num(row?.support1) > 0 &&
    num(row?.resistance1) > 0 &&
    num(row.support1) < num(row.resistance1);
}
function saneAgainstPrice(row, marketPrice) {
  if (!validSR(row)) return false;
  if (!(marketPrice > 0)) return true;
  const s1 = num(row.support1);
  const r1 = num(row.resistance1);
  return s1 / marketPrice >= 0.25 &&
    s1 / marketPrice <= 1.50 &&
    r1 / marketPrice >= 0.60 &&
    r1 / marketPrice <= 2.50;
}
function latestHistorySession(history) {
  const dates = [];
  for (const rows of Object.values(history?.symbols || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const date = String(row?.date || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
    }
  }
  return dates.sort().at(-1) || null;
}
function parseSourceSessionDate(value, year) {
  const text = normalizeDigits(value).trim();
  if (!text) return null;
  const englishMonths = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const arabicMonths = {
    'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6,
    'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  };
  const en = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  const ar = text.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/i);
  const match = en || ar;
  if (!match) return null;
  const day = Number(match[1]);
  const monthKey = String(match[2]).toLowerCase();
  const month = en ? englishMonths[monthKey] : arabicMonths[match[2]];
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function compactText(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  return $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function grab(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = num(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}
function parsePage(html, requestedSymbol, sourceUrl) {
  const text = compactText(html);
  const numberPattern = '([0-9٠-٩][0-9٠-٩.,٫٬]*)';

  const resistance2 = grab(text, [
    new RegExp(`Second resistance level\\s*\\(r2\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى مقاومة ثان\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);
  const resistance1 = grab(text, [
    new RegExp(`First resistance level\\s*\\(r1\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى مقاومة أول\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);
  const pivot = grab(text, [
    new RegExp(`Pivot point\\s*${numberPattern}`, 'i'),
    new RegExp(`نقطة الإرتكاز\\s*${numberPattern}`, 'i'),
    new RegExp(`نقطة الارتكاز\\s*${numberPattern}`, 'i'),
  ]);
  const support1 = grab(text, [
    new RegExp(`First support level\\s*\\((?:d1|s1)\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى دعم أول\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);
  const support2 = grab(text, [
    new RegExp(`Second support level\\s*\\((?:d1|d2|s2)\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى دعم ثان\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);

  const updatedAt =
    text.match(/Last update:\s*([^.]*)\./i)?.[1]?.trim() ||
    text.match(/آخر تحديث:\s*(.*?)\s*بتوقيت السوق/i)?.[1]?.trim() ||
    null;

  const result = {
    symbol: requestedSymbol,
    pivot,
    support1,
    support2,
    resistance1,
    resistance2,
    updatedAtText: updatedAt,
    sourceUrl,
    source: 'Mubasher individual stock support-resistance page',
  };
  return validSR(result) ? result : null;
}
async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,ar;q=0.7',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.length < 5000) throw new Error(`HTML too short: ${html.length}`);
      return { html, finalUrl: response.url, status: response.status };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
async function collectOne(row) {
  const s = symbol(row.symbol);
  const marketPrice = priceOf(row);
  const urls = [
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(s)}/support-resistance`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(s)}/support-resistance`,
  ];

  const errors = [];
  for (const url of urls) {
    try {
      const fetched = await fetchWithRetry(url);
      const parsed = parsePage(fetched.html, s, fetched.finalUrl || url);
      if (!parsed) {
        errors.push(`${url}: labels not parsed`);
        continue;
      }
      if (!saneAgainstPrice(parsed, marketPrice)) {
        errors.push(`${url}: levels failed price sanity`);
        continue;
      }
      const fetchedAt = new Date().toISOString();
      return {
        ok: true,
        row: {
          ...parsed,
          sourceSessionDate: parseSourceSessionDate(parsed.updatedAtText, new Date(fetchedAt).getUTCFullYear()),
          marketPrice,
          fetchedAt,
        },
      };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  return { ok: false, symbol: s, errors };
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      if ((index + 1) % 20 === 0) console.log(`Processed ${index + 1}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

(async () => {
  const market = readJson(MARKET_PATH);
  const history = readJsonSafe(HISTORY_PATH, {});
  const referenceSessionDate = latestHistorySession(history);
  const marketRows = Array.isArray(market.rows) ? market.rows : [];
  const eligible = marketRows.filter(row => symbol(row.symbol) && priceOf(row) > 0);

  console.log(`Direct Mubasher S/R pages to fetch: ${eligible.length}; reference session: ${referenceSessionDate || 'unknown'}`);
  const results = await mapLimit(eligible, CONCURRENCY, collectOne);
  const rows = results.filter(result => result?.ok).map(result => result.row);
  const failures = results.filter(result => result && !result.ok);
  const freshRows = referenceSessionDate ? rows.filter(row => row.sourceSessionDate === referenceSessionDate) : [];
  const staleRows = rows.filter(row => !referenceSessionDate || row.sourceSessionDate !== referenceSessionDate);
  const coveragePct = eligible.length ? Number((rows.length / eligible.length * 100).toFixed(2)) : 0;
  const freshnessPct = eligible.length ? Number((freshRows.length / eligible.length * 100).toFixed(2)) : 0;
  const executionGrade = Boolean(
    referenceSessionDate &&
    rows.length >= MIN_ROWS &&
    coveragePct >= MIN_COVERAGE_PCT &&
    freshnessPct >= MIN_FRESHNESS_PCT
  );

  const output = {
    ok: executionGrade,
    executionGrade,
    generatedAt: new Date().toISOString(),
    method: 'individual-stock-server-rendered-pages',
    sourcePattern: 'https://english.mubasher.info/markets/EGX/stocks/{SYMBOL}/support-resistance',
    referenceSessionDate,
    requested: eligible.length,
    count: rows.length,
    freshCount: freshRows.length,
    staleCount: staleRows.length,
    minimumRequiredRows: MIN_ROWS,
    minimumCoveragePct: MIN_COVERAGE_PCT,
    minimumFreshnessPct: MIN_FRESHNESS_PCT,
    coveragePct,
    freshnessPct,
    rows,
  };
  const report = {
    ...output,
    rows: undefined,
    failureCount: failures.length,
    failures,
    staleSymbols: staleRows.map(row => ({ symbol: row.symbol, sourceSessionDate: row.sourceSessionDate, updatedAtText: row.updatedAtText })),
  };

  writeJson(OUT_PATH, output);
  writeJson(REPORT_PATH, report);

  console.log(`Direct S/R rows: ${rows.length}/${eligible.length} (${coveragePct}% coverage); fresh ${freshRows.length}/${eligible.length} eligible (${freshnessPct}%)`);
  if (!executionGrade) {
    console.error(`Direct S/R is not execution-grade: rows>=${MIN_ROWS}, coverage>=${MIN_COVERAGE_PCT}%, freshness>=${MIN_FRESHNESS_PCT}% required for ${referenceSessionDate || 'unknown session'}.`);
    process.exit(2);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
