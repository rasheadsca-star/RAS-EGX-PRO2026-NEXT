#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchHistory } = require('../history/adapters/yahoo-history-adapter.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const MAX_STORED_SESSIONS = 100;
const MAX_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.V20_HISTORY_CONCURRENCY || 4)));
const NETWORK_REFRESH = String(process.env.V20_HISTORY_NETWORK_REFRESH || 'true').toLowerCase() !== 'false';
const CURRENT_PRICE_TOLERANCE_PCT = Number(process.env.V20_HISTORY_CURRENT_PRICE_TOLERANCE_PCT || 5);

function read(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits = 6) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }

const REJECTED_SOURCE_MARKERS = [
  'snapshot_ohlc_derived_from_public_market_data',
  'recovered_from_repository_snapshot_using_git_commit_date',
  'public_automated_historical_backfill',
  'derived',
  'synthetic',
  'inferred',
  'reconstructed',
];
const ACCEPTED_PRIMARY_SOURCES = new Set(['yahoo', 'starta_ohlc_api']);

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function normalizeSession(raw, ticker) {
  const date = String(raw?.date || '').slice(0, 10);
  const open = finite(raw?.open);
  const high = finite(raw?.high);
  const low = finite(raw?.low);
  const close = finite(raw?.close);
  const volume = raw?.volume === null || raw?.volume === undefined || raw?.volume === '' ? null : finite(raw.volume);
  const source = String(raw?.primarySource || '').trim().toLowerCase();
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings.map(String) : [];
  const sourceText = [source, raw?.validationStatus, ...warnings].filter(Boolean).join(' ').toLowerCase();
  const errors = [];
  if (!validDate(date)) errors.push('INVALID_DATE');
  if (!(open > 0 && high > 0 && low > 0 && close > 0)) errors.push('MISSING_OR_NON_POSITIVE_OHLC');
  if (high < Math.max(open || 0, close || 0) || low > Math.min(open || Infinity, close || Infinity) || high < low) errors.push('INVALID_OHLC_INVARIANT');
  if (volume !== null && !(volume >= 0)) errors.push('INVALID_VOLUME');
  if (!ACCEPTED_PRIMARY_SOURCES.has(source)) errors.push('UNAPPROVED_PRIMARY_SOURCE');
  if (REJECTED_SOURCE_MARKERS.some(marker => sourceText.includes(marker))) errors.push('SYNTHETIC_OR_DERIVED_PROVENANCE');
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    row: {
      ticker,
      date,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      adjustedClose: finite(raw?.adjustedClose) === null ? null : round(raw.adjustedClose),
      volume,
      primarySource: source,
      validationStatus: raw?.validationStatus || null,
      officialVerified: raw?.officialVerified === true,
      confidence: raw?.confidence || null,
      sourceUrl: raw?.sourceUrls?.primary || null,
      fetchedAt: raw?.fetchedAt || null,
      validatedAt: raw?.validatedAt || null,
      warnings,
    },
  };
}

