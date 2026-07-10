#!/usr/bin/env node
'use strict';

const { sleep, safeTicker, toNumber, round, unique } = require('../lib/utils.cjs');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

const STOP = new Set([
  'the','and','for','of','company','co','sae','s','a','e','egypt','egyptian','bank','holding',
  'شركة','المصرية','مصر','للاستثمار','والخدمات','بنك','شركه'
]);

function tokens(value) {
  return new Set(normalizeText(value).split(/\s+/).filter((item) => item.length > 1 && !STOP.has(item)));
}

function nameSimilarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / Math.max(1, Math.min(left.size, right.size));
}

async function fetchJson(url, config, diagnostics) {
  const timeoutMs = Number(config.requestTimeoutMs || 25000);
  const retryCount = Number(config.retryCount || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RAS-EGX-PRO2026-V12.9-Historical-Gap/1.0 (+public-data-validation)',
        },
        signal: controller.signal,
      });
      const text = await response.text();
      diagnostics.push({ url, attempt, status: response.status, bytes: text.length });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error('invalid_json_response'); }
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) await sleep(Number(config.retryBaseDelayMs || 1200) * (2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${url}: ${lastError?.message || 'request_failed'}`);
}

async function fetchFromAnyBase(pathname, config, diagnostics) {
  const bases = unique([
    process.env.STARTA_API_BASE,
    ...(Array.isArray(config.apiBases) ? config.apiBases : []),
  ]).map((value) => String(value).replace(/\/$/, ''));
  const errors = [];
  for (const base of bases) {
    try {
      return { data: await fetchJson(`${base}${pathname}`, config, diagnostics), base };
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(' | '));
}

function normalizeIdentity(raw) {
  return {
    symbol: safeTicker(raw?.symbol),
    marketCode: String(raw?.market_code || raw?.marketCode || '').toUpperCase(),
    nameEn: raw?.name_en || raw?.nameEn || raw?.company_name_en || raw?.name || null,
    nameAr: raw?.name_ar || raw?.nameAr || raw?.company_name_ar || null,
    lastPrice: toNumber(raw?.last_price ?? raw?.lastPrice ?? raw?.close),
    raw,
  };
}

function verifyIdentity(raw, ticker, mapEntry, target, config) {
  const identity = normalizeIdentity(raw);
  const expectedName = target.companyNameEn || mapEntry?.companyNameEn || '';
  const similarity = Math.max(
    nameSimilarity(identity.nameEn, expectedName),
    nameSimilarity(identity.nameAr, mapEntry?.companyNameAr || ''),
  );
  const exactSymbol = identity.symbol === ticker;
  const egxMarket = !identity.marketCode || identity.marketCode === 'EGX';
  const minimum = Number(config.minimumIdentityNameSimilarity || 0.34);
  const nameAccepted = similarity >= minimum || (!identity.nameEn && !identity.nameAr);
  const verified = exactSymbol && egxMarket && nameAccepted;
  return {
    verified,
    exactSymbol,
    egxMarket,
    nameAccepted,
    nameSimilarity: round(similarity, 4),
    identity,
    warnings: unique([
      !exactSymbol ? `identity_symbol_mismatch:${identity.symbol || 'missing'}` : null,
      !egxMarket ? `identity_market_mismatch:${identity.marketCode || 'missing'}` : null,
      !nameAccepted ? `identity_name_similarity_low:${round(similarity, 4)}` : null,
      (!identity.marketCode ? 'identity_market_code_missing_but_endpoint_is_egx_scoped' : null),
    ]),
  };
}

function normalizeOhlcRows(rows, ticker, sourceUrl, confidence) {
  if (!Array.isArray(rows)) throw new Error('ohlc_response_not_array');
  const normalized = [];
  const rejected = [];
  for (const raw of rows) {
    const date = String(raw?.date || raw?.session_date || '').slice(0, 10);
    const open = toNumber(raw?.open);
    const high = toNumber(raw?.high);
    const low = toNumber(raw?.low);
    const close = toNumber(raw?.close);
    const volume = raw?.volume === null || raw?.volume === undefined || raw?.volume === '' ? null : toNumber(raw.volume);
    const flatZero = volume === 0 && open > 0 && open === high && high === low && low === close;
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('invalid_date');
    if (!(open > 0 && high > 0 && low > 0 && close > 0)) errors.push('non_positive_ohlc');
    if (high < low || high < open || high < close || low > open || low > close) errors.push('invalid_ohlc_invariant');
    if (volume !== null && volume < 0) errors.push('negative_volume');
    if (flatZero) errors.push('flat_zero_volume_non_trading_row');
    if (errors.length) {
      rejected.push({ ticker, date: date || null, errors, row: raw });
      continue;
    }
    normalized.push({
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
      verifiedBy: ['starta_egx_database_identity'],
      sourceUrls: { primary: sourceUrl, verification: [] },
      fetchedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
      confidence: {
        overall: confidence,
        ohlc: confidence,
        volume: volume === null ? 60 : confidence,
        symbolIdentity: 90,
      },
      validationStatus: 'public_egx_database_exact_symbol_validated',
      warnings: unique([
        'non_official_fallback_source',
        'starta_ohlc_database_uses_mixed_history_reservoir',
        'not_independently_verified_by_egx',
        volume === null ? 'volume_missing' : null,
      ]),
    });
  }
  const byDate = new Map();
  for (const row of normalized) byDate.set(row.date, row);
  return { rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), rejected };
}

function evaluateOverlap(existingSessions, incomingRows, config) {
  const existing = new Map((existingSessions || []).map((item) => [item.date, item]));
  const overlap = [];
  const tolerancePct = Number(config.closeTolerancePct || 1.5);
  for (const row of incomingRows) {
    const old = existing.get(row.date);
    if (!old || !(Number(old.close) > 0) || !(row.close > 0)) continue;
    const differencePct = Math.abs(row.close - Number(old.close)) / Number(old.close) * 100;
    overlap.push({ date: row.date, existingClose: Number(old.close), incomingClose: row.close, differencePct: round(differencePct, 4), matched: differencePct <= tolerancePct });
  }
  const matches = overlap.filter((item) => item.matched).length;
  const ratio = overlap.length ? matches / overlap.length : 0;
  const requiredMatches = Number(config.minimumOverlapMatches || 3);
  const requiredRatio = Number(config.minimumOverlapRatio || 0.75);
  return {
    overlapCount: overlap.length,
    matches,
    ratio: round(ratio, 4),
    accepted: matches >= requiredMatches && ratio >= requiredRatio,
    samples: overlap.slice(-10),
  };
}

async function fetchStartaTicker(ticker, mapEntry, target, config) {
  const diagnostics = [];
  const identityResult = await fetchFromAnyBase(`/egx/stock/${encodeURIComponent(ticker)}`, config, diagnostics);
  const identity = verifyIdentity(identityResult.data, ticker, mapEntry, target, config);
  if (!identity.verified) {
    const error = new Error(`starta_identity_failed:${identity.warnings.join(',') || 'unknown'}`);
    error.details = { identity, diagnostics };
    throw error;
  }
  const ohlcResult = await fetchFromAnyBase(`/egx/ohlc/${encodeURIComponent(ticker)}?period=1y&limit=500`, config, diagnostics);
  const sourceUrl = `${ohlcResult.base}/egx/ohlc/${ticker}?period=1y&limit=500`;
  const normalized = normalizeOhlcRows(ohlcResult.data, ticker, sourceUrl, Number(config.sourceConfidence || 75));
  if (!normalized.rows.length) {
    const error = new Error('starta_ohlc_no_valid_rows');
    error.details = { identity, diagnostics, rejected: normalized.rejected.slice(0, 20) };
    throw error;
  }
  return { identity, rows: normalized.rows, rejected: normalized.rejected, diagnostics, sourceUrl };
}

module.exports = { fetchStartaTicker, evaluateOverlap, nameSimilarity };
