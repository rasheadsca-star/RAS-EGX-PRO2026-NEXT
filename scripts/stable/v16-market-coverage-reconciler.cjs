#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const PRICE_PATH = P('data/stable/v15-price-truth.json');
const EVIDENCE_PATH = P('data/stable/v16-source-session-evidence.json');
const SECOND_PATH = P('data/stable/v16-market-second-source-evidence.json');
const FETCH_STATUS_PATH = P('data/fetch-status.json');
const MARKET_PATH = P('data/market.json');
const HISTORY_DIR = P('data/history');

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
const round = (v, d = 4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const norm = v => String(v || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const STALE_REASONS = new Set(['SOURCE_SESSION_MISMATCH', 'SOURCE_SESSION_UNKNOWN']);
const SAME_SESSION_CONFIRM_REASONS = new Set(['EXTREME_JUMP_REQUIRES_SECOND_SOURCE', 'REPORTED_CHANGE_MISMATCH', 'SECOND_SOURCE_HISTORY_PERSIST_FAILED']);

function validApprovedRecord(record, expectedSession) {
  const e = record?.approvedEvidence;
  return record?.approved === true
    && e?.status === 'APPROVED'
    && dateOnly(e?.sessionDate) === expectedSession
    && n(e?.close) > 0
    && ['YAHOO_CHART', 'STOCKANALYSIS_EGX_HISTORY'].includes(String(e?.provider || ''));
}
function sourceLabel(provider) {
  return provider === 'YAHOO_CHART' ? 'yahoo_independent_session_confirmation' : 'stockanalysis_egx_independent_session_confirmation';
}
function validOhlc(row, closeOverride = null) {
  const close = n(closeOverride ?? row?.close ?? row?.price ?? row?.last);
  const open = n(row?.open) ?? close;
  const high = n(row?.high) ?? Math.max(open, close);
  const low = n(row?.low) ?? Math.min(open, close);
  if (!(close > 0 && open > 0 && high > 0 && low > 0)) return null;
  // Some public tables round low/open independently at penny prices. Accept a
  // one-tick rounding overlap only when the independent close is already proven.
  const tick = Math.max(0.01, close * 0.0025);
  if (high + tick < Math.max(open, close) || low - tick > Math.min(open, close)) return null;
  return {
    close,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    volume: n(row?.volume)
  };
}
function minimalHistoryDocument(ticker, marketRow, expectedSession, provider) {
  return {
    schemaVersion: '16.9.2-current-session-second-source-seed',
    ticker,
    companyNameAr: marketRow?.name_ar || marketRow?.nameAr || ticker,
    companyNameEn: marketRow?.name_en || marketRow?.nameEn || ticker,
    isin: null,
    reutersCode: `${ticker}.CA`,
    yahooSymbol: `${ticker}.CA`,
    currency: 'EGP',
    exchange: 'EGX',
    generatedAt: new Date().toISOString(),
    availableSessions: 0,
    firstSession: null,
    lastSession: null,
    historyStatus: 'current_session_only_second_source_seed',
    primarySource: sourceLabel(provider),
    verificationSources: [String(marketRow?.source || 'mubasher_symbol_pages')],
    officiallyVerifiedLatestSession: false,
    symbolVerified: true,
    identityVerificationPolicy: 'exact_egx_ticker_public_second_source_current_session_only',
    averageConfidence: 95,
    staleData: false,
    updateFailed: false,
    warnings: ['historical_depth_not_established_current_session_seed_only'],
    sessions: []
  };
}
function mergeHistory(ticker, evidence, expectedSession, marketRow, originalReason) {
  const file = path.join(HISTORY_DIR, `${ticker}.json`);
  let document = readJson(file, null);
  const staleReplacement = STALE_REASONS.has(String(originalReason || '')) || evidence?.replacementForStalePrimary === true;
  const usePrimarySessionOhlc = !staleReplacement && SAME_SESSION_CONFIRM_REASONS.has(String(originalReason || ''));

  if (!document || !Array.isArray(document.sessions)) {
    document = minimalHistoryDocument(ticker, marketRow, expectedSession, evidence.provider);
  }

  const primaryClose = n(marketRow?.price ?? marketRow?.last ?? marketRow?.close);
  const base = usePrimarySessionOhlc
    ? validOhlc(marketRow, primaryClose)
    : validOhlc(evidence, n(evidence.close));
  if (!base) {
    return { ticker, merged: false, reason: usePrimarySessionOhlc ? 'INVALID_PRIMARY_OHLC_AFTER_SECOND_SOURCE_CONFIRMATION' : 'INVALID_SECOND_SOURCE_OHLC' };
  }

  const now = new Date().toISOString();
  const row = {
    ticker,
    date: expectedSession,
    sessionDate: expectedSession,
    sourceSessionDate: expectedSession,
    open: round(base.open, 6),
    high: round(base.high, 6),
    low: round(base.low, 6),
    close: round(base.close, 6),
    adjustedClose: round(base.close, 6),
    volume: base.volume === null ? null : Math.round(base.volume),
    currency: 'EGP',
    primarySource: usePrimarySessionOhlc ? String(marketRow?.source || 'mubasher_symbol_pages') : sourceLabel(evidence.provider),
    source: usePrimarySessionOhlc ? String(marketRow?.source || 'mubasher_symbol_pages') : sourceLabel(evidence.provider),
    verificationSources: [sourceLabel(evidence.provider)],
    sourceUrls: {
      primary: usePrimarySessionOhlc ? (marketRow?.sourceUrl || null) : (evidence.url || null),
      verification: [usePrimarySessionOhlc ? evidence.url : marketRow?.sourceUrl].filter(Boolean)
    },
    sourceSessionEvidence: usePrimarySessionOhlc
      ? `primary_exact_session_close_independently_confirmed_by_${String(evidence.provider).toLowerCase()}`
      : `independent_second_source_${String(evidence.provider).toLowerCase()}_exact_session_replacement`,
    validationStatus: 'precise_public_source_session_confirmed',
    fetchedAt: now,
    validatedAt: now,
    secondSourceConfirmed: true,
    secondSourceProvider: evidence.provider,
    secondSourceClose: round(n(evidence.close), 6),
    primaryVsSecondSourceDifferencePct: n(evidence.priceDifferencePct),
    originalPrimaryClose: primaryClose,
    stalePrimaryReplaced: staleReplacement,
    originalRejectReason: originalReason || null,
    confidence: {
      overall: 95,
      policy: usePrimarySessionOhlc
        ? 'primary_exact_session_ohlc_plus_independent_close_confirmation'
        : 'independent_exact_session_replacement_for_stale_primary',
      failClosed: true
    }
  };

  document.sessions = document.sessions.filter(s => dateOnly(s?.date || s?.sessionDate) !== expectedSession);
  document.sessions.push(row);
  document.sessions.sort((a, b) => String(a.date || a.sessionDate || '').localeCompare(String(b.date || b.sessionDate || '')));
  document.generatedAt = now;
  document.availableSessions = document.sessions.length;
  document.firstSession = document.sessions.length ? dateOnly(document.sessions[0]?.date || document.sessions[0]?.sessionDate) : null;
  document.lastSession = document.sessions.length ? dateOnly(document.sessions.at(-1)?.date || document.sessions.at(-1)?.sessionDate) : null;
  if (document.historyStatus === 'current_session_only_second_source_seed' && document.sessions.length > 1) document.historyStatus = 'partial_history_with_second_source_current_session';
  document.staleData = false;
  writeJson(file, document);
  return { ticker, merged: true, provider: evidence.provider, close: base.close, mode: usePrimarySessionOhlc ? 'PRIMARY_OHLC_SECOND_SOURCE_CLOSE_CONFIRMED' : 'SECOND_SOURCE_EXACT_SESSION_REPLACEMENT', createdHistorySeed: document.schemaVersion === '16.9.2-current-session-second-source-seed' };
}

function main() {
  const price = readJson(PRICE_PATH, {});
  const sourceEvidence = readJson(EVIDENCE_PATH, {});
  const second = readJson(SECOND_PATH, {});
  const market = readJson(MARKET_PATH, { rows: [] });
  const fetchStatus = readJson(FETCH_STATUS_PATH, {});
  const expectedSession = dateOnly(price.expectedSession || second.expectedSession || sourceEvidence.expectedSession);
  if (!expectedSession) throw new Error('Missing expected session');
  if (dateOnly(second.expectedSession) !== expectedSession) throw new Error('Second-source evidence session mismatch');

  const marketByTicker = new Map((market.rows || []).map(r => [norm(r.symbol || r.ticker || r.code), r]));
  const approved = new Map();
  for (const [rawTicker, record] of Object.entries(second.records || {})) {
    const ticker = norm(rawTicker);
    if (validApprovedRecord(record, expectedSession)) approved.set(ticker, record);
  }

  const originalRejected = Array.isArray(price.sampleRejected) ? price.sampleRejected : [];
  const resolvableRejected = originalRejected.filter(r => approved.has(norm(r.ticker)));
  const unresolvedRejected = originalRejected.filter(r => !approved.has(norm(r.ticker)));
  const historyResults = [];
  const acceptedRecovered = [];
  for (const rejected of resolvableRejected) {
    const ticker = norm(rejected.ticker);
    const record = approved.get(ticker);
    const e = record.approvedEvidence;
    const marketRow = marketByTicker.get(ticker) || {};
    const originalReason = record.originalReason || rejected.reason;
    const history = mergeHistory(ticker, e, expectedSession, marketRow, originalReason);
    historyResults.push(history);
    if (!history.merged) continue;
    acceptedRecovered.push({
      ticker,
      date: expectedSession,
      close: round(history.close, 6),
      mode: history.mode,
      originalRejectReason: originalReason,
      provider: e.provider,
      sourceSessionDate: expectedSession,
      sourceSessionEvidence: STALE_REASONS.has(String(originalReason || ''))
        ? `independent_second_source_${String(e.provider).toLowerCase()}_exact_session_replacement`
        : `primary_exact_session_close_independently_confirmed_by_${String(e.provider).toLowerCase()}`,
      priceDifferencePct: n(e.priceDifferencePct),
      secondSourceConfirmed: true
    });
  }

  const acceptedTickers = new Set(acceptedRecovered.map(r => r.ticker));
  const finallyResolved = resolvableRejected.filter(r => acceptedTickers.has(norm(r.ticker)));
  const finalRejected = [
    ...unresolvedRejected,
    ...resolvableRejected.filter(r => !acceptedTickers.has(norm(r.ticker))).map(r => ({ ...r, reason: 'SECOND_SOURCE_HISTORY_PERSIST_FAILED' }))
  ];

  const originalAcceptedRows = Number(price.acceptedRows || 0);
  const recoveredCount = finallyResolved.length;
  const inputRows = Number(price?.source?.inputRows || price.inputRows || sourceEvidence.totalRows || market.rows?.length || 0);
  const acceptedRows = Math.min(inputRows || Infinity, originalAcceptedRows + recoveredCount);

  const staleTickers = new Set((sourceEvidence.staleSymbols || []).map(x => norm(x.ticker)));
  const unknownTickers = new Set((sourceEvidence.unknownSymbols || []).map(x => norm(x.ticker || x)));
  const priorSecondSourceTickers = new Set([
    ...(sourceEvidence.secondSourceResolvedTickers || []),
    ...(price?.source?.secondSourceVerifiedSessionTickers || [])
  ].map(norm).filter(Boolean));
  for (const row of acceptedRecovered) {
    if (staleTickers.has(row.ticker) || unknownTickers.has(row.ticker) || STALE_REASONS.has(String(row.originalRejectReason || ''))) priorSecondSourceTickers.add(row.ticker);
  }
  const cumulativeSecondSourceTickers = [...priorSecondSourceTickers].sort();

  const primaryMatchingRows = Number(sourceEvidence.primaryMatchingRows ?? price?.source?.primaryVerifiedExpectedSessionRows ?? sourceEvidence.matchingRows ?? 0);
  const effectiveMatchingRows = Math.min(inputRows || Infinity, primaryMatchingRows + cumulativeSecondSourceTickers.length);
  const effectiveCoveragePct = inputRows ? round(effectiveMatchingRows / inputRows * 100, 1) : 0;

  const now = new Date().toISOString();
  const minimumExecutionRows = Number(price.minimumExecutionRows || sourceEvidence.minimumExecutionRows || 80);
  const executionGrade = price.executionGrade === true && acceptedRows >= minimumExecutionRows && effectiveMatchingRows >= minimumExecutionRows;
  const ready = price.ready === true && executionGrade;

  price.generatedAt = now;
  price.acceptedRows = acceptedRows;
  price.rejectedRows = finalRejected.length;
  price.sampleRejected = finalRejected;
  const acceptedByTicker = new Map((Array.isArray(price.sampleAccepted) ? price.sampleAccepted : []).map(r => [norm(r.ticker), r]));
  for (const row of acceptedRecovered) acceptedByTicker.set(row.ticker, row);
  price.sampleAccepted = [...acceptedByTicker.values()].slice(-Math.max(40, acceptedRecovered.length));
  price.ready = ready;
  price.executionGrade = executionGrade;
  price.secondSourceReconciliation = {
    enabled: true,
    failClosed: true,
    expectedSession,
    targetRejectedRowsThisRun: originalRejected.length,
    resolverApprovedRowsThisRun: approved.size,
    recoveredRowsThisRun: recoveredCount,
    unresolvedRows: finalRejected.length,
    recoveredTickersThisRun: acceptedRecovered.map(r => r.ticker),
    cumulativeSecondSourceSessionTickers: cumulativeSecondSourceTickers,
    unresolvedTickers: finalRejected.map(r => norm(r.ticker)),
    historyResults,
    changesAlphaOrRanking: false,
    changesEntryStopTargetAllocation: false
  };
  price.source = {
    ...(price.source || {}),
    inputRows,
    primaryVerifiedExpectedSessionRows: primaryMatchingRows,
    secondSourceVerifiedSessionRows: cumulativeSecondSourceTickers.length,
    secondSourceVerifiedSessionTickers: cumulativeSecondSourceTickers,
    verifiedExpectedSessionRows: effectiveMatchingRows,
    sourceSessionEvidenceCoveragePct: effectiveCoveragePct,
    secondSourceEvidencePath: 'data/stable/v16-market-second-source-evidence.json'
  };
  writeJson(PRICE_PATH, price);

  sourceEvidence.generatedAt = now;
  sourceEvidence.primaryMatchingRows = Number(sourceEvidence.primaryMatchingRows ?? sourceEvidence.matchingRows ?? 0);
  sourceEvidence.primaryMismatchedRows = Number(sourceEvidence.primaryMismatchedRows ?? sourceEvidence.mismatchedRows ?? 0);
  sourceEvidence.primaryUnknownRows = Number(sourceEvidence.primaryUnknownRows ?? sourceEvidence.unknownRows ?? 0);
  sourceEvidence.primaryCoveragePct = Number(sourceEvidence.primaryCoveragePct ?? sourceEvidence.coveragePct ?? 0);
  sourceEvidence.secondSourceResolvedRows = cumulativeSecondSourceTickers.length;
  sourceEvidence.secondSourceResolvedTickers = cumulativeSecondSourceTickers;
  sourceEvidence.matchingRows = effectiveMatchingRows;
  sourceEvidence.mismatchedRows = Math.max(0, sourceEvidence.primaryMismatchedRows - cumulativeSecondSourceTickers.filter(t => staleTickers.has(t)).length);
  sourceEvidence.unknownRows = Math.max(0, sourceEvidence.primaryUnknownRows - cumulativeSecondSourceTickers.filter(t => unknownTickers.has(t)).length);
  sourceEvidence.coveragePct = effectiveCoveragePct;
  sourceEvidence.readyForPriceTruth = effectiveMatchingRows >= minimumExecutionRows;
  sourceEvidence.effectiveEvidencePolicy = 'Primary exact-session evidence plus cumulative independent exact-session second-source confirmation. Primary stale timestamps remain preserved as diagnostics and are never rewritten as current evidence.';
  const priorEvidenceRecords = new Map((sourceEvidence.effectiveSecondSourceRecords || []).map(r => [norm(r.ticker), r]));
  for (const row of acceptedRecovered) {
    if (cumulativeSecondSourceTickers.includes(row.ticker)) priorEvidenceRecords.set(row.ticker, row);
  }
  sourceEvidence.effectiveSecondSourceRecords = [...priorEvidenceRecords.values()].filter(r => cumulativeSecondSourceTickers.includes(norm(r.ticker)));
  writeJson(EVIDENCE_PATH, sourceEvidence);

  fetchStatus.generatedAt = now;
  fetchStatus.ok = ready;
  fetchStatus.executionGrade = executionGrade;
  fetchStatus.marketRows = acceptedRows;
  fetchStatus.currentSessionRows = acceptedRows;
  fetchStatus.verifiedSessionRows = effectiveMatchingRows;
  fetchStatus.sourceSessionEvidenceCoveragePct = effectiveCoveragePct;
  fetchStatus.secondSourceRecoveredRows = cumulativeSecondSourceTickers.length;
  fetchStatus.secondSourceRecoveredTickers = cumulativeSecondSourceTickers;
  writeJson(FETCH_STATUS_PATH, fetchStatus);

  console.log(JSON.stringify({
    expectedSession,
    inputRows,
    originalAcceptedRows,
    recoveredRowsThisRun: recoveredCount,
    acceptedRows,
    rejectedRows: finalRejected.length,
    primarySessionRows: primaryMatchingRows,
    cumulativeSecondSourceSessionRows: cumulativeSecondSourceTickers.length,
    verifiedExpectedSessionRows: effectiveMatchingRows,
    sourceSessionEvidenceCoveragePct: effectiveCoveragePct,
    executionGrade,
    ready,
    recoveredTickersThisRun: acceptedRecovered.map(r => r.ticker),
    cumulativeSecondSourceTickers,
    unresolvedTickers: finalRejected.map(r => norm(r.ticker))
  }, null, 2));

  if (!executionGrade) process.exitCode = 2;
}

main();