function sanitizeSessions(rawSessions, ticker, asOfDate) {
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(rawSessions) ? rawSessions : []) {
    const normalized = normalizeSession(raw, ticker);
    if (!normalized.valid) {
      rejected.push({ date: raw?.date || null, errors: normalized.errors });
      continue;
    }
    if (normalized.row.date > asOfDate) {
      rejected.push({ date: normalized.row.date, errors: ['FUTURE_ROW_AFTER_AS_OF'] });
      continue;
    }
    accepted.push(normalized.row);
  }
  const byDate = new Map();
  for (const row of accepted) byDate.set(row.date, row);
  return {
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_STORED_SESSIONS),
    rejected,
  };
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}
function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = seed;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    seed = values[i] * k + seed * (1 - k);
    out[i] = seed;
  }
  return out;
}
function wilderRsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change; else losses += -change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
function wilderAtr(rows, period = 14) {
  if (rows.length < period) return null;
  const trs = rows.map((row, index) => {
    if (index === 0) return row.high - row.low;
    const prevClose = rows[index - 1].close;
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose));
  });
  let atr = trs.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < trs.length; i += 1) atr = ((atr * (period - 1)) + trs[i]) / period;
  return atr;
}
function momentum(values, period) {
  if (values.length < period + 1) return null;
  const base = values[values.length - 1 - period];
  const last = values[values.length - 1];
  return base > 0 ? ((last / base) - 1) * 100 : null;
}
function calculatePointInTime(rawRows, asOfDate) {
  const rows = rawRows.filter(row => row.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  const closes = rows.map(row => row.close);
  if (!rows.length) return { rowsUsed: 0, asOfSession: null, indicators: {} };
  const ema12 = emaSeries(closes, 12);
  const ema20 = emaSeries(closes, 20);
  const ema26 = emaSeries(closes, 26);
  const macdValues = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (ema12[i] !== null && ema26[i] !== null) macdValues.push(ema12[i] - ema26[i]);
  }
  const macdSignalSeries = emaSeries(macdValues, 9);
  const macd = macdValues.length ? macdValues[macdValues.length - 1] : null;
  const macdSignal = macdSignalSeries.length ? macdSignalSeries[macdSignalSeries.length - 1] : null;
  const lastClose = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const latestEma20 = ema20[ema20.length - 1];
  let trend = null;
  if (sma20 !== null && sma50 !== null) {
    if (lastClose > sma20 && sma20 > sma50) trend = 'BULLISH';
    else if (lastClose < sma20 && sma20 < sma50) trend = 'BEARISH';
    else trend = 'MIXED';
  }
  return {
    rowsUsed: rows.length,
    asOfSession: rows[rows.length - 1].date,
    indicators: {
      close: round(lastClose, 4),
      sma20: round(sma20, 4),
      sma50: round(sma50, 4),
      ema20: round(latestEma20, 4),
      ema12: round(ema12[ema12.length - 1], 4),
      ema26: round(ema26[ema26.length - 1], 4),
      rsi14: round(wilderRsi(closes, 14), 2),
      macd: round(macd, 4),
      macdSignal: round(macdSignal, 4),
      macdHistogram: macd !== null && macdSignal !== null ? round(macd - macdSignal, 4) : null,
      atr14: round(wilderAtr(rows, 14), 4),
      momentum5Pct: round(momentum(closes, 5), 2),
      momentum10Pct: round(momentum(closes, 10), 2),
      momentum20Pct: round(momentum(closes, 20), 2),
      trend,
    },
    readiness: {
      sma20: closes.length >= 20,
      sma50: closes.length >= 50,
      ema20: closes.length >= 20,
      rsi14: closes.length >= 15,
      macd: closes.length >= 26,
      macdSignal: macdValues.length >= 9,
      atr14: rows.length >= 14,
      momentum5: closes.length >= 6,
      momentum10: closes.length >= 11,
      momentum20: closes.length >= 21,
    },
  };
}

function loadSymbolMap() {
  const raw = read('data/symbol-map.json', []);
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  return new Map(entries.map(entry => [safeTicker(entry.ticker), entry]));
}
function cachedDocument(ticker) { return read(`data/history/${ticker}.json`, null); }
function marketReferenceMap(snapshot) {
  return new Map((snapshot?.rows || []).map(row => [safeTicker(row.ticker), { close: finite(row.price ?? row.close), row }]));
}
function priceDifferencePct(a, b) {
  return a > 0 && b > 0 ? Math.abs(a - b) / b * 100 : null;
}

