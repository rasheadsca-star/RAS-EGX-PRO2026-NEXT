#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const MARKET_INDEX = path.join(ROOT, 'data/quant/market-search-index-v13-17.json');
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const OUT_DIR = path.join(ROOT, 'data/fundamentals');
const RAW_PATH = path.join(OUT_DIR, 'v16-fundamental-raw.json');
const OVERRIDES_PATH = path.join(OUT_DIR, 'v16-official-overrides.json');
const PARSER_VERSION = 'V16.2_EXACT_FINANCIAL_ROWS_1.0';
const BATCH_SIZE = Math.max(5, Math.min(Number(process.env.EGX_FUNDAMENTAL_BATCH || 40), 100));
const MAX_AGE_DAYS = Math.max(3, Math.min(Number(process.env.EGX_FUNDAMENTAL_MAX_AGE_DAYS || 21), 120));
const REQUEST_TIMEOUT_MS = Math.max(7000, Math.min(Number(process.env.EGX_FUNDAMENTAL_TIMEOUT_MS || 25000), 60000));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.EGX_FUNDAMENTAL_CONCURRENCY || 3), 6));
const USER_AGENT = process.env.EGX_FUNDAMENTAL_USER_AGENT || 'EGX-Pro-Fundamental-Research/16.2';

const nowIso = () => new Date().toISOString();
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function num(value) {
  if (value === null || value === undefined || value === '' || value === '-' || value === '—' || /^n\/?a$/i.test(String(value).trim())) return null;
  const raw = String(value).trim();
  const negative = /^\(.*\)$/.test(raw);
  const suffix = raw.match(/([KMBT])\s*%?$/i)?.[1]?.toUpperCase() || null;
  const multiplier = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1;
  const cleaned = raw.replace(/,/g, '').replace(/%/g, '').replace(/[()]/g, '').replace(/[KMBT]$/i, '').trim();
  const parsed = Number(cleaned) * multiplier * (negative ? -1 : 1);
  return Number.isFinite(parsed) ? parsed : null;
}
const round = (value, digits = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const safeRatio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? round(a / b, 4) : null;
function growth(current, prior) { return Number.isFinite(current) && Number.isFinite(prior) && prior > 0 ? round((current / prior - 1) * 100, 2) : null; }
function decodeHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&minus;|&#x2212;/gi, '-')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeLabel(value) {
  return decodeHtml(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseTables(html) {
  const tables = [];
  for (const tableMatch of String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(match => decodeHtml(match[1]));
      if (cells.length >= 2) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}
function extractRows(htmlParts) {
  const rows = new Map();
  for (const html of htmlParts) {
    for (const table of parseTables(html)) {
      for (const row of table) {
        const key = normalizeLabel(row[0]);
        if (!key) continue;
        const values = row.slice(1).map(num);
        const numericCount = values.filter(Number.isFinite).length;
        if (!numericCount) continue;
        const existing = rows.get(key);
        if (!existing || numericCount > existing.numericCount) rows.set(key, { label: row[0], raw: row.slice(1), values, numericCount });
      }
    }
  }
  return rows;
}
function exactRow(rows, ...labels) {
  for (const label of labels) {
    const row = rows.get(normalizeLabel(label));
    if (row) return row;
  }
  return null;
}
const valueAt = (row, index) => Number.isFinite(row?.values?.[index]) ? row.values[index] : null;
function parseScale(text) {
  if (/financials?\s+in\s+billions|billions\s+egp/i.test(text)) return 1e9;
  if (/financials?\s+in\s+millions|millions\s+egp/i.test(text)) return 1e6;
  if (/financials?\s+in\s+thousands|thousands\s+egp/i.test(text)) return 1e3;
  return 1;
}
function parseDate(text) {
  const patterns = [
    /Last updated:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i,
    /Period Ending\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i,
    /Fiscal Year Ends?\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    const time = match ? Date.parse(match[1]) : NaN;
    if (Number.isFinite(time)) return new Date(time).toISOString().slice(0, 10);
  }
  return null;
}
function cleanClassification(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80 || /Stock Lists|Top Analysts|Top Stocks|Corporate Actions|IPO Calendar/i.test(text)) return null;
  return text;
}
function parseClassification(html, companyNameAr) {
  const text = decodeHtml(html);
  const sector = cleanClassification(text.match(/Sector\s+([^|]{2,80})/i)?.[1]);
  const industry = cleanClassification(text.match(/Industry\s+([^|]{2,100})/i)?.[1]);
  const combined = `${sector || ''} ${industry || ''} ${companyNameAr || ''}`.toLowerCase();
  let template = 'GENERAL';
  if (/bank|بنك|مصرف/.test(combined)) template = 'BANK';
  else if (/insurance|تأمين/.test(combined)) template = 'INSURANCE';
  else if (/financial|broker|leasing|factoring|fintech|تمويل|سمسر/.test(combined)) template = 'FINANCIAL_SERVICES';
  else if (/real estate|housing|property|development|إسكان|عقار|تعمير/.test(combined)) template = 'REAL_ESTATE';
  return { sector, industry, template };
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9', 'cache-control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
function scaled(value, scale) { return Number.isFinite(value) ? round(value * scale, 2) : null; }
function parseRecord(ticker, companyNameAr, pages) {
  const allHtml = Object.values(pages);
  const combinedText = decodeHtml(allHtml.join(' '));
  const rows = extractRows(allHtml);
  const scale = parseScale(combinedText);
  const r = (...labels) => exactRow(rows, ...labels);
  const revenue = r('Revenue');
  const netIncome = r('Net Income', 'Net Income to Common');
  const grossProfit = r('Gross Profit');
  const operatingIncome = r('Operating Income');
  const eps = r('Earnings Per Share', 'EPS');
  const cash = r('Cash and Equivalents', 'Cash & Equivalents', 'Cash and Short Term Investments', 'Cash & Investments');
  const debt = r('Total Debt');
  const netCash = r('Net Cash (Debt)', 'Net Cash');
  const operatingCashFlow = r('Operating Cash Flow', 'Cash from Operations');
  const capex = r('Capital Expenditures', 'Capital Expenditure');
  const freeCashFlow = r('Free Cash Flow');
  const grossMargin = r('Gross Margin');
  const operatingMargin = r('Operating Margin');
  const profitMargin = r('Profit Margin', 'Net Profit Margin');
  const fcfMargin = r('FCF Margin', 'Free Cash Flow Margin');
  const pe = r('PE Ratio', 'P E Ratio');
  const pfcf = r('P FCF Ratio', 'Price to Free Cash Flow');
  const ps = r('PS Ratio', 'P S Ratio', 'Price to Sales');
  const pb = r('PB Ratio', 'P B Ratio', 'Price to Book');
  const marketCap = r('Market Cap');
  const enterpriseValue = r('Enterprise Value');
  const sharesOutstanding = r('Shares Out', 'Shares Outstanding');
  const roe = r('Return on Equity', 'ROE');
  const roa = r('Return on Assets', 'ROA');
  const currentRatio = r('Current Ratio');
  const debtEquity = r('Debt to Equity', 'Debt Equity Ratio', 'Debt / Equity');
  const dividendYield = r('Dividend Yield');

  const latestRevenue = valueAt(revenue, 0);
  const annualRevenue = valueAt(revenue, 1);
  const priorRevenue = valueAt(revenue, 2);
  const latestNetIncome = valueAt(netIncome, 0);
  const annualNetIncome = valueAt(netIncome, 1);
  const priorNetIncome = valueAt(netIncome, 2);
  const latestOcf = valueAt(operatingCashFlow, 0);
  const latestFcf = valueAt(freeCashFlow, 0);
  const latestCash = valueAt(cash, 0);
  const latestDebt = valueAt(debt, 0);

  const urls = {
    incomeUrl: `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/financials/`,
    balanceSheetUrl: `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/financials/balance-sheet/`,
    cashFlowUrl: `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/financials/cash-flow-statement/`,
    statisticsUrl: `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/statistics/`,
  };
  const record = {
    ticker,
    companyNameAr,
    currency: 'EGP',
    scale,
    sourceAsOf: parseDate(combinedText),
    fetchedAt: nowIso(),
    source: { provider: 'stockanalysis_sp_global_standardized', providerTier: 'SECONDARY_STANDARDIZED', ...urls, officialDisclosureVerified: false, audited: null },
    classification: parseClassification(pages.statistics, companyNameAr),
    latest: {
      revenue: scaled(latestRevenue, scale), grossProfit: scaled(valueAt(grossProfit, 0), scale), operatingIncome: scaled(valueAt(operatingIncome, 0), scale), netIncome: scaled(latestNetIncome, scale), eps: round(valueAt(eps, 0), 4),
      cashAndInvestments: scaled(latestCash, scale), totalDebt: scaled(latestDebt, scale), netCashDebt: scaled(valueAt(netCash, 0), scale), operatingCashFlow: scaled(latestOcf, scale), capitalExpenditures: scaled(valueAt(capex, 0), scale), freeCashFlow: scaled(latestFcf, scale),
      grossMarginPct: round(valueAt(grossMargin, 0), 2), operatingMarginPct: round(valueAt(operatingMargin, 0), 2), netMarginPct: round(valueAt(profitMargin, 0), 2), freeCashFlowMarginPct: round(valueAt(fcfMargin, 0), 2),
      peRatio: round(valueAt(pe, 0), 3), priceToFreeCashFlow: round(valueAt(pfcf, 0), 3), priceToSales: round(valueAt(ps, 0), 3), priceToBook: round(valueAt(pb, 0), 3),
      returnOnEquityPct: round(valueAt(roe, 0), 2), returnOnAssetsPct: round(valueAt(roa, 0), 2), currentRatio: round(valueAt(currentRatio, 0), 3), debtToEquity: round(valueAt(debtEquity, 0), 3), dividendYieldPct: round(valueAt(dividendYield, 0), 2),
      marketCap: round(valueAt(marketCap, 0), 2), enterpriseValue: round(valueAt(enterpriseValue, 0), 2), sharesOutstanding: round(valueAt(sharesOutstanding, 0), 2),
    },
    annual: {
      current: { revenue: scaled(annualRevenue, scale), netIncome: scaled(annualNetIncome, scale) },
      prior: { revenue: scaled(priorRevenue, scale), netIncome: scaled(priorNetIncome, scale) },
    },
    calculated: {
      revenueGrowthPct: growth(annualRevenue, priorRevenue),
      netIncomeGrowthPct: growth(annualNetIncome, priorNetIncome),
      cashToDebt: safeRatio(latestCash, latestDebt),
      operatingCashFlowToNetIncome: safeRatio(latestOcf, latestNetIncome),
      freeCashFlowToNetIncome: safeRatio(latestFcf, latestNetIncome),
    },
    parseDiagnostics: {
      parserVersion: PARSER_VERSION,
      exactLabelMatching: true,
      rowCount: rows.size,
      tableCounts: Object.fromEntries(Object.entries(pages).map(([key, html]) => [key, parseTables(html).length])),
      revenueLabel: revenue?.label || null,
      netIncomeLabel: netIncome?.label || null,
    },
  };
  const available = Object.values(record.latest).filter(Number.isFinite).length;
  const anomalies = [];
  if (!Number.isFinite(record.latest.revenue) || record.latest.revenue < 0) anomalies.push('INVALID_LATEST_REVENUE');
  if (Number.isFinite(record.annual.current.revenue) && record.annual.current.revenue < 0) anomalies.push('INVALID_ANNUAL_REVENUE');
  if (Number.isFinite(record.annual.prior.revenue) && record.annual.prior.revenue < 0) anomalies.push('INVALID_PRIOR_REVENUE');
  if (Number.isFinite(record.latest.sharesOutstanding) && record.latest.sharesOutstanding <= 0) anomalies.push('INVALID_SHARES_OUTSTANDING');
  if (Number.isFinite(record.latest.marketCap) && record.latest.marketCap <= 0) anomalies.push('INVALID_MARKET_CAP');
  if (record.parseDiagnostics.revenueLabel && /growth/i.test(record.parseDiagnostics.revenueLabel)) anomalies.push('REVENUE_GROWTH_ROW_COLLISION');
  if (record.parseDiagnostics.netIncomeLabel && /growth/i.test(record.parseDiagnostics.netIncomeLabel)) anomalies.push('NET_INCOME_GROWTH_ROW_COLLISION');
  record.parseDiagnostics.availableMetricCount = available;
  record.parseDiagnostics.anomalies = anomalies;
  record.parseDiagnostics.parseAccepted = available >= 10 && anomalies.length === 0 && Number.isFinite(record.latest.revenue);
  if (!record.parseDiagnostics.parseAccepted) throw new Error(`FINANCIAL_PARSE_REJECTED_${anomalies.join('_') || available}`);
  return record;
}
function mergeOverride(record, override) {
  if (!override || typeof override !== 'object') return record;
  const merged = JSON.parse(JSON.stringify(record));
  for (const key of ['classification', 'latest', 'annual', 'calculated']) if (override[key]) merged[key] = { ...merged[key], ...override[key] };
  merged.source = { ...merged.source, officialDisclosureVerified: override.officialDisclosureVerified === true, audited: override.audited === true, officialUrl: override.officialUrl || null, officialPublishedAt: override.officialPublishedAt || null, officialPeriodEnd: override.officialPeriodEnd || null, overrideNotes: override.notes || null };
  if (override.officialPeriodEnd) merged.sourceAsOf = override.officialPeriodEnd;
  return merged;
}
function ageDays(record) {
  const time = Date.parse(record?.fetchedAt || '');
  return Number.isFinite(time) ? (Date.now() - time) / 86400000 : Infinity;
}
function chooseTickers(market, decision, cache) {
  const all = [...new Map((market.stocks || []).map(item => [String(item.ticker || '').toUpperCase(), { ...item, ticker: String(item.ticker || '').toUpperCase() }])).values()]
    .filter(item => /^[A-Z0-9.\-]{2,12}$/.test(item.ticker));
  const recommended = new Set((decision.recommendations || []).map(item => String(item.ticker || '').toUpperCase()));
  const needsFetch = all.filter(item => {
    const record = cache.records[item.ticker];
    return !record || record.parseDiagnostics?.parserVersion !== PARSER_VERSION || ageDays(record) >= MAX_AGE_DAYS;
  });
  needsFetch.sort((a, b) => (recommended.has(b.ticker) ? 1 : 0) - (recommended.has(a.ticker) ? 1 : 0) || ageDays(cache.records[b.ticker]) - ageDays(cache.records[a.ticker]) || a.ticker.localeCompare(b.ticker));
  return { all, selected: needsFetch.slice(0, BATCH_SIZE) };
}
async function collectOne(item, override) {
  const ticker = item.ticker;
  const base = `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}`;
  const urls = {
    income: `${base}/financials/`,
    balance: `${base}/financials/balance-sheet/`,
    cash: `${base}/financials/cash-flow-statement/`,
    statistics: `${base}/statistics/`,
  };
  const [income, balance, cash, statistics] = await Promise.all([fetchText(urls.income), fetchText(urls.balance), fetchText(urls.cash), fetchText(urls.statistics)]);
  return mergeOverride(parseRecord(ticker, item.companyNameAr || item.companyNameEn || ticker, { income, balance, cash, statistics }), override);
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      try { results[current] = { ok: true, value: await worker(items[current]) }; }
      catch (error) { results[current] = { ok: false, error: String(error?.message || error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  const market = readJson(MARKET_INDEX, { stocks: [] });
  const decision = readJson(DECISION_PATH, { recommendations: [] });
  const old = readJson(RAW_PATH, { records: {}, failures: {} });
  const overrides = readJson(OVERRIDES_PATH, { records: {} });
  const records = {};
  for (const [ticker, record] of Object.entries(old.records || {})) {
    if (record?.parseDiagnostics?.parserVersion === PARSER_VERSION) records[ticker] = record;
  }
  const cache = { records };
  const { all, selected } = chooseTickers(market, decision, cache);
  const results = await mapLimit(selected, CONCURRENCY, item => collectOne(item, overrides.records?.[item.ticker]));
  const failures = { ...(old.failures || {}) };
  let succeeded = 0;
  const runFailures = [];
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i], result = results[i];
    if (result?.ok) {
      records[item.ticker] = result.value;
      delete failures[item.ticker];
      succeeded++;
    } else {
      failures[item.ticker] = { ticker: item.ticker, companyNameAr: item.companyNameAr || item.ticker, error: result?.error || 'UNKNOWN', attemptedAt: nowIso(), parserVersion: PARSER_VERSION };
      runFailures.push(failures[item.ticker]);
    }
  }
  const values = Object.values(records);
  const output = {
    schemaVersion: '16.2.0',
    generatedAt: nowIso(),
    parserVersion: PARSER_VERSION,
    provider: { name: 'stockanalysis_sp_global_standardized', tier: 'SECONDARY_STANDARDIZED', officialOverridesSupported: true, methodology: 'Exact financial-row matching across income statement, balance sheet, cash flow and statistics. Growth rows are never aliased to monetary line items.' },
    universeCount: all.length,
    attemptedThisRun: selected.length,
    succeededThisRun: succeeded,
    failedThisRun: selected.length - succeeded,
    coverageCount: values.length,
    coveragePct: all.length ? round(values.length / all.length * 100, 1) : 0,
    freshCount: values.filter(record => ageDays(record) < MAX_AGE_DAYS).length,
    officialVerifiedCount: values.filter(record => record.source?.officialDisclosureVerified).length,
    records,
    failures,
    runFailures,
  };
  writeJson(RAW_PATH, output);
  console.log(JSON.stringify({ parserVersion: PARSER_VERSION, universe: all.length, attempted: selected.length, succeeded, failed: selected.length - succeeded, coverage: values.length, recommendations: (decision.recommendations || []).map(r => r.ticker), recommendationCoverage: (decision.recommendations || []).filter(r => records[r.ticker]).length }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
