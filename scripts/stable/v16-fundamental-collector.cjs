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
const BATCH_SIZE = Math.max(5, Math.min(Number(process.env.EGX_FUNDAMENTAL_BATCH || 24), 80));
const MAX_AGE_DAYS = Math.max(3, Math.min(Number(process.env.EGX_FUNDAMENTAL_MAX_AGE_DAYS || 21), 120));
const REQUEST_TIMEOUT_MS = Math.max(5000, Math.min(Number(process.env.EGX_FUNDAMENTAL_TIMEOUT_MS || 18000), 45000));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.EGX_FUNDAMENTAL_CONCURRENCY || 3), 6));
const USER_AGENT = process.env.EGX_FUNDAMENTAL_USER_AGENT || 'EGX-Pro-Fundamental-Research/16.1 (+public financial research; contact repository owner)';

const nowIso = () => new Date().toISOString();
const num = value => {
  if (value === null || value === undefined || value === '' || value === '-' || value === '—') return null;
  const raw = String(value).trim();
  const negative = /^\(.*\)$/.test(raw);
  const suffix = raw.match(/([KMBT])\s*%?$/i)?.[1]?.toUpperCase() || null;
  const multiplier = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1;
  const cleaned = raw.replace(/,/g, '').replace(/%/g, '').replace(/[()]/g, '').replace(/[KMBT]$/i, '').trim();
  const parsed = Number(cleaned) * multiplier * (negative ? -1 : 1);
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value, digits = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
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
    .replace(/&minus;/gi, '-')
    .replace(/&#x2212;/gi, '-')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
function parseTables(html) {
  const tables = [];
  for (const tableMatch of String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)) cells.push(decodeHtml(cellMatch[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}
function normalizedLabel(value) { return decodeHtml(value).toLowerCase().replace(/\s+/g, ' ').replace(/growth$/i, '').trim(); }
function extractRows(tables) {
  const map = new Map();
  for (const table of tables) for (const row of table) {
    if (row.length < 2) continue;
    const label = normalizedLabel(row[0]);
    if (!label || map.has(label)) continue;
    const values = row.slice(1).map(num);
    if (values.some(value => value !== null)) map.set(label, { raw: row.slice(1), values });
  }
  return map;
}
function findMetric(rows, labels) {
  for (const label of labels) { const exact = rows.get(normalizedLabel(label)); if (exact) return exact; }
  for (const [key, row] of rows.entries()) if (labels.some(label => key.includes(normalizedLabel(label)))) return row;
  return null;
}
const latest = (row, index = 0) => row?.values?.[index] ?? null;
const annual = (row, index = 1) => row?.values?.[index] ?? null;
const priorAnnual = (row, index = 2) => row?.values?.[index] ?? null;
function growth(current, prior) { return Number.isFinite(current) && Number.isFinite(prior) && prior > 0 ? round((current / prior - 1) * 100, 2) : null; }
function parseDateFromText(text) {
  const match = String(text || '').match(/Last updated:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i) || String(text || '').match(/Period Ending\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);
  if (!match) return null;
  const time = Date.parse(match[1]);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
function parseCurrencyScale(text) {
  if (/financials in billions/i.test(text) || /billions egp/i.test(text)) return 1_000_000_000;
  if (/financials in millions/i.test(text) || /millions egp/i.test(text)) return 1_000_000;
  if (/financials in thousands/i.test(text) || /thousands egp/i.test(text)) return 1_000;
  return 1;
}
function parseSector(text) {
  const sector = String(text).match(/Sector\s*([^\n|]{2,80})/i)?.[1]?.trim() || null;
  const industry = String(text).match(/Industry\s*([^\n|]{2,100})/i)?.[1]?.trim() || null;
  return { sector, industry };
}
function classifyTemplate(sector, industry, companyName) {
  const text = `${sector || ''} ${industry || ''} ${companyName || ''}`.toLowerCase();
  if (/bank|مصرف|بنك/.test(text)) return 'BANK';
  if (/insurance|تأمين/.test(text)) return 'INSURANCE';
  if (/financial|broker|leasing|factoring|fintech|تمويل|سمسر/.test(text)) return 'FINANCIAL_SERVICES';
  if (/real estate|housing|development|property|إسكان|عقارات|تعمير/.test(text)) return 'REAL_ESTATE';
  return 'GENERAL';
}
const safeRatio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? round(a / b, 4) : null;
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9', 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
function parseFundamentalPages({ ticker, companyNameAr, overviewHtml, statisticsHtml }) {
  const overviewText = decodeHtml(overviewHtml), statisticsText = decodeHtml(statisticsHtml || '');
  const rows = extractRows(parseTables(overviewHtml)), statRows = extractRows(parseTables(statisticsHtml || ''));
  const metric = (...labels) => findMetric(rows, labels), stat = (...labels) => findMetric(statRows, labels);
  const scale = parseCurrencyScale(overviewText), sourceAsOf = parseDateFromText(overviewText) || parseDateFromText(statisticsText), profile = parseSector(statisticsText);
  const revenue = latest(metric('Revenue')), revenueAnnual = annual(metric('Revenue')), revenuePrior = priorAnnual(metric('Revenue'));
  const netIncome = latest(metric('Net Income')), netIncomeAnnual = annual(metric('Net Income')), netIncomePrior = priorAnnual(metric('Net Income'));
  const operatingIncome = latest(metric('Operating Income')), grossProfit = latest(metric('Gross Profit')), eps = latest(metric('Earnings Per Share', 'EPS'));
  const cash = latest(metric('Cash & Investments')), debt = latest(metric('Total Debt')), netCash = latest(metric('Net Cash (Debt)', 'Net Cash'));
  const operatingCashFlow = latest(metric('Operating Cash Flow')), capex = latest(metric('Capital Expenditures', 'Capital Expenditure')), freeCashFlow = latest(metric('Free Cash Flow'));
  const grossMargin = latest(metric('Gross Margin')), operatingMargin = latest(metric('Operating Margin')), profitMargin = latest(metric('Profit Margin')), fcfMargin = latest(metric('FCF Margin', 'Free Cash Flow Margin'));
  const pe = latest(metric('PE Ratio', 'P/E Ratio')), pfcf = latest(metric('P/FCF Ratio')), ps = latest(metric('PS Ratio', 'P/S Ratio'));
  const marketCap = latest(stat('Market Cap')), enterpriseValue = latest(stat('Enterprise Value')), sharesOutstanding = latest(stat('Shares Out', 'Shares Outstanding'));
  const roe = latest(stat('Return on Equity', 'ROE')), roa = latest(stat('Return on Assets', 'ROA')), currentRatio = latest(stat('Current Ratio'));
  const debtEquity = latest(stat('Debt / Equity Ratio', 'Debt to Equity', 'Debt / Equity')), pb = latest(stat('PB Ratio', 'P/B Ratio', 'Price / Book')), dividendYield = latest(stat('Dividend Yield'));
  const data = {
    ticker, companyNameAr, currency: 'EGP', scale, sourceAsOf, fetchedAt: nowIso(),
    source: { provider: 'stockanalysis_sp_global_standardized', providerTier: 'SECONDARY_STANDARDIZED', overviewUrl: `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/financials/`, statisticsUrl: `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/statistics/`, officialDisclosureVerified: false, audited: null },
    classification: { sector: profile.sector, industry: profile.industry, template: classifyTemplate(profile.sector, profile.industry, companyNameAr) },
    latest: {
      revenue: round(revenue * scale, 2), grossProfit: round(grossProfit * scale, 2), operatingIncome: round(operatingIncome * scale, 2), netIncome: round(netIncome * scale, 2), eps: round(eps, 4),
      cashAndInvestments: round(cash * scale, 2), totalDebt: round(debt * scale, 2), netCashDebt: round(netCash * scale, 2), operatingCashFlow: round(operatingCashFlow * scale, 2), capitalExpenditures: round(capex * scale, 2), freeCashFlow: round(freeCashFlow * scale, 2),
      grossMarginPct: round(grossMargin, 2), operatingMarginPct: round(operatingMargin, 2), netMarginPct: round(profitMargin, 2), freeCashFlowMarginPct: round(fcfMargin, 2), peRatio: round(pe, 3), priceToFreeCashFlow: round(pfcf, 3), priceToSales: round(ps, 3), priceToBook: round(pb, 3), returnOnEquityPct: round(roe, 2), returnOnAssetsPct: round(roa, 2), currentRatio: round(currentRatio, 3), debtToEquity: round(debtEquity, 3), dividendYieldPct: round(dividendYield, 2), marketCap: round(marketCap, 2), enterpriseValue: round(enterpriseValue, 2), sharesOutstanding: round(sharesOutstanding, 2)
    },
    annual: { current: { revenue: round(revenueAnnual * scale, 2), netIncome: round(netIncomeAnnual * scale, 2) }, prior: { revenue: round(revenuePrior * scale, 2), netIncome: round(netIncomePrior * scale, 2) } },
    calculated: { revenueGrowthPct: growth(revenueAnnual, revenuePrior), netIncomeGrowthPct: growth(netIncomeAnnual, netIncomePrior), cashToDebt: safeRatio(cash, debt), operatingCashFlowToNetIncome: safeRatio(operatingCashFlow, netIncome), freeCashFlowToNetIncome: safeRatio(freeCashFlow, netIncome) }
  };
  const available = Object.values(data.latest).filter(value => value !== null).length;
  data.parseDiagnostics = { availableMetricCount: available, overviewTableCount: parseTables(overviewHtml).length, statisticsTableCount: parseTables(statisticsHtml || '').length, parseAccepted: available >= 8 && (data.latest.revenue !== null || data.latest.netIncome !== null) };
  if (!data.parseDiagnostics.parseAccepted) throw new Error(`INSUFFICIENT_PARSED_METRICS_${available}`);
  return data;
}
function mergeOfficialOverride(record, override) {
  if (!override || typeof override !== 'object') return record;
  const merged = JSON.parse(JSON.stringify(record));
  if (override.classification) merged.classification = { ...merged.classification, ...override.classification };
  if (override.latest) merged.latest = { ...merged.latest, ...override.latest };
  if (override.annual) merged.annual = { ...merged.annual, ...override.annual };
  if (override.calculated) merged.calculated = { ...merged.calculated, ...override.calculated };
  merged.source = { ...merged.source, officialDisclosureVerified: Boolean(override.officialDisclosureVerified), audited: override.audited === true, officialUrl: override.officialUrl || null, officialPublishedAt: override.officialPublishedAt || null, officialPeriodEnd: override.officialPeriodEnd || null, overrideNotes: override.notes || null };
  if (override.officialPeriodEnd) merged.sourceAsOf = override.officialPeriodEnd;
  return merged;
}
const recordAgeDays = record => { const time = Date.parse(record?.fetchedAt || ''); return Number.isFinite(time) ? (Date.now() - time) / 86400000 : Infinity; };
function chooseTickers(market, decision, cache) {
  const all = [...new Map((market.stocks || []).map(item => [String(item.ticker || '').toUpperCase(), item])).values()].filter(item => /^[A-Z0-9.\-]{2,12}$/.test(item.ticker));
  const recommended = new Set((decision.recommendations || []).map(item => String(item.ticker || '').toUpperCase()));
  const stale = all.filter(item => !cache.records[item.ticker] || recordAgeDays(cache.records[item.ticker]) >= MAX_AGE_DAYS);
  const sorted = [...stale].sort((a, b) => (recommended.has(b.ticker) ? 1 : 0) - (recommended.has(a.ticker) ? 1 : 0) || recordAgeDays(cache.records[b.ticker]) - recordAgeDays(cache.records[a.ticker]) || a.ticker.localeCompare(b.ticker));
  const result = [];
  for (const ticker of recommended) { const item = all.find(row => row.ticker === ticker); if (item && !result.some(row => row.ticker === ticker)) result.push(item); }
  for (const item of sorted) { if (result.length >= BATCH_SIZE + recommended.size) break; if (!result.some(row => row.ticker === item.ticker)) result.push(item); }
  return { all, selected: result };
}
async function collectOne(item) {
  const ticker = item.ticker, overviewUrl = `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/financials/`, statisticsUrl = `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}/statistics/`;
  const [overviewResult, statisticsResult] = await Promise.allSettled([fetchText(overviewUrl), fetchText(statisticsUrl)]);
  if (overviewResult.status !== 'fulfilled') throw overviewResult.reason;
  return parseFundamentalPages({ ticker, companyNameAr: item.companyNameAr || item.companyNameEn || ticker, overviewHtml: overviewResult.value, statisticsHtml: statisticsResult.status === 'fulfilled' ? statisticsResult.value : '' });
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length); let cursor = 0;
  async function next() { while (true) { const index = cursor++; if (index >= items.length) return; try { results[index] = { status: 'fulfilled', value: await worker(items[index]) }; } catch (error) { results[index] = { status: 'rejected', reason: error }; } await new Promise(resolve => setTimeout(resolve, 300)); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}
async function main() {
  const market = readJson(MARKET_INDEX, { stocks: [] }), decision = readJson(DECISION_PATH, { recommendations: [] });
  const old = readJson(RAW_PATH, { schemaVersion: '16.1.0', records: {}, failures: {} }), overridesDoc = readJson(OVERRIDES_PATH, { records: {} });
  old.records = old.records && typeof old.records === 'object' ? old.records : {}; old.failures = old.failures && typeof old.failures === 'object' ? old.failures : {};
  const { all, selected } = chooseTickers(market, decision, old), results = await mapLimit(selected, CONCURRENCY, collectOne);
  let success = 0; const failures = [];
  for (let index = 0; index < selected.length; index++) {
    const item = selected[index], result = results[index];
    if (result.status === 'fulfilled') { old.records[item.ticker] = mergeOfficialOverride(result.value, overridesDoc.records?.[item.ticker]); delete old.failures[item.ticker]; success++; }
    else { const message = String(result.reason?.message || result.reason || 'UNKNOWN_ERROR').slice(0, 240); old.failures[item.ticker] = { ticker: item.ticker, failedAt: nowIso(), message }; failures.push({ ticker: item.ticker, message }); }
  }
  for (const [ticker, override] of Object.entries(overridesDoc.records || {})) if (old.records[ticker]) old.records[ticker] = mergeOfficialOverride(old.records[ticker], override);
  const records = Object.values(old.records);
  const output = { schemaVersion: '16.1.0', generatedAt: nowIso(), provider: { name: 'stockanalysis_sp_global_standardized', tier: 'SECONDARY_STANDARDIZED', officialOverridesSupported: true, methodology: 'Public standardized financial pages, merged with explicit official disclosure overrides. No estimated line items are invented.' }, universeCount: all.length, attemptedThisRun: selected.length, succeededThisRun: success, failedThisRun: failures.length, coverageCount: records.length, coveragePct: all.length ? round(records.length / all.length * 100, 1) : 0, freshCount: records.filter(record => recordAgeDays(record) <= MAX_AGE_DAYS).length, officialVerifiedCount: records.filter(record => record.source?.officialDisclosureVerified).length, records: Object.fromEntries(records.map(record => [record.ticker, record])), failures: old.failures, runFailures: failures };
  writeJson(RAW_PATH, output);
  console.log(JSON.stringify({ universe: all.length, selected: selected.map(item => item.ticker), success, failures, coverage: output.coverageCount, coveragePct: output.coveragePct }, null, 2));
}
main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
