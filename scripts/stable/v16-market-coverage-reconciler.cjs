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
const APPROVED_PROVIDERS = new Set(['YAHOO_CHART', 'STOCKANALYSIS_EGX_HISTORY', 'SIGMA_CAPITAL_LIVE_MARKET']);

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
    && APPROVED_PROVIDERS.has(String(e?.provider || ''));
}
function sourceLabel(provider) {
  if (provider === 'YAHOO_CHART') return 'yahoo_independent_session_confirmation';
  if (provider === 'SIGMA_CAPITAL_LIVE_MARKET') return 'sigma_capital_independent_live_session_confirmation';
  return 'stockanalysis_egx_independent_session_confirmation';
}
function validOhlc(row, closeOverride = null, requireObservedRange = false) {
  const close = n(closeOverride ?? row?.close ?? row?.price ?? row?.last);
  const observedOpen = n(row?.open), observedHigh = n(row?.high), observedLow = n(row?.low);
  if (requireObservedRange && !(observedOpen > 0 && observedHigh > 0 && observedLow > 0)) return null;
  const open = observedOpen ?? close;
  const high = observedHigh ?? Math.max(open, close);
  const low = observedLow ?? Math.min(open, close);
  if (!(close > 0 && open > 0 && high > 0 && low > 0)) return null;
  const tick = Math.max(0.01, close * 0.0025);
  if (high + tick < Math.max(open, close) || low - tick > Math.min(open, close)) return null;
  return { close, open, high: Math.max(high, open, close), low: Math.min(low, open, close), volume: n(row?.volume) };
}
function minimalHistoryDocument(ticker, marketRow, provider) {
  return {
    schemaVersion: '16.9.2-current-session-second-source-seed', ticker,
    companyNameAr: marketRow?.name_ar || marketRow?.nameAr || ticker,
    companyNameEn: marketRow?.name_en || marketRow?.nameEn || ticker,
    isin: null, reutersCode: `${ticker}.CA`, yahooSymbol: `${ticker}.CA`, currency: 'EGP', exchange: 'EGX',
    generatedAt: new Date().toISOString(), availableSessions: 0, firstSession: null, lastSession: null,
    historyStatus: 'current_session_only_second_source_seed', primarySource: sourceLabel(provider),
    verificationSources: [String(marketRow?.source || 'mubasher_symbol_pages')],
    officiallyVerifiedLatestSession: false, symbolVerified: true,
    identityVerificationPolicy: 'exact_egx_ticker_public_second_source_current_session_only', averageConfidence: 95,
    staleData: false, updateFailed: false, warnings: ['historical_depth_not_established_current_session_seed_only'], sessions: []
  };
}
function mergeHistory(ticker, evidence, expectedSession, marketRow, originalReason) {
  const file = path.join(HISTORY_DIR, `${ticker}.json`);
  let document = readJson(file, null);
  const staleReplacement = STALE_REASONS.has(String(originalReason || '')) || evidence?.replacementForStalePrimary === true;
  const sameSessionConfirmation = !staleReplacement && SAME_SESSION_CONFIRM_REASONS.has(String(originalReason || ''));
  if (!document || !Array.isArray(document.sessions)) document = minimalHistoryDocument(ticker, marketRow, evidence.provider);

  const primaryClose = n(marketRow?.price ?? marketRow?.last ?? marketRow?.close);
  let base = null, ohlcMode = null;
  if (sameSessionConfirmation) {
    base = validOhlc(marketRow, primaryClose, false);
    ohlcMode = base ? 'PRIMARY_OHLC_SECOND_SOURCE_CLOSE_CONFIRMED' : null;
    if (!base && evidence.provider !== 'SIGMA_CAPITAL_LIVE_MARKET') {
      base = validOhlc(evidence, n(evidence.close), true);
      ohlcMode = base ? 'SECOND_SOURCE_OHLC_AFTER_PRIMARY_CLOSE_CONFIRMATION' : null;
    }
  } else {
    base = validOhlc(evidence, n(evidence.close), true);
    ohlcMode = base ? 'SECOND_SOURCE_EXACT_SESSION_REPLACEMENT' : null;
  }
  if (!base) return { ticker, merged: false, reason: 'NO_VALID_OHLC_AFTER_EXACT_SESSION_CONFIRMATION' };

  const now = new Date().toISOString();
  const primaryIsCanonical = ohlcMode === 'PRIMARY_OHLC_SECOND_SOURCE_CLOSE_CONFIRMED';
  const row = {
    ticker, date: expectedSession, sessionDate: expectedSession, sourceSessionDate: expectedSession,
    open: round(base.open, 6), high: round(base.high, 6), low: round(base.low, 6), close: round(base.close, 6), adjustedClose: round(base.close, 6),
    volume: base.volume === null ? null : Math.round(base.volume), currency: 'EGP',
    primarySource: primaryIsCanonical ? String(marketRow?.source || 'mubasher_symbol_pages') : sourceLabel(evidence.provider),
    source: primaryIsCanonical ? String(marketRow?.source || 'mubasher_symbol_pages') : sourceLabel(evidence.provider),
    verificationSources: [sourceLabel(evidence.provider)],
    sourceUrls: { primary: primaryIsCanonical ? (marketRow?.sourceUrl || null) : (evidence.url || null), verification: [primaryIsCanonical ? evidence.url : marketRow?.sourceUrl].filter(Boolean) },
    sourceSessionEvidence: staleReplacement ? `independent_second_source_${String(evidence.provider).toLowerCase()}_exact_session_replacement` : `primary_exact_session_close_independently_confirmed_by_${String(evidence.provider).toLowerCase()}`,
    validationStatus: 'precise_public_source_session_confirmed', fetchedAt: now, validatedAt: now,
    secondSourceConfirmed: true, secondSourceProvider: evidence.provider, secondSourceClose: round(n(evidence.close), 6),
    primaryVsSecondSourceDifferencePct: n(evidence.priceDifferencePct), originalPrimaryClose: primaryClose,
    stalePrimaryReplaced: staleReplacement, originalRejectReason: originalReason || null, ohlcMode,
    confidence: { overall: 95, policy: staleReplacement ? 'independent_exact_session_replacement_for_stale_primary' : 'primary_exact_session_close_plus_independent_exact_session_confirmation', failClosed: true }
  };
  document.sessions = document.sessions.filter(s => dateOnly(s?.date || s?.sessionDate) !== expectedSession);
  document.sessions.push(row);
  document.sessions.sort((a, b) => String(a.date || a.sessionDate || '').localeCompare(String(b.date || b.sessionDate || '')));
  document.generatedAt = now; document.availableSessions = document.sessions.length;
  document.firstSession = document.sessions.length ? dateOnly(document.sessions[0]?.date || document.sessions[0]?.sessionDate) : null;
  document.lastSession = document.sessions.length ? dateOnly(document.sessions.at(-1)?.date || document.sessions.at(-1)?.sessionDate) : null;
  document.staleData = false;
  writeJson(file, document);
  return { ticker, merged: true, provider: evidence.provider, close: base.close, mode: ohlcMode, createdHistorySeed: document.schemaVersion === '16.9.2-current-session-second-source-seed' };
}