async function resolveTicker(ticker, mapEntry, localReference, asOfDate) {
  const attempts = [];
  let sourceDocument = null;
  let sourceKind = null;
  if (NETWORK_REFRESH && mapEntry) {
    try {
      const fetched = await fetchHistory(mapEntry, {
        range: '1y', timeoutMs: 8000, maxAttempts: 2, backoffMs: 350,
        localReference: { close: localReference?.close || null },
      });
      sourceDocument = {
        ticker, symbolVerified: fetched.identity?.verified === true,
        symbolVerification: fetched.identity || null, primarySource: 'yahoo',
        sessions: fetched.sessions || [], warnings: fetched.identity?.warnings || [],
      };
      sourceKind = 'LIVE_YAHOO_REFRESH';
      attempts.push({ source: 'yahoo_live', ok: true, sessions: fetched.sessions?.length || 0 });
    } catch (error) {
      attempts.push({ source: 'yahoo_live', ok: false, error: error.message });
    }
  }
  if (!sourceDocument) {
    const cached = cachedDocument(ticker);
    if (cached) {
      sourceDocument = cached;
      sourceKind = 'CACHED_VERIFIED_HISTORY_DOCUMENT';
      attempts.push({ source: 'cached_history_document', ok: true, sessions: cached.sessions?.length || 0 });
    }
  }
  if (!sourceDocument) return { ticker, status: 'UNAVAILABLE', attempts, rows: [], rejected: [], reason: 'NO_ACCEPTABLE_HISTORY_DOCUMENT' };
  if (sourceDocument.symbolVerified !== true) return { ticker, status: 'REJECTED', attempts, rows: [], rejected: [], reason: 'SYMBOL_IDENTITY_NOT_VERIFIED' };
  const sanitized = sanitizeSessions(sourceDocument.sessions, ticker, asOfDate);
  if (!sanitized.rows.length) return { ticker, status: 'REJECTED', attempts, rows: [], rejected: sanitized.rejected, reason: 'NO_TRUSTED_OHLC_ROWS_AFTER_V20_FILTER' };
  const point = calculatePointInTime(sanitized.rows, asOfDate);
  const latest = sanitized.rows[sanitized.rows.length - 1];
  const localClose = localReference?.close || null;
  const reconciliationPct = priceDifferencePct(latest.close, localClose);
  const sessionAligned = latest.date === asOfDate;
  const priceReconciled = reconciliationPct !== null && reconciliationPct <= CURRENT_PRICE_TOLERANCE_PCT;
  const currentTechnicalReady = Boolean(sessionAligned && priceReconciled && point.readiness.macdSignal && point.readiness.sma50);
  return {
    ticker,
    status: currentTechnicalReady ? 'CURRENT_READY' : 'HISTORICAL_ONLY',
    sourceKind,
    source: sourceDocument.primarySource || latest.primarySource,
    symbolVerified: true,
    identityPolicy: sourceDocument.symbolVerification?.policy || null,
    firstSession: sanitized.rows[0].date,
    lastSession: latest.date,
    asOfDate,
    rowsAccepted: sanitized.rows.length,
    rowsRejected: sanitized.rejected.length,
    rejected: sanitized.rejected.slice(0, 20),
    rows: sanitized.rows,
    sessionAligned,
    latestTrustedClose: latest.close,
    currentMarketPrice: localClose,
    currentPriceDifferencePct: round(reconciliationPct, 4),
    currentPriceTolerancePct: CURRENT_PRICE_TOLERANCE_PCT,
    priceReconciled,
    historicalIndicatorReady: point.readiness.rsi14 && point.readiness.atr14 && point.readiness.sma20,
    currentTechnicalReady,
    usedForCurrentDecision: currentTechnicalReady,
    indicators: point.indicators,
    readiness: point.readiness,
    attempts,
    blockers: unique([
      !sessionAligned ? 'HISTORY_LAST_SESSION_NOT_ALIGNED_WITH_CURRENT_SESSION' : null,
      !priceReconciled ? 'LATEST_HISTORY_CLOSE_NOT_RECONCILED_WITH_CURRENT_MARKET_PRICE' : null,
      !point.readiness.sma50 ? 'INSUFFICIENT_ROWS_FOR_SMA50' : null,
      !point.readiness.macdSignal ? 'INSUFFICIENT_ROWS_FOR_MACD_SIGNAL' : null,
    ]),
  };
}

