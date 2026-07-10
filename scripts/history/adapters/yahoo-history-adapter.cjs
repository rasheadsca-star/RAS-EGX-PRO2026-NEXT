'use strict';

const fs = require('fs');
const path = require('path');
const { getJson } = require('../lib/http-client.cjs');
const {
  cairoDateFromUnix,
  nowIso,
  readJson,
  round,
  safeTicker,
  toNumber,
  unique,
} = require('../lib/utils.cjs');

function buildUrls(symbol, range) {
  const encoded = encodeURIComponent(symbol);
  const query = `range=${encodeURIComponent(range)}&interval=1d&events=history&includeAdjustedClose=true`;
  return [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
  ];
}

function loadFixture(symbol) {
  const fixtureDir = process.env.HISTORY_FIXTURE_DIR;
  if (!fixtureDir) return null;
  const candidates = [
    path.join(fixtureDir, `${symbol}.json`),
    path.join(fixtureDir, `${symbol.replace(/[^A-Za-z0-9_-]/g, '_')}.json`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  return file ? { json: readJson(file), response: { url: `fixture://${path.basename(file)}` }, attempts: 1 } : null;
}

function identityCheck(meta, requestedSymbol, mapEntry, localReference) {
  const warnings = [];
  let score = 0;

  const exchangeEvidence = [
    meta.exchangeName,
    meta.fullExchangeName,
    meta.exchangeTimezoneName,
    meta.timezone,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  const exchangeText = exchangeEvidence.join(' ').toLowerCase();
  const currency = String(meta.currency || '').toUpperCase();
  const returnedSymbol = String(meta.symbol || '').toUpperCase();
  const expectedSymbol = String(requestedSymbol || '').toUpperCase();
  const expectedCurrency = String(mapEntry.currency || 'EGP').toUpperCase();

  const exactSymbol = returnedSymbol === expectedSymbol;
  if (exactSymbol) score += 35;
  else warnings.push(`returned_symbol_mismatch:${returnedSymbol || 'missing'}`);

  const currencyMatches = currency === expectedCurrency;
  if (currencyMatches) score += 25;
  else warnings.push(`currency_mismatch:${currency || 'missing'}`);

  const cairoExchangeConfirmed =
    /(^|[^a-z])(cai|cairo|egypt|egx)([^a-z]|$)/i.test(exchangeText) ||
    (
      expectedSymbol.endsWith('.CA') &&
      String(mapEntry.exchange || '').toUpperCase() === 'EGX' &&
      /egypt/i.test(String(meta.fullExchangeName || ''))
    );

  if (cairoExchangeConfirmed) score += 30;
  else warnings.push(`exchange_not_confirmed:${exchangeText || 'missing'}`);

  const regularMarketPrice = toNumber(meta.regularMarketPrice);
  let localDifferencePct = null;
  if (localReference?.close && regularMarketPrice) {
    localDifferencePct = Math.abs(regularMarketPrice - localReference.close) / localReference.close * 100;
    if (localDifferencePct <= 25) score += 10;
    else warnings.push(`latest_price_far_from_local_reference:${round(localDifferencePct, 3)}%`);
  } else if (meta.shortName || meta.longName) {
    score += 10;
  } else {
    warnings.push('company_name_missing');
  }

  const normalVerified = score >= 80;
  const guardedPolicyRequested = mapEntry.identityPolicy === 'guarded_local_crosscheck'
    && mapEntry.identityReviewStatus === 'eligible_for_guarded_salvage';
  const maxDifferencePct = Number(mapEntry.identityMaxPriceDifferencePct || 8);
  const mapDeclaresEgx = String(mapEntry.exchange || '').toUpperCase() === 'EGX';
  const cairoSuffix = expectedSymbol.endsWith('.CA') && returnedSymbol.endsWith('.CA');
  const currencyAcceptable = currencyMatches || (!currency && expectedCurrency === 'EGP');
  const nameEvidence = Boolean(meta.shortName || meta.longName || mapEntry.companyNameAr || mapEntry.companyNameEn);
  const guardedVerified = Boolean(
    !normalVerified &&
    guardedPolicyRequested &&
    score >= 60 &&
    exactSymbol &&
    cairoSuffix &&
    mapDeclaresEgx &&
    currencyAcceptable &&
    nameEvidence &&
    localReference?.close &&
    regularMarketPrice &&
    localDifferencePct !== null &&
    localDifferencePct <= maxDifferencePct
  );

  if (guardedVerified) warnings.push(`guarded_identity_salvage:local_price_diff_${round(localDifferencePct, 3)}%`);
  if (guardedVerified && !currency) warnings.push('currency_missing_but_guarded_by_exact_symbol_egx_and_local_price');

  const verified = normalVerified || guardedVerified;
  const baseConfidence = normalVerified ? 75 : (guardedVerified ? (currencyMatches ? 70 : 65) : 0);

  return {
    verified,
    normalVerified,
    guardedVerified,
    policy: normalVerified ? 'standard_identity' : (guardedVerified ? 'guarded_local_crosscheck' : 'rejected'),
    baseConfidence,
    score,
    warnings,
    evidence: {
      requestedSymbol,
      returnedSymbol: meta.symbol || null,
      exchangeName: meta.exchangeName || null,
      fullExchangeName: meta.fullExchangeName || null,
      exchangeEvidence,
      currency: meta.currency || null,
      shortName: meta.shortName || null,
      longName: meta.longName || null,
      regularMarketPrice,
      localReferenceClose: localReference?.close || null,
      localDifferencePct: localDifferencePct === null ? null : round(localDifferencePct, 4),
      guardedPolicyRequested,
      guardedMaxDifferencePct: maxDifferencePct,
    },
  };
}

function parseYahooPayload(payload, requestedSymbol, mapEntry, localReference, sourceUrl) {
  const chart = payload?.chart;
  if (chart?.error) throw new Error(`Yahoo chart error: ${chart.error.description || chart.error.code || 'unknown'}`);
  const result = chart?.result?.[0];
  if (!result) throw new Error('Yahoo response did not contain chart.result[0]');

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const identity = identityCheck(result.meta || {}, requestedSymbol, mapEntry, localReference);
  const sessions = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = toNumber(quote.close?.[index]);
    if (close === null) continue;
    const date = cairoDateFromUnix(toNumber(timestamps[index]));
    if (!date) continue;
    sessions.push({
      ticker: safeTicker(mapEntry.ticker),
      date,
      open: round(toNumber(quote.open?.[index])),
      high: round(toNumber(quote.high?.[index])),
      low: round(toNumber(quote.low?.[index])),
      close: round(close),
      adjustedClose: round(toNumber(adjusted[index])),
      volume: toNumber(quote.volume?.[index]),
      currency: result.meta?.currency || mapEntry.currency || 'EGP',
      primarySource: 'yahoo',
      officialVerified: false,
      verifiedBy: [],
      sourceUrls: {
        primary: sourceUrl,
        verification: [],
      },
      fetchedAt: nowIso(),
      validatedAt: null,
      confidence: {
        overall: identity.baseConfidence,
        ohlc: identity.baseConfidence,
        volume: quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 60 : identity.baseConfidence,
        symbolIdentity: identity.score,
      },
      validationStatus: identity.guardedVerified ? 'guarded_identity_validated' : (identity.verified ? 'single_source_validated' : 'symbol_identity_failed'),
      warnings: unique([
        ...identity.warnings,
        quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 'volume_missing' : null,
        adjusted[index] === null || adjusted[index] === undefined ? 'adjusted_close_missing' : null,
      ]),
    });
  }

  return {
    requestedSymbol,
    meta: result.meta || {},
    identity,
    sessions,
  };
}

async function fetchHistory(mapEntry, options = {}) {
  const range = options.range || '1y';
  const candidates = unique([
    mapEntry.yahooSymbol,
    mapEntry.reutersCode,
    mapEntry.yahooAlternative,
  ]);
  if (!candidates.length) throw new Error(`No Yahoo candidate symbols configured for ${mapEntry.ticker}`);

  const failures = [];
  for (const candidate of candidates) {
    try {
      const fixture = loadFixture(candidate);
      const loaded = fixture || await getJson(buildUrls(candidate, range), {
        timeoutMs: options.timeoutMs || 18000,
        maxAttempts: options.maxAttempts || 3,
        backoffMs: options.backoffMs || 900,
      });
      const parsed = parseYahooPayload(loaded.json, candidate, mapEntry, options.localReference, loaded.response.url);
      if (!parsed.identity.verified) {
        failures.push(`${candidate}: identity score ${parsed.identity.score}`);
        continue;
      }
      if (!parsed.sessions.length) {
        failures.push(`${candidate}: no sessions`);
        continue;
      }
      return { ...parsed, attempts: loaded.attempts, candidateFailures: failures };
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }

  const error = new Error(`Yahoo history failed for ${mapEntry.ticker}: ${failures.join(' | ')}`);
  error.candidateFailures = failures;
  throw error;
}

module.exports = { fetchHistory, parseYahooPayload, identityCheck };
