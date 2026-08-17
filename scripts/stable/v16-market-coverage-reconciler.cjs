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
function mergeHistory(ticker, evidence, expectedSession, marketRow) {
  const file = path.join(HISTORY_DIR, `${ticker}.json`);
  const document = readJson(file, null);
  if (!document || !Array.isArray(document.sessions)) return { ticker, merged: false, reason: 'HISTORY_FILE_MISSING_OR_INVALID' };
  const now = new Date().toISOString();
  const close = n(evidence.close);
  const open = n(evidence.open) ?? close;
  const high = n(evidence.high) ?? Math.max(open, close);
  const low = n(evidence.low) ?? Math.min(open, close);
  const volume = n(evidence.volume);
  if (!(close > 0 && open > 0 && high >= Math.max(open, close) && low > 0 && low <= Math.min(open, close))) {
    return { ticker, merged: false, reason: 'INVALID_SECOND_SOURCE_OHLC' };
  }
  const row = {
    ticker,
    date: expectedSession,
    sessionDate: expectedSession,
    sourceSessionDate: expectedSession,
    open: round(open, 6), high: round(high, 6), low: round(low, 6), close: round(close, 6), adjustedClose: round(close, 6),
    volume: volume === null ? null : Math.round(volume),
    currency: 'EGP',
    primarySource: sourceLabel(evidence.provider),
    source: sourceLabel(evidence.provider),
    verificationSources: [String(marketRow?.source || 'mubasher_symbol_pages')],
    sourceUrls: { primary: evidence.url || null, verification: [marketRow?.sourceUrl || null].filter(Boolean) },
    sourceSessionEvidence: `independent_second_source_${String(evidence.provider).toLowerCase()}_confirmed`,
    validationStatus: 'precise_public_source_session_confirmed',
    fetchedAt: now,
    validatedAt: now,
    secondSourceConfirmed: true,
    secondSourceProvider: evidence.provider,
    primaryVsSecondSourceDifferencePct: n(evidence.priceDifferencePct),
    originalPrimaryClose: n(marketRow?.price ?? marketRow?.last ?? marketRow?.close),
    confidence: { overall: 95, policy: 'independent_exact_session_plus_primary_price_agreement', failClosed: true }
  };
  document.sessions = document.sessions.filter(s => dateOnly(s?.date || s?.sessionDate) !== expectedSession);
  document.sessions.push(row);
  document.sessions.sort((a, b) => String(a.date || a.sessionDate || '').localeCompare(String(b.date || b.sessionDate || '')));
  document.generatedAt = now;
  document.availableSessions = document.sessions.length;
  document.firstSession = document.sessions.length ? dateOnly(document.sessions[0]?.date || document.sessions[0]?.sessionDate) : document.firstSession || null;
  document.lastSession = document.sessions.length ? dateOnly(document.sessions.at(-1)?.date || document.sessions.at(-1)?.sessionDate) : document.lastSession || null;
  document.staleData = false;
  writeJson(file, document);
  return { ticker, merged: true, provider: evidence.provider, close };
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
    const history = mergeHistory(ticker, e, expectedSession, marketRow);
    historyResults.push(history);
    if (!history.merged) continue;
    acceptedRecovered.push({
      ticker,
      date: expectedSession,
      close: round(n(e.close), 6),
      mode: 'INDEPENDENT_SECOND_SOURCE_SESSION_CONFIRMED',
      originalRejectReason: rejected.reason,
      provider: e.provider,
      sourceSessionDate: expectedSession,
      sourceSessionEvidence: `independent_second_source_${String(e.provider).toLowerCase()}_confirmed`,
      priceDifferencePct: n(e.priceDifferencePct),
      secondSourceConfirmed: true
    });
  }

  // Fail closed if evidence was approved but could not be persisted into the canonical session history.
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
  const sourceRecoveredTickers = acceptedRecovered.filter(r => staleTickers.has(r.ticker) || unknownTickers.has(r.ticker)).map(r => r.ticker);
  const primaryMatchingRows = Number(sourceEvidence.primaryMatchingRows ?? sourceEvidence.matchingRows ?? price?.source?.verifiedExpectedSessionRows ?? 0);
  const effectiveMatchingRows = Math.min(inputRows || Infinity, primaryMatchingRows + sourceRecoveredTickers.length);
  const effectiveCoveragePct = inputRows ? round(effectiveMatchingRows / inputRows * 100, 1) : 0;

  const now = new Date().toISOString();
  const minimumExecutionRows = Number(price.minimumExecutionRows || sourceEvidence.minimumExecutionRows || 80);
  const executionGrade = price.executionGrade === true && acceptedRows >= minimumExecutionRows && effectiveMatchingRows >= minimumExecutionRows;
  const ready = price.ready === true && executionGrade;

  price.generatedAt = now;
  price.acceptedRows = acceptedRows;
  price.rejectedRows = finalRejected.length;
  price.sampleRejected = finalRejected;
  price.sampleAccepted = [...(Array.isArray(price.sampleAccepted) ? price.sampleAccepted : []), ...acceptedRecovered].slice(-Math.max(25, acceptedRecovered.length));
  price.ready = ready;
  price.executionGrade = executionGrade;
  price.secondSourceReconciliation = {
    enabled: true, failClosed: true, expectedSession,
    targetRejectedRows: originalRejected.length,
    resolverApprovedRows: approved.size,
    recoveredRows: recoveredCount,
    unresolvedRows: finalRejected.length,
    recoveredTickers: acceptedRecovered.map(r => r.ticker),
    unresolvedTickers: finalRejected.map(r => norm(r.ticker)),
    historyResults,
    changesAlphaOrRanking: false,
    changesEntryStopTargetAllocation: false
  };
  price.source = {
    ...(price.source || {}),
    inputRows,
    primaryVerifiedExpectedSessionRows: primaryMatchingRows,
    secondSourceVerifiedSessionRows: sourceRecoveredTickers.length,
    secondSourceVerifiedSessionTickers: sourceRecoveredTickers,
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
  sourceEvidence.secondSourceResolvedRows = sourceRecoveredTickers.length;
  sourceEvidence.secondSourceResolvedTickers = sourceRecoveredTickers;
  sourceEvidence.matchingRows = effectiveMatchingRows;
  sourceEvidence.mismatchedRows = Math.max(0, sourceEvidence.primaryMismatchedRows - sourceRecoveredTickers.filter(t => staleTickers.has(t)).length);
  sourceEvidence.unknownRows = Math.max(0, sourceEvidence.primaryUnknownRows - sourceRecoveredTickers.filter(t => unknownTickers.has(t)).length);
  sourceEvidence.coveragePct = effectiveCoveragePct;
  sourceEvidence.readyForPriceTruth = effectiveMatchingRows >= minimumExecutionRows;
  sourceEvidence.effectiveEvidencePolicy = 'Primary exact-session evidence plus independent exact-session second-source confirmation. Primary stale timestamps are preserved as diagnostics and never rewritten as if they were current.';
  sourceEvidence.effectiveSecondSourceRecords = acceptedRecovered.filter(r => sourceRecoveredTickers.includes(r.ticker));
  writeJson(EVIDENCE_PATH, sourceEvidence);

  fetchStatus.generatedAt = now;
  fetchStatus.ok = ready;
  fetchStatus.executionGrade = executionGrade;
  fetchStatus.marketRows = acceptedRows;
  fetchStatus.currentSessionRows = acceptedRows;
  fetchStatus.verifiedSessionRows = effectiveMatchingRows;
  fetchStatus.sourceSessionEvidenceCoveragePct = effectiveCoveragePct;
  fetchStatus.secondSourceRecoveredRows = recoveredCount;
  fetchStatus.secondSourceRecoveredTickers = acceptedRecovered.map(r => r.ticker);
  writeJson(FETCH_STATUS_PATH, fetchStatus);

  console.log(JSON.stringify({
    expectedSession, inputRows, originalAcceptedRows, recoveredRows: recoveredCount, acceptedRows,
    rejectedRows: finalRejected.length, primarySessionRows: primaryMatchingRows,
    secondSourceSessionRecoveredRows: sourceRecoveredTickers.length, verifiedExpectedSessionRows: effectiveMatchingRows,
    sourceSessionEvidenceCoveragePct: effectiveCoveragePct, executionGrade, ready,
    recoveredTickers: acceptedRecovered.map(r => r.ticker), unresolvedTickers: finalRejected.map(r => norm(r.ticker))
  }, null, 2));

  if (!executionGrade) process.exitCode = 2;
}

main();