async function mapPool(items, worker, concurrency) {
  const results = Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function main() {
  const current = read('data/v20/current.json', {});
  const snapshot = read('data/v20/current-market-snapshot.json', {});
  const asOfDate = String(current.sessionDate || snapshot.sessionDate || '').slice(0, 10);
  if (!validDate(asOfDate)) throw new Error('V20 current sessionDate is missing or invalid');
  const symbolMap = loadSymbolMap();
  const references = marketReferenceMap(snapshot);
  const tickers = unique((current.opportunities || []).map(row => safeTicker(row.ticker))).filter(Boolean);
  const resolved = await mapPool(tickers, ticker => resolveTicker(ticker, symbolMap.get(ticker) || null, references.get(ticker), asOfDate), MAX_CONCURRENCY);

  const history = {
    schemaVersion: '20.0.0-technical-history-1', generatedAt: new Date().toISOString(),
    asOfSessionDate: asOfDate, decisionSupportOnly: true, networkRefreshAttempted: NETWORK_REFRESH,
    scope: 'V20_CURRENT_OPPORTUNITY_UNIVERSE',
    provenancePolicy: {
      approvedPrimarySources: [...ACCEPTED_PRIMARY_SOURCES], rejectedMarkers: REJECTED_SOURCE_MARKERS,
      missingOhlcMayBeSynthesized: false, futureRowsAllowed: false,
      currentReadinessRequiresSessionAlignment: true, currentReadinessRequiresPriceReconciliation: true,
      currentPriceTolerancePct: CURRENT_PRICE_TOLERANCE_PCT,
    },
    symbols: resolved,
  };
  const indicators = {
    schemaVersion: '20.0.0-technical-indicators-1', generatedAt: history.generatedAt,
    asOfSessionDate: asOfDate, decisionSupportOnly: true,
    indicatorMethodology: {
      sma: 'simple moving average of trusted close',
      ema: 'SMA seed then standard multiplier 2/(period+1)',
      rsi14: 'Wilder smoothing on trusted closes',
      atr14: 'Wilder smoothing of true range using trusted OHLC and previous close',
      macd: 'EMA12 - EMA26; signal EMA9 of available MACD sequence',
      momentum: 'percentage change versus trusted close N sessions ago',
      pointInTime: true, rowsAfterAsOfIgnored: true,
    },
    symbols: resolved.map(item => ({
      ticker: item.ticker, status: item.status, source: item.source || null, sourceKind: item.sourceKind || null,
      asOfSession: item.lastSession || null, rowsUsed: item.rowsAccepted || 0,
      historicalIndicatorReady: item.historicalIndicatorReady === true,
      currentTechnicalReady: item.currentTechnicalReady === true,
      usedForCurrentDecision: item.usedForCurrentDecision === true,
      sessionAligned: item.sessionAligned === true, priceReconciled: item.priceReconciled === true,
      currentPriceDifferencePct: item.currentPriceDifferencePct ?? null,
      indicators: item.indicators || {}, readiness: item.readiness || {}, blockers: item.blockers || [item.reason].filter(Boolean),
    })),
  };
  const status = {
    schemaVersion: '20.0.0-technical-history-status-1', generatedAt: history.generatedAt,
    asOfSessionDate: asOfDate, requestedSymbols: resolved.length,
    historicalIndicatorReadyCount: resolved.filter(item => item.historicalIndicatorReady).length,
    currentTechnicalReadyCount: resolved.filter(item => item.currentTechnicalReady).length,
    sessionAlignedCount: resolved.filter(item => item.sessionAligned).length,
    priceReconciledCount: resolved.filter(item => item.priceReconciled).length,
    unavailableCount: resolved.filter(item => item.status === 'UNAVAILABLE').length,
    rejectedCount: resolved.filter(item => item.status === 'REJECTED').length,
    currentTechnicalCoveragePct: resolved.length ? round(resolved.filter(item => item.currentTechnicalReady).length / resolved.length * 100, 2) : 0,
    historicalIndicatorCoveragePct: resolved.length ? round(resolved.filter(item => item.historicalIndicatorReady).length / resolved.length * 100, 2) : 0,
    currentTechnicalGate: resolved.length && resolved.every(item => item.currentTechnicalReady) ? 'FULL_CURRENT_COVERAGE' : 'PARTIAL_OR_STALE_RESEARCH_ONLY',
    note: 'Historical indicator availability never upgrades the authoritative V17 execution gate. Stale or price-unreconciled indicators are research context only.',
  };
  write('data/v20/technical-history.json', history);
  write('data/v20/technical-indicators.json', indicators);
  write('data/v20/technical-history-status.json', status);
  console.log(JSON.stringify(status, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });

module.exports = { calculatePointInTime, normalizeSession, sanitizeSessions, REJECTED_SOURCE_MARKERS, ACCEPTED_PRIMARY_SOURCES };
