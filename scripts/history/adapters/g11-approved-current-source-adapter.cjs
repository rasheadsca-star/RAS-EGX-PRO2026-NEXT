'use strict';

const { safeTicker, toNumber } = require('../lib/utils.cjs');

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x2F;/gi, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[,%،\s]/g, '').replace(/−/g, '-');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? toNumber(match[0]) : null;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  let m = text.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = text.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})/i);
  if (m) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    return `${m[3]}-${String(months[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  }
  m = text.match(/(20\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
  if (m) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    return `${m[1]}-${String(months[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  }
  return null;
}

function findLabelNumber(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, 'i');
    const m = text.match(re);
    if (m) return parseNumber(m[1]);
  }
  return null;
}

function findSessionDate(text) {
  const anchors = [
    /(?:Last\s+update|Updated|Trading\s+date|Session\s+date|Date)\s*:?\s*([^|]{0,80})/ig,
    /(?:آخر\s+تحديث|تاريخ\s+الجلسة|تاريخ\s+التداول)\s*:?\s*([^|]{0,80})/ig,
  ];
  for (const re of anchors) {
    let m;
    while ((m = re.exec(text))) {
      const date = normalizeDate(m[1]);
      if (date) return { date, evidence: m[0].slice(0, 120) };
    }
  }
  const dates = text.match(/20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]20\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}/gi) || [];
  const unique = [...new Set(dates.map(normalizeDate).filter(Boolean))];
  return unique.length === 1 ? { date: unique[0], evidence: 'single_date_in_document' } : { date: null, evidence: unique.length ? `ambiguous_dates:${unique.join(',')}` : 'no_explicit_session_date' };
}

function validateCurrentRow(row, expectedSession) {
  const errors = [];
  if (!row || row.sessionDate !== expectedSession) errors.push(row?.sessionDate ? `session_mismatch:${row.sessionDate}` : 'session_missing');
  const { open, high, low, close, volume } = row || {};
  if (!(open > 0 && high > 0 && low > 0 && close > 0)) errors.push('non_positive_or_missing_ohlc');
  if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(open) && Number.isFinite(close)) {
    if (high < low || high < open || high < close || low > open || low > close) errors.push('ohlc_invariant_failed');
  }
  if (!Number.isFinite(volume) || volume < 0) errors.push('volume_missing_or_invalid');
  if (volume === 0 && open === high && high === low && low === close) errors.push('flat_zero_volume_non_trading_row');
  return { ok: errors.length === 0, errors };
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 RAS-EGX-PRO2026-G11-Approved-Source/1.0',
        Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, finalUrl: response.url, contentType: response.headers.get('content-type') || '', text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function rowFromPublicText(text, ticker, expectedSession, sourceId, sourceUrl) {
  const session = findSessionDate(text);
  const row = {
    ticker,
    sourceSymbol: ticker,
    sessionDate: session.date,
    open: findLabelNumber(text, ['Open Price','Open','Opening Price','سعر الفتح','الافتتاح']),
    high: findLabelNumber(text, ['High Price','High','Highest Price','أعلى','اعلى']),
    low: findLabelNumber(text, ['Low Price','Low','Lowest Price','أدنى','ادنى']),
    close: findLabelNumber(text, ['Last Price','Closing Price','Close','Last','آخر سعر','الإغلاق','الاغلاق']),
    volume: findLabelNumber(text, ['Volume','Trading Volume','حجم التداول','الكمية']),
    turnover: findLabelNumber(text, ['Turnover','Trading Value','Value Traded','قيمة التداول']),
    sourceId,
    sourceUrl,
    sourceTimestampEvidence: session.evidence,
    fetchedAt: new Date().toISOString(),
  };
  return { row, validation: validateCurrentRow(row, expectedSession) };
}

