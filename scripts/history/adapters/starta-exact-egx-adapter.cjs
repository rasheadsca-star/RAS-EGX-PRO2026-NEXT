'use strict';

const { readJson, round, safeTicker, sleep, toNumber, unique } = require('../lib/utils.cjs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

function configDefaults() {
  const config = readJson(path.join(ROOT, 'data', 'history-starta-gap-config.json'), {}) || {};
  return {
    apiBases: Array.isArray(config.apiBases) ? config.apiBases : [],
    requestTimeoutMs: Number(config.requestTimeoutMs || 25000),
    retryCount: Number(config.retryCount || 3),
    retryBaseDelayMs: Number(config.retryBaseDelayMs || 1000),
    sourceConfidence: Number(config.sourceConfidence || 75),
  };
}

async function fetchJson(url, options, diagnostics) {
  let lastError = null;
  for (let attempt = 1; attempt <= options.retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RAS-EGX-PRO2026-G11-Exact-Source/1.0',
        },
        signal: controller.signal,
      });
      const text = await response.text();
      diagnostics.push({ url, attempt, status: response.status, bytes: text.length });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      try { return JSON.parse(text); }
      catch { throw new Error('invalid_json_response'); }
    } catch (error) {
      lastError = error;
      if (attempt < options.retryCount) await sleep(options.retryBaseDelayMs * (2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${url}: ${lastError?.message || 'request_failed'}`);
}

async function fetchFromAnyBase(pathname, options, diagnostics) {
  const bases = unique([
    process.env.STARTA_API_BASE,
    ...(options.apiBases || []),
  ].filter(Boolean)).map((value) => String(value).replace(/\/$/, ''));
  const failures = [];
  for (const base of bases) {
    try {
      const data = await fetchJson(`${base}${pathname}`, options, diagnostics);
      return { data, base, sourceUrl: `${base}${pathname}` };
    } catch (error) {
      failures.push(error.message);
    }
  }
  const error = new Error(failures.join(' | ') || 'no_starta_api_base_configured');
  error.failures = failures;
  throw error;
}

async function fetchBestOhlcFromAllBases(pathname, ticker, options, diagnostics) {
  const bases = unique([
    process.env.STARTA_API_BASE,
    ...(options.apiBases || []),
  ].filter(Boolean)).map((value) => String(value).replace(/\/$/, ''));
  const failures = [];
  const candidates = [];
  for (const base of bases) {
    const sourceUrl = `${base}${pathname}`;
    try {
      const data = await fetchJson(sourceUrl, options, diagnostics);
      const normalized = normalizeOhlcRows(data, ticker, sourceUrl, options.sourceConfidence);
      if (!normalized.rows.length) throw new Error('no_validation_approved_rows');
      candidates.push({
        ...normalized,
        base,
        sourceUrl,
        latestSession: normalized.rows.at(-1)?.date || null,
      });
    } catch (error) {
      failures.push(`${base}:${error.message}`);
    }
  }
  if (!candidates.length) {
    const error = new Error(failures.join(' | ') || 'no_validation_approved_rows_on_any_starta_base');
    error.failures = failures;
    throw error;
  }
  candidates.sort((a, b) => {
    const byLatest = String(b.latestSession || '').localeCompare(String(a.latestSession || ''));
    if (byLatest) return byLatest;
    return b.rows.length - a.rows.length;
  });
  return {
    ...candidates[0],
    alternatives: candidates.slice(1).map((x) => ({
      sourceUrl:x.sourceUrl,
      latestSession:x.latestSession,
      validRows:x.rows.length,
    })),
    failures,
  };
}

function normalizeIdentity(raw) {
  return {
    symbol: safeTicker(raw?.symbol || raw?.ticker || raw?.code),
    marketCode: String(raw?.market_code || raw?.marketCode || raw?.exchange || '').trim().toUpperCase(),
    isin: String(raw?.isin || raw?.ISIN || '').trim().toUpperCase() || null,
    active: typeof raw?.active === 'boolean' ? raw.active : null,
    status: String(raw?.listing_status || raw?.listingStatus || raw?.status || '').trim().toUpperCase() || null,
    nameEn: raw?.name_en || raw?.nameEn || raw?.company_name_en || raw?.name || null,
    nameAr: raw?.name_ar || raw?.nameAr || raw?.company_name_ar || null,
    currency: String(raw?.currency || '').trim().toUpperCase() || null,
  };
}

function verifyExactIdentity(raw, ticker, mapEntry = {}) {
  const identity = normalizeIdentity(raw);
  const canonicalTicker = safeTicker(ticker);
  const canonicalIsin = String(mapEntry.isin || '').trim().toUpperCase() || null;
  const exactSymbol = identity.symbol === canonicalTicker;
  const egxScoped = !identity.marketCode || identity.marketCode === 'EGX';
  const isinConflict = Boolean(canonicalIsin && identity.isin && canonicalIsin !== identity.isin);
  const verified = exactSymbol && egxScoped && !isinConflict;
  return {
    verified,
    resolutionType: verified ? 'RESOLVED_EXACT_SOURCE_ID' : (isinConflict ? 'AMBIGUOUS_BLOCKED' : 'SOURCE_RECORD_INVALID'),
    canonicalTicker,
    sourceIdentifier: identity.symbol || null,
    endpointScope: 'EGX',
    exactSymbol,
    egxScoped,
    canonicalIsin,
    sourceIsin: identity.isin,
    exactIsin: Boolean(canonicalIsin && identity.isin && canonicalIsin === identity.isin),
    isinConflict,
    sourceActive: identity.active,
    sourceListingStatus: identity.status,
    sourceCurrency: identity.currency,
    companyNameDiagnosticOnly: { nameEn: identity.nameEn, nameAr: identity.nameAr },
    nameMatchingUsedForResolution: false,
  };
}

function normalizeOhlcRows(rawRows, ticker, sourceUrl, confidence) {
  if (!Array.isArray(rawRows)) throw new Error('ohlc_response_not_array');
  const rows = [];
  const rejected = [];
  for (const raw of rawRows) {
    const date = String(raw?.date || raw?.session_date || raw?.sessionDate || '').slice(0, 10);
    const open = toNumber(raw?.open);
    const high = toNumber(raw?.high);
    const low = toNumber(raw?.low);
    const close = toNumber(raw?.close);
    const volume = raw?.volume === null || raw?.volume === undefined || raw?.volume === '' ? null : toNumber(raw.volume);
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('invalid_date');
    if (!(open > 0 && high > 0 && low > 0 && close > 0)) errors.push('non_positive_ohlc');
    if (high < low || high < open || high < close || low > open || low > close) errors.push('invalid_ohlc_invariant');
    if (volume === null) errors.push('volume_missing');
    else if (volume < 0) errors.push('negative_volume');
    if (volume === 0 && open === high && high === low && low === close) errors.push('flat_zero_volume_non_trading_row');
    if (errors.length) {
      rejected.push({ ticker, date: date || null, errors });
      continue;
    }
    rows.push({
      ticker,
      date,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      adjustedClose: null,
      volume,
      currency: 'EGP',
      primarySource: 'starta_ohlc_api',
      officialVerified: false,
      verifiedBy: ['starta_egx_exact_symbol'],
      sourceUrls: { primary: sourceUrl, verification: [] },
      fetchedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
      confidence: { overall: confidence, ohlc: confidence, volume: confidence, symbolIdentity: 100 },
      validationStatus: 'starta_exact_egx_source_validated',
      warnings: ['non_official_fallback_source', 'exact_symbol_egx_scoped_source', 'name_not_used_for_identity_resolution'],
    });
  }
  const byDate = new Map();
  for (const row of rows) byDate.set(row.date, row);
  return { rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), rejected };
}

async function fetchExactEgxHistory(mapEntry, options = {}) {
  const cfg = { ...configDefaults(), ...options };
  const ticker = safeTicker(mapEntry?.ticker);
  if (!ticker) throw new Error('missing_canonical_ticker');
  const diagnostics = [];
  const identityResponse = await fetchFromAnyBase(`/egx/stock/${encodeURIComponent(ticker)}`, cfg, diagnostics);
  const identity = verifyExactIdentity(identityResponse.data, ticker, mapEntry);
  if (!identity.verified) {
    const error = new Error(`starta_exact_identity_rejected:${identity.resolutionType}`);
    error.identity = identity;
    error.diagnostics = diagnostics;
    throw error;
  }

  const periods = Array.isArray(options.periodCandidates) && options.periodCandidates.length
    ? options.periodCandidates
    : ['5y', '3y', '2y', '1y'];
  const limit = Number(options.maximumRowsPerRequest || 2000);
  const historyIdentifiers = unique([
    ticker,
    mapEntry?.startaIdentifier,
    mapEntry?.isin,
  ].filter(Boolean).map((value) => String(value).trim().toUpperCase()));
  let best = null;
  const failures = [];
  for (const period of periods) {
    for (const historyIdentifier of historyIdentifiers) {
      try {
        const result = await fetchBestOhlcFromAllBases(`/egx/ohlc/${encodeURIComponent(historyIdentifier)}?period=${encodeURIComponent(period)}&limit=${limit}`, ticker, cfg, diagnostics);
        const normalized = { rows:result.rows, rejected:result.rejected };
        const candidate = {
          ...normalized,
          period,
          requestedHistoryIdentifier:historyIdentifier,
          sourceUrl:result.sourceUrl,
          latestSession:result.latestSession,
          baseAlternatives:result.alternatives,
        };
        if (!best || String(candidate.latestSession || '').localeCompare(String(best.latestSession || '')) > 0 || (candidate.latestSession === best.latestSession && candidate.rows.length > best.rows.length)) best = candidate;
      } catch (error) {
        failures.push(`${period}:${historyIdentifier}:${error.message}`);
      }
    }
  }
  if (!best) {
    const error = new Error(`starta_exact_ohlc_failed:${failures.join(' | ')}`);
    error.identity = identity;
    error.diagnostics = diagnostics;
    throw error;
  }
  return {
    ticker,
    requestedSymbol: ticker,
    primarySource: 'starta_ohlc_api',
    identity,
    sessions: best.rows,
    rejected: best.rejected,
    sourceUrl: best.sourceUrl,
    period: best.period,
    requestedHistoryIdentifier: best.requestedHistoryIdentifier || ticker,
    diagnostics,
    candidateFailures: failures,
  };
}

async function diagnoseExactEgxHistory(mapEntry, options = {}) {
  const cfg = { ...configDefaults(), ...options };
  const ticker = safeTicker(mapEntry?.ticker);
  if (!ticker) throw new Error('missing_canonical_ticker');
  const diagnostics = [];
  let identity = null;
  try {
    const identityResponse = await fetchFromAnyBase(`/egx/stock/${encodeURIComponent(ticker)}`, cfg, diagnostics);
    identity = verifyExactIdentity(identityResponse.data, ticker, mapEntry);
  } catch (error) {
    return { ticker, identity: null, identityError: error.message, diagnostics, periods: [] };
  }
  if (!identity.verified) return { ticker, identity, identityError: `identity_rejected:${identity.resolutionType}`, diagnostics, periods: [] };

  const periods = Array.isArray(options.periodCandidates) && options.periodCandidates.length
    ? options.periodCandidates : ['5y', '3y', '2y', '1y'];
  const limit = Number(options.maximumRowsPerRequest || 2000);
  const periodDiagnostics = [];
  for (const period of periods) {
    try {
      const result = await fetchFromAnyBase(`/egx/ohlc/${encodeURIComponent(ticker)}?period=${encodeURIComponent(period)}&limit=${limit}`, cfg, diagnostics);
      const rawRows = Array.isArray(result.data) ? result.data : [];
      const normalized = normalizeOhlcRows(result.data, ticker, result.sourceUrl, cfg.sourceConfidence);
      const rejectionReasons = {};
      for (const item of normalized.rejected) for (const reason of item.errors || []) rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
      periodDiagnostics.push({
        period,
        sourceUrl: result.sourceUrl,
        rawRowCount: rawRows.length,
        validRowCount: normalized.rows.length,
        rejectedRowCount: normalized.rejected.length,
        latestValidSession: normalized.rows.at(-1)?.date || null,
        rejectionReasons,
        rejectedSamples: normalized.rejected.slice(0, 8),
        rawSamples: rawRows.slice(0, 3).map((row) => ({
          date: row?.date ?? row?.session_date ?? row?.sessionDate ?? null,
          open: row?.open ?? null,
          high: row?.high ?? null,
          low: row?.low ?? null,
          close: row?.close ?? null,
          volume: row?.volume ?? null,
        })),
      });
    } catch (error) {
      periodDiagnostics.push({ period, error: error.message });
    }
  }
  return { ticker, identity, identityError: null, diagnostics, periods: periodDiagnostics };
}

module.exports = { fetchExactEgxHistory, diagnoseExactEgxHistory, verifyExactIdentity, normalizeOhlcRows };
