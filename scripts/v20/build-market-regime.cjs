#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchHistory } = require('../history/adapters/yahoo-history-adapter.cjs');
const { sanitizeSessions } = require('./build-trusted-technical-history.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const NETWORK_REFRESH = String(process.env.V20_REGIME_NETWORK_REFRESH || 'true').toLowerCase() !== 'false';
const MAX_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.V20_REGIME_CONCURRENCY || 6)));
const MIN_PARTICIPATION_PCT = Number(process.env.V20_REGIME_MIN_PARTICIPATION_PCT || 60);
const PRICE_TOLERANCE_PCT = Number(process.env.V20_REGIME_PRICE_TOLERANCE_PCT || 5);
const MIN_TRUSTED_SESSIONS = Math.max(50, Number(process.env.V20_REGIME_MIN_TRUSTED_SESSIONS || 50));
const FETCH_RANGE = process.env.V20_REGIME_FETCH_RANGE || '6mo';

function read(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
function safeTicker(value) { return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9_-]/g, ''); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function mean(values) { const x = values.filter(Number.isFinite); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; }
function median(values) {
  const x = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!x.length) return null;
  const i = Math.floor(x.length / 2);
  return x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2;
}
function std(values) {
  const x = values.filter(Number.isFinite);
  if (x.length < 2) return null;
  const avg = mean(x);
  return Math.sqrt(x.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (x.length - 1));
}
function sma(values, period) {
  if (values.length < period) return null;
  return mean(values.slice(-period));
}
function pctChange(last, base) { return last > 0 && base > 0 ? (last / base - 1) * 100 : null; }
function priceDiffPct(a, b) { return a > 0 && b > 0 ? Math.abs(a - b) / b * 100 : null; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function loadSymbolMap() {
  const raw = read('data/symbol-map.json', []);
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  return new Map(entries.map(entry => [safeTicker(entry.ticker), entry]).filter(([ticker]) => ticker));
}

function cachedDocument(ticker) { return read(`data/history/${ticker}.json`, null); }

function rowStats(rows) {
  const closes = rows.map(row => row.close);
  const latest = rows.at(-1);
  const dailyReturns = [];
  for (let i = Math.max(1, closes.length - 21); i < closes.length; i += 1) dailyReturns.push(pctChange(closes[i], closes[i - 1]));
  const volumeBase = rows.slice(-21, -1).map(row => finite(row.volume)).filter(v => v > 0);
  return {
    close: round(latest.close, 4),
    return1Pct: round(pctChange(closes.at(-1), closes.at(-2))),
    return5Pct: closes.length >= 6 ? round(pctChange(closes.at(-1), closes.at(-6))) : null,
    return20Pct: closes.length >= 21 ? round(pctChange(closes.at(-1), closes.at(-21))) : null,
    sma20: round(sma(closes, 20), 4),
    sma50: round(sma(closes, 50), 4),
    aboveSma20: closes.length >= 20 ? closes.at(-1) >= sma(closes, 20) : null,
    aboveSma50: closes.length >= 50 ? closes.at(-1) >= sma(closes, 50) : null,
    volatility20AnnualizedPct: dailyReturns.length >= 2 ? round(std(dailyReturns) * Math.sqrt(252), 2) : null,
    relativeVolume20: finite(latest.volume) > 0 && volumeBase.length >= 10 ? round(latest.volume / mean(volumeBase), 2) : null,
  };
}

function classify(metrics) {
  let score = 50;
  if (metrics.advancePct >= 60) score += 14; else if (metrics.advancePct < 40) score -= 16;
  if (metrics.aboveSma20Pct >= 60) score += 16; else if (metrics.aboveSma20Pct < 40) score -= 18;
  if (metrics.aboveSma50Pct >= 55) score += 14; else if (metrics.aboveSma50Pct < 35) score -= 16;
  if (metrics.medianReturn20Pct >= 4) score += 12; else if (metrics.medianReturn20Pct < -4) score -= 14;
  if (metrics.medianReturn5Pct >= 1.5) score += 6; else if (metrics.medianReturn5Pct < -2) score -= 8;
  if (metrics.volatility20AnnualizedPct >= 55) score -= 18; else if (metrics.volatility20AnnualizedPct <= 30) score += 6;
  score = clamp(Math.round(score), 0, 100);

  let v16ReferenceRegime = 'NEUTRAL';
  if (metrics.volatility20AnnualizedPct >= 65) v16ReferenceRegime = 'HIGH_VOLATILITY';
  else if (score >= 68) v16ReferenceRegime = 'RISK_ON';
  else if (score <= 35) v16ReferenceRegime = 'RISK_OFF';

  const mapped = v16ReferenceRegime === 'RISK_ON' ? 'BULLISH'
    : v16ReferenceRegime === 'NEUTRAL' ? 'NEUTRAL'
      : 'BEARISH';
  return {
    score,
    v16ReferenceRegime,
    mappedRegime: mapped,
    volatilityOverlay: v16ReferenceRegime === 'HIGH_VOLATILITY' ? 'HIGH_VOLATILITY' : 'NORMAL',
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
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, run));
  return results;
}