async function probeMubasherCurrent(ticker, expectedSession, options = {}) {
  const symbol = safeTicker(ticker);
  const urls = [
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`,
  ];
  const attempts = [];
  for (const url of urls) {
    try {
      const response = await fetchText(url, options.timeoutMs || 15000);
      const text = stripHtml(response.text);
      const exactRoute = new RegExp(`/stocks/${symbol}/?`, 'i').test(response.finalUrl || url);
      const parsed = rowFromPublicText(text, symbol, expectedSession, 'mubasher_public_stock_page', response.finalUrl || url);
      const identityVerified = response.ok && exactRoute && !/page\s+not\s+found|404|no\s+data/i.test(text.slice(0, 1200));
      const record = { sourceId:'mubasher_public_stock_pages', url, status:response.status, finalUrl:response.finalUrl, identityVerified, sessionDate:parsed.row.sessionDate, validation:parsed.validation, row:parsed.row };
      attempts.push(record);
      if (identityVerified && parsed.validation.ok) return { ok:true, sourceId:'mubasher_public_stock_pages', row:parsed.row, attempts };
    } catch (error) {
      attempts.push({ sourceId:'mubasher_public_stock_pages', url, error:String(error.message || error) });
    }
  }
  return { ok:false, sourceId:'mubasher_public_stock_pages', attempts };
}

async function probeEgxOfficialCurrent(ticker, expectedSession, options = {}) {
  const symbol = safeTicker(ticker);
  const urls = [
    `https://www.egx.com.eg/en/Stock_Trading.aspx?code=${encodeURIComponent(symbol)}`,
    `https://www.egx.com.eg/ar/Stock_Trading.aspx?code=${encodeURIComponent(symbol)}`,
  ];
  const attempts = [];
  for (const url of urls) {
    try {
      const response = await fetchText(url, options.timeoutMs || 15000);
      const text = stripHtml(response.text);
      const symbolEvidence = new RegExp(`(^|[^A-Z0-9])${symbol}([^A-Z0-9]|$)`, 'i').test(text);
      const parsed = rowFromPublicText(text, symbol, expectedSession, 'egx_official_public_page', response.finalUrl || url);
      const identityVerified = response.ok && symbolEvidence;
      const record = { sourceId:'egx_official_public_pages', url, status:response.status, finalUrl:response.finalUrl, identityVerified, sessionDate:parsed.row.sessionDate, validation:parsed.validation, row:parsed.row };
      attempts.push(record);
      if (identityVerified && parsed.validation.ok) return { ok:true, sourceId:'egx_official_public_pages', row:parsed.row, attempts };
    } catch (error) {
      attempts.push({ sourceId:'egx_official_public_pages', url, error:String(error.message || error) });
    }
  }
  return { ok:false, sourceId:'egx_official_public_pages', attempts };
}

function extractRowsFromJson(value, sourceId, sourceUrl, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5000)) extractRowsFromJson(item, sourceId, sourceUrl, out);
    return out;
  }
  const date = normalizeDate(value.date || value.sessionDate || value.session_date || value.tradingDate || value.datetime || '');
  const open = parseNumber(value.open ?? value.o);
  const high = parseNumber(value.high ?? value.h);
  const low = parseNumber(value.low ?? value.l);
  const close = parseNumber(value.close ?? value.c ?? value.last ?? value.price);
  const volume = parseNumber(value.volume ?? value.v);
  if (date && [open,high,low,close].every(Number.isFinite)) out.push({ ticker:null, sourceSymbol:value.symbol || value.ticker || value.code || null, sessionDate:date, open, high, low, close, volume, turnover:parseNumber(value.turnover ?? value.valueTraded ?? value.value), sourceId, sourceUrl, fetchedAt:new Date().toISOString() });
  for (const child of Object.values(value).slice(0, 1000)) extractRowsFromJson(child, sourceId, sourceUrl, out);
  return out;
}

async function probeLicensedCurrent(ticker, expectedSession, options = {}) {
  const template = String(options.urlTemplate || process.env.EGX_HISTORY_API_URL || '').trim();
  if (!template) return { ok:false, sourceId:'optional_licensed_eod_provider', unavailableReason:'EGX_HISTORY_API_URL_NOT_CONFIGURED', attempts:[] };
  const symbol = safeTicker(ticker);
  const url = template.replaceAll('{symbol}', encodeURIComponent(symbol)).replaceAll('{market}', 'EGX').replaceAll('{limit}', '250');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const headers = { Accept:'application/json', 'User-Agent':'RAS-EGX-PRO2026-G11-Licensed-EOD/1.0' };
    const key = options.apiKey || process.env.EGX_HISTORY_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(url, { headers, signal:controller.signal });
    const text = await response.text();
    if (!response.ok) return { ok:false, sourceId:'optional_licensed_eod_provider', attempts:[{ url, status:response.status }] };
    let json;
    try { json = JSON.parse(text); } catch { return { ok:false, sourceId:'optional_licensed_eod_provider', attempts:[{ url, status:response.status, error:'invalid_json' }] }; }
    const rows = extractRowsFromJson(json, 'optional_licensed_eod_provider', url).filter((row) => row.sessionDate === expectedSession);
    const exact = rows.find((row) => !row.sourceSymbol || safeTicker(row.sourceSymbol) === symbol);
    if (!exact) return { ok:false, sourceId:'optional_licensed_eod_provider', attempts:[{ url, status:response.status, currentRows:rows.length, error:'no_exact_expected_session_row' }] };
    exact.ticker = symbol;
    const validation = validateCurrentRow(exact, expectedSession);
    return validation.ok ? { ok:true, sourceId:'optional_licensed_eod_provider', row:exact, attempts:[{ url, status:response.status }] } : { ok:false, sourceId:'optional_licensed_eod_provider', attempts:[{ url, status:response.status, validation }] };
  } catch (error) {
    return { ok:false, sourceId:'optional_licensed_eod_provider', attempts:[{ url, error:String(error.message || error) }] };
  } finally { clearTimeout(timer); }
}

module.exports = {
  stripHtml,
  normalizeDate,
  validateCurrentRow,
  probeMubasherCurrent,
  probeEgxOfficialCurrent,
  probeLicensedCurrent,
};