function main() {
  const price = readJson(PRICE_PATH, {}), sourceEvidence = readJson(EVIDENCE_PATH, {}), second = readJson(SECOND_PATH, {}), market = readJson(MARKET_PATH, { rows: [] }), fetchStatus = readJson(FETCH_STATUS_PATH, {});
  const expectedSession = dateOnly(price.expectedSession || second.expectedSession || sourceEvidence.expectedSession);
  if (!expectedSession) throw new Error('Missing expected session');
  if (dateOnly(second.expectedSession) !== expectedSession) throw new Error('Second-source evidence session mismatch');
  const marketByTicker = new Map((market.rows || []).map(r => [norm(r.symbol || r.ticker || r.code), r]));
  const approved = new Map();
  for (const [rawTicker, record] of Object.entries(second.records || {})) if (validApprovedRecord(record, expectedSession)) approved.set(norm(rawTicker), record);

  const originalRejected = Array.isArray(price.sampleRejected) ? price.sampleRejected : [];
  const resolvableRejected = originalRejected.filter(r => approved.has(norm(r.ticker)));
  const unresolvedRejected = originalRejected.filter(r => !approved.has(norm(r.ticker)));
  const historyResults = [], acceptedRecovered = [];
  for (const rejected of resolvableRejected) {
    const ticker = norm(rejected.ticker), record = approved.get(ticker), e = record.approvedEvidence, marketRow = marketByTicker.get(ticker) || {};
    const originalReason = record.originalReason || rejected.reason;
    const history = mergeHistory(ticker, e, expectedSession, marketRow, originalReason);
    historyResults.push(history);
    if (!history.merged) continue;
    acceptedRecovered.push({ ticker, date: expectedSession, close: round(history.close, 6), mode: history.mode, originalRejectReason: originalReason, provider: e.provider,
      sourceSessionDate: expectedSession,
      sourceSessionEvidence: STALE_REASONS.has(String(originalReason || '')) ? `independent_second_source_${String(e.provider).toLowerCase()}_exact_session_replacement` : `primary_exact_session_close_independently_confirmed_by_${String(e.provider).toLowerCase()}`,
      priceDifferencePct: n(e.priceDifferencePct), secondSourceConfirmed: true });
  }

  const acceptedTickers = new Set(acceptedRecovered.map(r => r.ticker));
  const finallyResolved = resolvableRejected.filter(r => acceptedTickers.has(norm(r.ticker)));
  const finalRejected = [...unresolvedRejected, ...resolvableRejected.filter(r => !acceptedTickers.has(norm(r.ticker))).map(r => ({ ...r, reason: 'SECOND_SOURCE_HISTORY_PERSIST_FAILED' }))];
  const originalAcceptedRows = Number(price.acceptedRows || 0), recoveredCount = finallyResolved.length;
  const inputRows = Number(price?.source?.inputRows || price.inputRows || sourceEvidence.totalRows || market.rows?.length || 0);
  const acceptedRows = Math.min(inputRows || Infinity, originalAcceptedRows + recoveredCount);

  const staleTickers = new Set((sourceEvidence.staleSymbols || []).map(x => norm(x.ticker)));
  const unknownTickers = new Set((sourceEvidence.unknownSymbols || []).map(x => norm(x.ticker || x)));
  const cumulativeSecondSource = new Set([...(sourceEvidence.secondSourceResolvedTickers || []), ...(price?.source?.secondSourceVerifiedSessionTickers || [])].map(norm).filter(Boolean));
  for (const row of (Array.isArray(price.sampleAccepted) ? price.sampleAccepted : [])) {
    const ticker = norm(row?.ticker);
    if (ticker && row?.secondSourceConfirmed === true && dateOnly(row?.sourceSessionDate || row?.date) === expectedSession && STALE_REASONS.has(String(row?.originalRejectReason || ''))) cumulativeSecondSource.add(ticker);
  }
  for (const row of acceptedRecovered) if (STALE_REASONS.has(String(row.originalRejectReason || '')) || staleTickers.has(row.ticker) || unknownTickers.has(row.ticker)) cumulativeSecondSource.add(row.ticker);
  const cumulativeSecondSourceTickers = [...cumulativeSecondSource].sort();
  const primaryMatchingRows = Number(sourceEvidence.primaryMatchingRows ?? price?.source?.primaryVerifiedExpectedSessionRows ?? sourceEvidence.matchingRows ?? 0);
  const effectiveMatchingRows = Math.min(inputRows || Infinity, primaryMatchingRows + cumulativeSecondSourceTickers.length);
  const effectiveCoveragePct = inputRows ? round(effectiveMatchingRows / inputRows * 100, 1) : 0;
  const now = new Date().toISOString(), minimumExecutionRows = Number(price.minimumExecutionRows || sourceEvidence.minimumExecutionRows || 80);
  const executionGrade = price.executionGrade === true && acceptedRows >= minimumExecutionRows && effectiveMatchingRows >= minimumExecutionRows;
  const ready = price.ready === true && executionGrade;

  price.generatedAt = now; price.acceptedRows = acceptedRows; price.rejectedRows = finalRejected.length; price.sampleRejected = finalRejected; price.ready = ready; price.executionGrade = executionGrade;
  const acceptedByTicker = new Map((Array.isArray(price.sampleAccepted) ? price.sampleAccepted : []).map(r => [norm(r.ticker), r]));
  for (const row of acceptedRecovered) acceptedByTicker.set(row.ticker, row);
  price.sampleAccepted = [...acceptedByTicker.values()].slice(-Math.max(50, acceptedRecovered.length));
  price.secondSourceReconciliation = { enabled: true, failClosed: true, expectedSession, targetRejectedRowsThisRun: originalRejected.length, resolverApprovedRowsThisRun: approved.size, recoveredRowsThisRun: recoveredCount, unresolvedRows: finalRejected.length,
    recoveredTickersThisRun: acceptedRecovered.map(r => r.ticker), cumulativeSecondSourceSessionTickers: cumulativeSecondSourceTickers,
    unresolvedTickers: finalRejected.map(r => norm(r.ticker)), historyResults, changesAlphaOrRanking: false, changesEntryStopTargetAllocation: false };
  price.source = { ...(price.source || {}), inputRows, primaryVerifiedExpectedSessionRows: primaryMatchingRows, secondSourceVerifiedSessionRows: cumulativeSecondSourceTickers.length, secondSourceVerifiedSessionTickers: cumulativeSecondSourceTickers,
    verifiedExpectedSessionRows: effectiveMatchingRows, sourceSessionEvidenceCoveragePct: effectiveCoveragePct, secondSourceEvidencePath: 'data/stable/v16-market-second-source-evidence.json' };
  writeJson(PRICE_PATH, price);

  sourceEvidence.generatedAt = now;
  sourceEvidence.primaryMatchingRows = Number(sourceEvidence.primaryMatchingRows ?? sourceEvidence.matchingRows ?? 0);
  sourceEvidence.primaryMismatchedRows = Number(sourceEvidence.primaryMismatchedRows ?? sourceEvidence.mismatchedRows ?? 0);
  sourceEvidence.primaryUnknownRows = Number(sourceEvidence.primaryUnknownRows ?? sourceEvidence.unknownRows ?? 0);
  sourceEvidence.primaryCoveragePct = Number(sourceEvidence.primaryCoveragePct ?? sourceEvidence.coveragePct ?? 0);
  sourceEvidence.secondSourceResolvedRows = cumulativeSecondSourceTickers.length; sourceEvidence.secondSourceResolvedTickers = cumulativeSecondSourceTickers;
  sourceEvidence.matchingRows = effectiveMatchingRows;
  sourceEvidence.mismatchedRows = Math.max(0, sourceEvidence.primaryMismatchedRows - cumulativeSecondSourceTickers.filter(t => staleTickers.has(t)).length);
  sourceEvidence.unknownRows = Math.max(0, sourceEvidence.primaryUnknownRows - cumulativeSecondSourceTickers.filter(t => unknownTickers.has(t)).length);
  sourceEvidence.coveragePct = effectiveCoveragePct; sourceEvidence.readyForPriceTruth = effectiveMatchingRows >= minimumExecutionRows;
  sourceEvidence.effectiveEvidencePolicy = 'Primary exact-session evidence plus cumulative independent exact-session second-source confirmation. Primary stale timestamps remain preserved as diagnostics and are never rewritten as current evidence.';
  const priorEvidenceRecords = new Map((sourceEvidence.effectiveSecondSourceRecords || []).map(r => [norm(r.ticker), r]));
  for (const row of (Array.isArray(price.sampleAccepted) ? price.sampleAccepted : [])) if (cumulativeSecondSourceTickers.includes(norm(row.ticker)) && row.secondSourceConfirmed === true) priorEvidenceRecords.set(norm(row.ticker), row);
  sourceEvidence.effectiveSecondSourceRecords = [...priorEvidenceRecords.values()].filter(r => cumulativeSecondSourceTickers.includes(norm(r.ticker)));
  writeJson(EVIDENCE_PATH, sourceEvidence);

  fetchStatus.generatedAt = now; fetchStatus.ok = ready; fetchStatus.executionGrade = executionGrade; fetchStatus.marketRows = acceptedRows; fetchStatus.currentSessionRows = acceptedRows;
  fetchStatus.verifiedSessionRows = effectiveMatchingRows; fetchStatus.sourceSessionEvidenceCoveragePct = effectiveCoveragePct;
  fetchStatus.secondSourceRecoveredRows = cumulativeSecondSourceTickers.length; fetchStatus.secondSourceRecoveredTickers = cumulativeSecondSourceTickers;
  writeJson(FETCH_STATUS_PATH, fetchStatus);

  console.log(JSON.stringify({ expectedSession, inputRows, originalAcceptedRows, recoveredRowsThisRun: recoveredCount, acceptedRows, rejectedRows: finalRejected.length, primarySessionRows: primaryMatchingRows,
    cumulativeSecondSourceSessionRows: cumulativeSecondSourceTickers.length, verifiedExpectedSessionRows: effectiveMatchingRows, sourceSessionEvidenceCoveragePct: effectiveCoveragePct, executionGrade, ready,
    recoveredTickersThisRun: acceptedRecovered.map(r => r.ticker), cumulativeSecondSourceTickers, unresolvedTickers: finalRejected.map(r => norm(r.ticker)) }, null, 2));
  if (!executionGrade) process.exitCode = 2;
}
main();