async function resolveSymbol(ticker, mapEntry, snapshotRow, asOfDate) {
  const base = {
    ticker,
    currentSnapshotAvailable: Boolean(snapshotRow),
    currentSnapshotSemanticComplete: snapshotRow?.semanticCompleteness === true && snapshotRow?.ohlcValid === true,
    currentSnapshotSessionAligned: snapshotRow?.sessionDate === asOfDate,
    currentSnapshotPrice: finite(snapshotRow?.price),
    sourceConflict: snapshotRow?.sourceConflict === true,
    eligibleForVerifiedRegime: false,
    blockers: [],
  };

  if (!snapshotRow) return { ...base, blockers: ['CURRENT_SNAPSHOT_ROW_MISSING'] };
  if (snapshotRow.sessionDate !== asOfDate) return { ...base, blockers: ['CURRENT_SNAPSHOT_SESSION_MISMATCH'] };
  if (snapshotRow.semanticCompleteness !== true || snapshotRow.ohlcValid !== true) return { ...base, blockers: ['CURRENT_SNAPSHOT_SEMANTIC_QUALITY_INCOMPLETE'] };
  if (!(finite(snapshotRow.price) > 0)) return { ...base, blockers: ['CURRENT_SNAPSHOT_PRICE_MISSING'] };
  if (snapshotRow.sourceConflict === true) return { ...base, blockers: ['CURRENT_SNAPSHOT_SOURCE_CONFLICT'] };
  if (!mapEntry) return { ...base, blockers: ['SYMBOL_MAP_ENTRY_MISSING'] };

  let document = null;
  let sourceKind = null;
  const attempts = [];
  if (NETWORK_REFRESH) {
    try {
      const fetched = await fetchHistory(mapEntry, {
        range: FETCH_RANGE,
        timeoutMs: 7000,
        maxAttempts: 1,
        backoffMs: 200,
        localReference: { close: finite(snapshotRow.price) },
      });
      document = {
        symbolVerified: fetched.identity?.verified === true,
        symbolVerification: fetched.identity || null,
        primarySource: 'yahoo',
        sessions: fetched.sessions || [],
      };
      sourceKind = 'LIVE_YAHOO_REFRESH';
      attempts.push({ source: 'yahoo_live', ok: true, sessions: fetched.sessions?.length || 0 });
    } catch (error) {
      attempts.push({ source: 'yahoo_live', ok: false, error: error.message });
    }
  }
  if (!document) {
    const cached = cachedDocument(ticker);
    if (cached) {
      document = cached;
      sourceKind = 'CACHED_VERIFIED_HISTORY_DOCUMENT';
      attempts.push({ source: 'cached_history_document', ok: true, sessions: cached.sessions?.length || 0 });
    }
  }
  if (!document) return { ...base, attempts, blockers: ['NO_ACCEPTABLE_HISTORY_DOCUMENT'] };
  if (document.symbolVerified !== true) return { ...base, sourceKind, attempts, blockers: ['SYMBOL_IDENTITY_NOT_VERIFIED'] };

  const sanitized = sanitizeSessions(document.sessions, ticker, asOfDate);
  const rows = sanitized.rows;
  if (rows.length < MIN_TRUSTED_SESSIONS) return {
    ...base, sourceKind, source: document.primarySource || null, attempts,
    rowsAccepted: rows.length, rowsRejected: sanitized.rejected.length,
    lastSession: rows.at(-1)?.date || null,
    blockers: ['INSUFFICIENT_TRUSTED_SESSIONS_FOR_SMA50'],
  };

  const latest = rows.at(-1);
  const difference = priceDiffPct(latest.close, finite(snapshotRow.price));
  const sessionAligned = latest.date === asOfDate;
  const priceReconciled = difference !== null && difference <= PRICE_TOLERANCE_PCT;
  const stats = rowStats(rows);
  const blockers = unique([
    !sessionAligned ? 'HISTORY_LAST_SESSION_NOT_ALIGNED_WITH_CURRENT_SESSION' : null,
    !priceReconciled ? 'LATEST_HISTORY_CLOSE_NOT_RECONCILED_WITH_CURRENT_MARKET_PRICE' : null,
    stats.sma20 === null ? 'SMA20_NOT_READY' : null,
    stats.sma50 === null ? 'SMA50_NOT_READY' : null,
    stats.return20Pct === null ? 'RETURN20_NOT_READY' : null,
    stats.volatility20AnnualizedPct === null ? 'VOLATILITY20_NOT_READY' : null,
  ]);
  return {
    ...base,
    sourceKind,
    source: document.primarySource || latest.primarySource || null,
    identityPolicy: document.symbolVerification?.policy || null,
    attempts,
    rowsAccepted: rows.length,
    rowsRejected: sanitized.rejected.length,
    futureRowsRejected: sanitized.rejected.filter(row => (row.errors || []).includes('FUTURE_ROW_AFTER_AS_OF')).length,
    firstSession: rows[0].date,
    lastSession: latest.date,
    latestTrustedClose: latest.close,
    currentPriceDifferencePct: round(difference, 4),
    currentPriceTolerancePct: PRICE_TOLERANCE_PCT,
    sessionAligned,
    priceReconciled,
    stats,
    blockers,
    eligibleForVerifiedRegime: blockers.length === 0,
  };
}

