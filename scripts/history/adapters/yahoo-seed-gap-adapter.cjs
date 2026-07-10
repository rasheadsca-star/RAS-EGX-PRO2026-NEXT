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

function unixStart(dateText, lookbackDays = 45) {
  const value = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid history date: ${dateText}`);
  value.setUTCDate(value.getUTCDate() - Math.max(7, Number(lookbackDays || 45)));
  return Math.floor(value.getTime() / 1000);
}

function unixEnd() {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + 2);
  return Math.floor(value.getTime() / 1000);
}

function buildUrls(symbol, startDate, lookbackDays) {
  const encoded = encodeURIComponent(symbol);
  const query = [
    `period1=${unixStart(startDate, lookbackDays)}`,
    `period2=${unixEnd()}`,
    'interval=1d',
    'events=history',
    'includeAdjustedClose=true',
  ].join('&');
  return [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
  ];
}

function loadFixture(symbol) {
  const fixtureDir = process.env.GAP_FIXTURE_DIR;
  if (!fixtureDir) return null;
  const candidates = [
    path.join(fixtureDir, `${symbol}.json`),
    path.join(fixtureDir, `${symbol.replace(/[^A-Za-z0-9_-]/g, '_')}.json`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  return file ? {
    json: readJson(file),
    response: { url: `fixture://${path.basename(file)}` },
    attempts: 1,
  } : null;
}

function parsePayload(payload, symbol, entry, sourceUrl) {
  const chart = payload?.chart;
  if (chart?.error) throw new Error(`Yahoo chart error: ${chart.error.description || chart.error.code || 'unknown'}`);
  const result = chart?.result?.[0];
  if (!result) throw new Error('Yahoo response did not contain chart.result[0]');

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const sessions = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = toNumber(quote.close?.[index]);
    if (close === null) continue;
    const date = cairoDateFromUnix(toNumber(timestamps[index]));
    if (!date) continue;
    sessions.push({
      ticker: safeTicker(entry.ticker),
      date,
      open: round(toNumber(quote.open?.[index])),
      high: round(toNumber(quote.high?.[index])),
      low: round(toNumber(quote.low?.[index])),
      close: round(close),
      adjustedClose: round(toNumber(adjusted[index])),
      volume: toNumber(quote.volume?.[index]),
      currency: result.meta?.currency || entry.currency || 'EGP',
      primarySource: 'yahoo_gap_completion',
      officialVerified: false,
      verifiedBy: [],
      sourceUrls: { primary: sourceUrl, verification: [] },
      fetchedAt: nowIso(),
      validatedAt: null,
      confidence: {
        overall: 0,
        ohlc: 0,
        volume: quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 60 : 0,
        symbolIdentity: 0,
      },
      validationStatus: 'pending_seed_overlap_validation',
      warnings: unique([
        'same_source_family_gap_completion',
        quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 'volume_missing' : null,
        adjusted[index] === null || adjusted[index] === undefined ? 'adjusted_close_missing' : null,
      ]),
    });
  }

  return { meta: result.meta || {}, sessions };
}

function evaluateIdentity(meta, requestedSymbol, entry) {
  const returnedSymbol = String(meta.symbol || '').toUpperCase();
  const expectedSymbol = String(requestedSymbol || '').toUpperCase();
  const currency = String(meta.currency || '').toUpperCase();
  const expectedCurrency = String(entry.currency || 'EGP').toUpperCase();
  const exchangeEvidence = [
    meta.exchangeName,
    meta.fullExchangeName,
    meta.exchangeTimezoneName,
    meta.timezone,
  ].filter(Boolean).map(String);
  const exchangeText = exchangeEvidence.join(' ').toLowerCase();

  const exactSymbol = returnedSymbol === expectedSymbol;
  const cairoSuffix = returnedSymbol.endsWith('.CA') && expectedSymbol.endsWith('.CA');
  const mapDeclaresEgx = String(entry.exchange || '').toUpperCase() === 'EGX';
  const exchangeConfirmed = /(^|[^a-z])(cai|cairo|egypt|egx)([^a-z]|$)/i.test(exchangeText);
  const currencyMatches = currency === expectedCurrency;
  const currencyAcceptable = currencyMatches || (!currency && expectedCurrency === 'EGP');

  return {
    exactSymbol,
    cairoSuffix,
    mapDeclaresEgx,
    exchangeConfirmed,
    currencyMatches,
    currencyAcceptable,
    returnedSymbol: meta.symbol || null,
    requestedSymbol,
    currency: meta.currency || null,
    exchangeEvidence,
    companyName: meta.longName || meta.shortName || null,
  };
}

