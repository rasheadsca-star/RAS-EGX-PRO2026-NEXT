#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const LEGACY_RAW = P('data/fundamentals/v16-fundamental-raw.json');
const OFFICIAL = P('data/fundamentals/v16-official-overrides.json');
const CACHE = P('data/stable/v16-main-app-financial-cache.json');
const TIMEOUT_MS = Math.max(5000, Math.min(Number(process.env.EGX_MAIN_APP_FINANCIAL_TIMEOUT_MS || 12000), 30000));
const USER_AGENT = process.env.EGX_MAIN_APP_FINANCIAL_USER_AGENT || 'EGX-Pro-MAIN-APP-Financial-Audit/16.9.2';

function readJsonFile(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function n(value) { const x = Number(value); return Number.isFinite(x) ? x : null; }
function dateOnly(value) { return (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null; }
function time(value) { const x = Date.parse(value || ''); return Number.isFinite(x) ? x : null; }
function cairoDateNow() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function beforeOrAt(value, cutoff) {
  const a = time(value), b = time(cutoff);
  return a !== null && b !== null && a <= b;
}
function sourcePeriodEligible(sourceAsOf, sessionDate) {
  const d = dateOnly(sourceAsOf);
  return !d || !sessionDate || d <= sessionDate;
}
function financialMetricCount(values) {
  const fields = ['marketCap','pe','priceToBook','eps','revenue','netIncome','freeCashFlow','totalDebt','cashAndInvestments'];
  return fields.filter(key => Number.isFinite(n(values?.[key]))).length;
}
function normalizeLegacyRecord(record, decisionGeneratedAt, sessionDate, sourceName = 'StockAnalysis / S&P standardized cache') {
  if (!record || record?.parseDiagnostics?.parseAccepted !== true) return null;
  if (!sourcePeriodEligible(record.sourceAsOf, sessionDate)) return null;
  const capturedAt = record.fetchedAt || null;
  if (!beforeOrAt(capturedAt, decisionGeneratedAt)) return null;
  const latest = record.latest || {};
  const values = {
    marketCap: n(latest.marketCap),
    pe: n(latest.peRatio),
    forwardPE: null,
    eps: n(latest.eps),
    bookValue: null,
    priceToBook: n(latest.priceToBook),
    dividendYield: n(latest.dividendYieldPct),
    week52High: null,
    week52Low: null,
    currency: record.currency || 'EGP',
    revenue: n(latest.revenue),
    netIncome: n(latest.netIncome),
    freeCashFlow: n(latest.freeCashFlow),
    totalDebt: n(latest.totalDebt),
    cashAndInvestments: n(latest.cashAndInvestments),
    returnOnEquityPct: n(latest.returnOnEquityPct),
    currentRatio: n(latest.currentRatio),
    debtToEquity: n(latest.debtToEquity),
  };
  if (financialMetricCount(values) < 3) return null;
  return {
    status: 'SUCCESS',
    auditEligibleAtIssue: true,
    source: sourceName,
    sourceTier: record?.source?.providerTier || 'SECONDARY_STANDARDIZED',
    sourceAsOf: record.sourceAsOf || null,
    fetchedAt: capturedAt,
    capturedBeforeDecision: true,
    provider: record?.source?.provider || 'stockanalysis_sp_global_standardized',
    sourceUrls: {
      income: record?.source?.incomeUrl || null,
      balance: record?.source?.balanceSheetUrl || null,
      cashFlow: record?.source?.cashFlowUrl || null,
      statistics: record?.source?.statisticsUrl || null,
    },
    officialDisclosureVerified: record?.source?.officialDisclosureVerified === true,
    audited: record?.source?.audited ?? null,
    values,
    provenance: 'PERSISTED_PRE_DECISION_FINANCIAL_RECORD',
  };
}
function normalizeOfficialRecord(record, decisionGeneratedAt, sessionDate) {
  if (!record || record.officialDisclosureVerified !== true) return null;
  if (!sourcePeriodEligible(record.officialPeriodEnd, sessionDate)) return null;
  if (!beforeOrAt(record.officialPublishedAt, decisionGeneratedAt)) return null;
  const latest = record.latest || {};
  const values = {
    marketCap: n(latest.marketCap), pe: n(latest.peRatio ?? latest.pe), forwardPE: n(latest.forwardPE), eps: n(latest.eps),
    bookValue: n(latest.bookValue), priceToBook: n(latest.priceToBook), dividendYield: n(latest.dividendYieldPct ?? latest.dividendYield),
    week52High: null, week52Low: null, currency: record.currency || 'EGP', revenue: n(latest.revenue), netIncome: n(latest.netIncome),
    freeCashFlow: n(latest.freeCashFlow), totalDebt: n(latest.totalDebt), cashAndInvestments: n(latest.cashAndInvestments),
    returnOnEquityPct: n(latest.returnOnEquityPct), currentRatio: n(latest.currentRatio), debtToEquity: n(latest.debtToEquity),
  };
  if (financialMetricCount(values) < 2) return null;
  return {
    status: 'SUCCESS', auditEligibleAtIssue: true, source: 'Official disclosure', sourceTier: 'OFFICIAL', sourceAsOf: record.officialPeriodEnd || null,
    fetchedAt: record.officialPublishedAt || null, capturedBeforeDecision: true, provider: record.sourceType || 'OFFICIAL_DISCLOSURE',
    sourceUrls: { official: record.officialUrl || null }, officialDisclosureVerified: true, audited: record.audited === true, values,
    provenance: 'OFFICIAL_DISCLOSURE_AVAILABLE_BEFORE_DECISION',
  };
}
function decodeHtml(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&minus;|&#x2212;/gi,'-').replace(/\s+/g,' ').trim();
}
function normalizeLabel(value) { return decodeHtml(value).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function baseNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-' || value === '—' || /^n\/?a$/i.test(String(value).trim())) return null;
  const raw = String(value).trim(); const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/,/g,'').replace(/%/g,'').replace(/[()]/g,'').replace(/[KMBT]$/i,'').trim();
  const parsed = Number(cleaned) * (negative ? -1 : 1); return Number.isFinite(parsed) ? parsed : null;
}
function suffixMultiplier(value) {
  const suffix = String(value || '').trim().match(/([KMBT])\s*%?$/i)?.[1]?.toUpperCase();
  return suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1;
}
function rowsFromHtml(html) {
  const rows = new Map();
  for (const rowMatch of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(m => decodeHtml(m[1]));
    if (cells.length < 2) continue;
    const key = normalizeLabel(cells[0]); if (!key) continue;
    const numeric = cells.slice(1).map(v => baseNumber(v));
    const count = numeric.filter(Number.isFinite).length; if (!count) continue;
    if (!rows.has(key) || count > rows.get(key).count) rows.set(key, { raw: cells.slice(1), numeric, count, label: cells[0] });
  }
  return rows;
}
function exactRow(rows, labels) { for (const label of labels) { const row = rows.get(normalizeLabel(label)); if (row) return row; } return null; }
function cell(row, monetary = false) {
  const v = n(row?.numeric?.[0]); if (v === null) return null;
  return monetary ? v * suffixMultiplier(row?.raw?.[0]) : v * suffixMultiplier(row?.raw?.[0]);
}
async function fetchText(url) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language':'en-US,en;q=0.9', 'cache-control':'no-cache' } });
    if (!r.ok) throw new Error(`HTTP_${r.status}`); return await r.text();
  } finally { clearTimeout(timer); }
}
async function fetchJson(url) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { const r = await fetch(url,{signal:controller.signal,headers:{'user-agent':USER_AGENT,accept:'application/json'}}); if(!r.ok)throw new Error(`HTTP_${r.status}`); return await r.json(); }
  finally { clearTimeout(timer); }
}
async function liveStockAnalysis(ticker) {
  const base = `https://stockanalysis.com/quote/egx/${encodeURIComponent(ticker)}`;
  const urls = { statistics:`${base}/statistics/`, financials:`${base}/financials/` };
  const [statistics, financials] = await Promise.all([fetchText(urls.statistics), fetchText(urls.financials)]);
  const s = rowsFromHtml(statistics), f = rowsFromHtml(financials);
  const row = (rows,...labels) => exactRow(rows, labels);
  const values = {
    marketCap: cell(row(s,'Market Cap'),true), pe: cell(row(s,'PE Ratio','P E Ratio','P/E Ratio')), forwardPE: cell(row(s,'Forward PE','Forward P E Ratio')),
    eps: cell(row(f,'Earnings Per Share','EPS')), bookValue: null, priceToBook: cell(row(s,'PB Ratio','P B Ratio','Price to Book')),
    dividendYield: cell(row(s,'Dividend Yield')), week52High: cell(row(s,'52-Week High','52 Week High')), week52Low: cell(row(s,'52-Week Low','52 Week Low')),
    currency:'EGP', revenue: cell(row(f,'Revenue'),true), netIncome: cell(row(f,'Net Income','Net Income to Common'),true), freeCashFlow:null,
    totalDebt:null, cashAndInvestments:null, returnOnEquityPct:cell(row(s,'Return on Equity','ROE')), currentRatio:cell(row(s,'Current Ratio')), debtToEquity:cell(row(s,'Debt to Equity','Debt / Equity')),
  };
  if (financialMetricCount(values) < 3) throw new Error(`INSUFFICIENT_FINANCIAL_METRICS_${financialMetricCount(values)}`);
  return { provider:'stockanalysis_sp_global_standardized_live', source:'StockAnalysis / S&P standardized live', sourceTier:'SECONDARY_STANDARDIZED', sourceUrls:urls, values };
}
async function liveYahoo(yahoo) {
  const urls=[`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahoo)}`,`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahoo)}`];
  const errors=[];
  for (const url of urls) {
    try {
      const q=await fetchJson(url), x=q?.quoteResponse?.result?.[0]; if(!x)throw new Error('NO_RESULT');
      const values={marketCap:n(x.marketCap),pe:n(x.trailingPE),forwardPE:n(x.forwardPE),eps:n(x.epsTrailingTwelveMonths),bookValue:n(x.bookValue),priceToBook:n(x.priceToBook),dividendYield:n(x.trailingAnnualDividendYield),week52High:n(x.fiftyTwoWeekHigh),week52Low:n(x.fiftyTwoWeekLow),currency:x.currency||null};
      if(financialMetricCount(values)<2)throw new Error('INSUFFICIENT_YAHOO_METRICS');
      return{provider:'yahoo_finance_quote',source:'Yahoo Finance quote',sourceTier:'SECONDARY_MARKET_DATA',sourceUrls:{quote:url},values};
    } catch(e){errors.push(String(e?.message||e));}
  }
  throw new Error(`YAHOO_FAILED_${errors.join('|')}`);
}
function cacheState() {
  const state = readJsonFile(CACHE,{schemaVersion:'16.9.2-main-app-financial-cache-v1',updatedAt:null,records:{},failures:{}});
  if(!state.records||typeof state.records!=='object')state.records={}; if(!state.failures||typeof state.failures!=='object')state.failures={}; return state;
}
async function resolveFinancialBatch(items, sessionDate, decisionGeneratedAt) {
  const official = readJsonFile(OFFICIAL,{records:{}}).records || {};
  const legacy = readJsonFile(LEGACY_RAW,{records:{}}).records || {};
  const state = cacheState();
  const currentSession = sessionDate === cairoDateNow();
  const results = {};
  for (const item of items) {
    const ticker=String(item?.ticker||'').toUpperCase(), yahoo=item?.yahooSymbol||`${ticker}.CA`;
    let resolved = normalizeOfficialRecord(official[ticker],decisionGeneratedAt,sessionDate)
      || normalizeLegacyRecord(state.records[ticker],decisionGeneratedAt,sessionDate,'MAIN APP persisted financial cache')
      || normalizeLegacyRecord(legacy[ticker],decisionGeneratedAt,sessionDate);
    if (resolved) { results[ticker]=resolved; continue; }
    const attempts=[];
    if (currentSession) {
      for (const provider of ['stockanalysis','yahoo']) {
        try {
          const live = provider==='stockanalysis' ? await liveStockAnalysis(ticker) : await liveYahoo(yahoo);
          const capturedAt=new Date().toISOString();
          const cacheRecord={ticker,sourceAsOf:sessionDate,fetchedAt:capturedAt,currency:live.values.currency||'EGP',source:{provider:live.provider,providerTier:live.sourceTier,statisticsUrl:live.sourceUrls?.statistics||live.sourceUrls?.quote||null,incomeUrl:live.sourceUrls?.financials||null,officialDisclosureVerified:false,audited:null},latest:{marketCap:live.values.marketCap,peRatio:live.values.pe,eps:live.values.eps,priceToBook:live.values.priceToBook,dividendYieldPct:live.values.dividendYield,revenue:live.values.revenue,netIncome:live.values.netIncome,freeCashFlow:live.values.freeCashFlow,totalDebt:live.values.totalDebt,cashAndInvestments:live.values.cashAndInvestments,returnOnEquityPct:live.values.returnOnEquityPct,currentRatio:live.values.currentRatio,debtToEquity:live.values.debtToEquity},parseDiagnostics:{parserVersion:'MAIN_APP_TARGETED_FINANCIAL_RESOLVER_1.0',parseAccepted:true,availableMetricCount:financialMetricCount(live.values),anomalies:[]}};
          state.records[ticker]=cacheRecord; delete state.failures[ticker];
          results[ticker]={status:'POST_PUBLICATION_ONLY',auditEligibleAtIssue:false,source:live.source,sourceTier:live.sourceTier,sourceAsOf:sessionDate,fetchedAt:capturedAt,capturedBeforeDecision:false,provider:live.provider,sourceUrls:live.sourceUrls,officialDisclosureVerified:false,audited:null,values:live.values,provenance:'CAPTURED_AFTER_DECISION_FOR_FUTURE_SESSIONS',note:'Stored now, but deliberately excluded from this session audit because it was captured after the recommendation timestamp.'};
          break;
        } catch(e){attempts.push(`${provider}:${String(e?.message||e)}`);}
      }
    }
    if (!results[ticker]) {
      const failure={ticker,attemptedAt:new Date().toISOString(),sessionDate,decisionGeneratedAt,currentSession,attempts}; state.failures[ticker]=failure;
      results[ticker]={status:'UNAVAILABLE',auditEligibleAtIssue:false,source:'Financial multi-source resolver',fetchedAt:failure.attemptedAt,errors:attempts,provenance:'NO_ELIGIBLE_PRE_DECISION_FINANCIAL_RECORD'};
    }
  }
  state.schemaVersion='16.9.2-main-app-financial-cache-v1'; state.updatedAt=new Date().toISOString(); state.policy={purpose:'Audit evidence cache only',changesAlphaOrRanking:false,changesExecutionGrant:false,noRetroactiveLookahead:true};
  writeAtomic(CACHE,state);
  return results;
}

module.exports={resolveFinancialBatch,cairoDateNow};