async function main() {
  const current = read('data/v20/current.json', {});
  const snapshot = read('data/v20/current-market-snapshot.json', {});
  const universe = read('data/v20/master-universe.json', {});
  const v16Reference = read('data/stable/v16-market-regime.json', {});
  const policy = read('data/v20/policy-registry.json', {});
  const asOfDate = String(snapshot.sessionDate || current.sessionDate || '').slice(0, 10);
  if (!validDate(asOfDate)) throw new Error('V20 market regime requires a valid current session date');
  if (universe.sessionDate && universe.sessionDate !== asOfDate) throw new Error('Master universe session does not match current market snapshot');

  const configuredThreshold = finite(policy.marketRegime?.minimumVerifiedParticipationPct);
  if (configuredThreshold !== null && configuredThreshold !== MIN_PARTICIPATION_PCT) {
    throw new Error(`Market regime participation threshold mismatch: policy=${configuredThreshold} env=${MIN_PARTICIPATION_PCT}`);
  }
  const symbolMap = loadSymbolMap();
  const snapshotMap = new Map((snapshot.rows || []).map(row => [safeTicker(row.ticker), row]));
  const tickers = (universe.rows || []).map(row => safeTicker(row.ticker)).filter(Boolean);
  const resolved = await mapPool(tickers, ticker => resolveSymbol(ticker, symbolMap.get(ticker) || null, snapshotMap.get(ticker), asOfDate), MAX_CONCURRENCY);
  const eligible = resolved.filter(row => row.eligibleForVerifiedRegime === true);
  const universeCount = tickers.length;
  const advances = eligible.filter(row => row.stats.return1Pct > 0.05).length;
  const declines = eligible.filter(row => row.stats.return1Pct < -0.05).length;
  const unchanged = eligible.length - advances - declines;
  const above50Denom = eligible.filter(row => row.stats.aboveSma50 !== null).length;
  const relativeVolumeDenom = eligible.filter(row => row.stats.relativeVolume20 !== null).length;
  const semanticCompleteCount = resolved.filter(row => row.currentSnapshotSemanticComplete && row.currentSnapshotSessionAligned && !row.sourceConflict).length;
  const metrics = {
    sessionDate: asOfDate,
    universeCount,
    currentSnapshotCount: snapshot.rows?.length || 0,
    currentSnapshotSemanticCompleteCount: semanticCompleteCount,
    currentSnapshotSemanticCompleteCoveragePct: round(semanticCompleteCount / Math.max(1, universeCount) * 100, 2),
    analyzedCount: eligible.length,
    participationPct: round(eligible.length / Math.max(1, universeCount) * 100, 2),
    advances,
    declines,
    unchanged,
    advancePct: round(advances / Math.max(1, advances + declines) * 100, 1),
    advanceDeclineRatio: round(advances / Math.max(1, declines), 2),
    aboveSma20Pct: round(eligible.filter(row => row.stats.aboveSma20 === true).length / Math.max(1, eligible.length) * 100, 1),
    aboveSma50Pct: round(eligible.filter(row => row.stats.aboveSma50 === true).length / Math.max(1, above50Denom) * 100, 1),
    medianReturn1Pct: round(median(eligible.map(row => row.stats.return1Pct))),
    medianReturn5Pct: round(median(eligible.map(row => row.stats.return5Pct))),
    medianReturn20Pct: round(median(eligible.map(row => row.stats.return20Pct))),
    volatility20AnnualizedPct: round(median(eligible.map(row => row.stats.volatility20AnnualizedPct))),
    highVolumeParticipationPct: round(eligible.filter(row => row.stats.relativeVolume20 >= 1.2).length / Math.max(1, relativeVolumeDenom) * 100, 1),
    liveYahooRefreshSuccessCount: resolved.filter(row => row.sourceKind === 'LIVE_YAHOO_REFRESH').length,
    cachedFallbackCount: resolved.filter(row => row.sourceKind === 'CACHED_VERIFIED_HISTORY_DOCUMENT').length,
    sessionAlignedCount: resolved.filter(row => row.sessionAligned === true).length,
    priceReconciledCount: resolved.filter(row => row.priceReconciled === true).length,
  };
  const classification = eligible.length ? classify(metrics) : { score: null, v16ReferenceRegime: null, mappedRegime: null, volatilityOverlay: null };
  const verified = metrics.participationPct >= MIN_PARTICIPATION_PCT;
  const officialRegime = verified ? classification.mappedRegime : 'UNVERIFIED_CURRENT_REGIME';
  const labels = {
    BULLISH: 'سوق صاعد واسع المشاركة',
    NEUTRAL: 'سوق محايد وانتقائي',
    BEARISH: 'سوق دفاعي مرتفع المخاطر',
    UNVERIFIED_CURRENT_REGIME: 'حالة السوق الحالية غير متحققة بتغطية تاريخية متزامنة كافية',
  };

  const output = {
    schemaVersion: '20.0.0-market-regime-evidence-1',
    generatedAt: new Date().toISOString(),
    asOfSessionDate: asOfDate,
    decisionSupportOnly: true,
    methodology: {
      name: 'EGX_PRO_MARKET_REGIME_BREADTH_1.0_V20_POINT_IN_TIME',
      v16ReferenceMethodology: 'EGX_PRO_MARKET_REGIME_BREADTH_1.0',
      v16ReferenceSource: 'scripts/stable/v16-market-regime-engine.cjs',
      benchmarkType: 'EQUAL_WEIGHT_MARKET_BREADTH',
      fullUniverseScope: true,
      sectorInputsUsed: false,
      futureRowsAllowed: false,
      missingOhlcMayBeSynthesized: false,
      currentSnapshotSemanticCompletenessRequired: true,
      currentSessionAlignmentRequired: true,
      currentPriceReconciliationRequired: true,
      minimumTrustedSessionsPerSymbol: MIN_TRUSTED_SESSIONS,
      minimumVerifiedParticipationPct: MIN_PARTICIPATION_PCT,
      currentPriceTolerancePct: PRICE_TOLERANCE_PCT,
      productionRiskBudgetInfluence: false,
      executionGateInfluence: false,
    },
    verified,
    regime: officialRegime,
    diagnosticRegime: classification.mappedRegime,
    v16ReferenceRegime: classification.v16ReferenceRegime,
    volatilityOverlay: classification.volatilityOverlay,
    classificationScore: classification.score,
    labelAr: labels[officialRegime],
    marketConfidencePct: verified ? metrics.participationPct : 0,
    decisionUse: verified ? 'CURRENT_MARKET_CONTEXT_ONLY' : 'RESEARCH_DIAGNOSTIC_ONLY',
    metrics,
    priorV16Reference: {
      source: 'data/stable/v16-market-regime.json',
      sessionDate: v16Reference?.metrics?.sessionDate || null,
      regime: v16Reference?.regime || null,
      staleForCurrentSession: Boolean(v16Reference?.metrics?.sessionDate && v16Reference.metrics.sessionDate !== asOfDate),
      allowedToPromoteAsCurrent: false,
    },
    warnings: unique([
      !verified ? 'INSUFFICIENT_CURRENT_FULL_MARKET_HISTORY_PARTICIPATION' : null,
      metrics.currentSnapshotSemanticCompleteCoveragePct < MIN_PARTICIPATION_PCT ? 'CURRENT_SNAPSHOT_SEMANTIC_COVERAGE_BELOW_REGIME_THRESHOLD' : null,
      classification.volatilityOverlay === 'HIGH_VOLATILITY' ? 'ELEVATED_VOLATILITY' : null,
      metrics.aboveSma20Pct !== null && metrics.aboveSma20Pct < 40 ? 'WEAK_SHORT_TERM_BREADTH' : null,
      v16Reference?.metrics?.sessionDate !== asOfDate ? 'STALE_V16_REGIME_REFERENCE_NOT_USED_AS_CURRENT' : null,
    ]),
    exclusions: {
      count: resolved.length - eligible.length,
      byReason: resolved.reduce((acc, row) => {
        for (const reason of row.blockers || []) acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {}),
    },
    symbols: resolved.map(row => ({
      ticker: row.ticker,
      eligibleForVerifiedRegime: row.eligibleForVerifiedRegime === true,
      sourceKind: row.sourceKind || null,
      source: row.source || null,
      rowsAccepted: row.rowsAccepted || 0,
      rowsRejected: row.rowsRejected || 0,
      futureRowsRejected: row.futureRowsRejected || 0,
      lastSession: row.lastSession || null,
      currentSnapshotSemanticComplete: row.currentSnapshotSemanticComplete === true,
      currentSnapshotSessionAligned: row.currentSnapshotSessionAligned === true,
      sourceConflict: row.sourceConflict === true,
      sessionAligned: row.sessionAligned === true,
      priceReconciled: row.priceReconciled === true,
      currentPriceDifferencePct: row.currentPriceDifferencePct ?? null,
      stats: row.stats || null,
      blockers: row.blockers || [],
    })),
  };
  write('data/v20/market-regime.json', output);
  console.log(JSON.stringify({
    verified: output.verified,
    regime: output.regime,
    diagnosticRegime: output.diagnosticRegime,
    score: output.classificationScore,
    participationPct: output.metrics.participationPct,
    analyzedCount: output.metrics.analyzedCount,
    universeCount: output.metrics.universeCount,
    liveYahooRefreshSuccessCount: output.metrics.liveYahooRefreshSuccessCount,
    exclusions: output.exclusions.byReason,
  }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
module.exports = { classify, rowStats, resolveSymbol };