function verifyOverlap(existingSessions, fetchedSessions, config) {
  const existingByDate = new Map((existingSessions || []).map((session) => [session.date, session]));
  const overlap = [];
  const maxRows = Math.max(1, Number(config.maximumOverlapRows || 10));
  const tolerancePct = Math.max(0.01, Number(config.overlapCloseTolerancePct || 0.25));
  const toleranceAbs = Math.max(0.001, Number(config.overlapCloseToleranceAbsolute || 0.02));

  for (const session of fetchedSessions || []) {
    const prior = existingByDate.get(session.date);
    if (!prior || !(Number(prior.close) > 0) || !(Number(session.close) > 0)) continue;
    const difference = Math.abs(Number(session.close) - Number(prior.close));
    const differencePct = difference / Number(prior.close) * 100;
    const matched = difference <= Math.max(toleranceAbs, Number(prior.close) * tolerancePct / 100);
    overlap.push({
      date: session.date,
      existingClose: Number(prior.close),
      fetchedClose: Number(session.close),
      differencePct: round(differencePct, 5),
      matched,
    });
  }

  const recentOverlap = overlap.sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxRows);
  const matches = recentOverlap.filter((item) => item.matched).length;
  const mismatches = recentOverlap.length - matches;
  const ratio = recentOverlap.length ? matches / recentOverlap.length : 0;
  const minimumMatches = Math.max(1, Number(config.minimumOverlapMatches || 1));
  const minimumRatio = Math.max(0.5, Math.min(1, Number(config.minimumOverlapMatchRatio || 0.8)));

  return {
    verified: recentOverlap.length >= minimumMatches && matches >= minimumMatches && ratio >= minimumRatio,
    overlapRows: recentOverlap.length,
    matches,
    mismatches,
    matchRatio: round(ratio * 100, 2),
    checks: recentOverlap,
  };
}

function applyGapConfidence(sessions, identity, overlap) {
  const base = identity.currencyMatches ? 70 : 65;
  return sessions.map((session) => ({
    ...session,
    confidence: {
      ...session.confidence,
      overall: base,
      ohlc: base,
      volume: session.volume === null || session.volume === undefined ? 60 : base,
      symbolIdentity: identity.currencyMatches ? 90 : 85,
    },
    validationStatus: 'seed_overlap_continuity_validated',
    warnings: unique([
      ...(session.warnings || []),
      'historical_gap_filled_from_same_yahoo_source_family',
      'not_independently_cross_verified',
      !identity.currencyMatches ? 'currency_missing_but_overlap_verified' : null,
      `overlap_match_ratio:${overlap.matchRatio}%`,
    ]),
  }));
}

async function fetchGapHistory(entry, existingDocument, config = {}) {
  const existingSessions = Array.isArray(existingDocument?.sessions) ? existingDocument.sessions : [];
  const lastSession = existingDocument?.lastSession || existingSessions.at(-1)?.date;
  if (!lastSession) throw new Error(`No existing seed history date for ${entry.ticker}`);

  const candidates = unique([
    entry.yahooSymbol,
    entry.reutersCode,
    entry.yahooAlternative,
    `${safeTicker(entry.ticker)}.CA`,
    entry.isin ? `${String(entry.isin).toUpperCase()}.CA` : null,
  ]);
  if (!candidates.length) throw new Error(`No Yahoo candidate symbols configured for ${entry.ticker}`);

  const failures = [];
  for (const candidate of candidates) {
    try {
      const fixture = loadFixture(candidate);
      const loaded = fixture || await getJson(buildUrls(candidate, lastSession, config.overlapLookbackCalendarDays), {
        timeoutMs: Number(config.timeoutMs || 18000),
        maxAttempts: Number(config.maxAttempts || 3),
        backoffMs: Number(config.backoffMs || 900),
      });
      const parsed = parsePayload(loaded.json, candidate, entry, loaded.response.url);
      const identity = evaluateIdentity(parsed.meta, candidate, entry);
      const overlap = verifyOverlap(existingSessions, parsed.sessions, config);

      const identityAccepted = identity.exactSymbol
        && identity.cairoSuffix
        && identity.mapDeclaresEgx
        && identity.exchangeConfirmed
        && identity.currencyAcceptable;

      if (!identityAccepted) {
        failures.push(`${candidate}: identity evidence failed`);
        continue;
      }
      if (!overlap.verified) {
        failures.push(`${candidate}: seed overlap failed (${overlap.matches}/${overlap.overlapRows})`);
        continue;
      }

      const sessions = applyGapConfidence(parsed.sessions, identity, overlap);
      return {
        requestedSymbol: candidate,
        meta: parsed.meta,
        identity: {
          verified: true,
          policy: 'seed_overlap_continuity',
          sameSourceFamily: true,
          officialVerification: false,
          ...identity,
          overlap,
        },
        overlap,
        sessions,
        attempts: loaded.attempts,
        candidateFailures: failures,
      };
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(`Yahoo seed-gap completion failed for ${entry.ticker}: ${failures.join(' | ')}`);
}

module.exports = {
  fetchGapHistory,
  parsePayload,
  evaluateIdentity,
  verifyOverlap,
  buildUrls,
};
