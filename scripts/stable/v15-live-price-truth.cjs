#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const FETCH_STATUS_PATH = path.join(ROOT, 'data/fetch-status.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v15-price-truth.json');

const MIN_EXECUTION_ROWS = Number(process.env.EGX_MIN_EXECUTION_ROWS || 80);
const MAX_SINGLE_SESSION_JUMP_PCT = Number(process.env.EGX_MAX_SINGLE_SESSION_JUMP_PCT || 35);
const PRECISE_SOURCE_PATTERN = /mubasher_symbol_pages_precise/i;
const FOCUS_TICKERS = ['AALR', 'ODIN', 'NIPH'];

function n(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 4) {
  const parsed = n(value, null);
  return parsed === null ? null : Number(parsed.toFixed(digits));
}
const dateOnly = value => (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const normSymbol = value => String(value || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

function expectedLatestCompletedSessionCairo(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const cairoHour = Number(parts.hour) + Number(parts.minute) / 60;
  const isTradingDay = () => [0, 1, 2, 3, 4].includes(date.getUTCDay());
  if (isTradingDay() && cairoHour < 15) date.setUTCDate(date.getUTCDate() - 1);
  while (!isTradingDay()) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function rowWarnings(row) {
  return Array.isArray(row?.warnings) ? row.warnings.map(String) : [];
}

function historicalRowTrusted(row) {
  if (!(n(row?.close) > 0)) return false;
  if (String(row?.validationStatus || '') === 'source_conflict') return false;
  if (rowWarnings(row).some(w => /local_price_conflict|latest_close_conflict/i.test(w))) return false;
  const confidence = n(row?.confidence?.overall);
  if (confidence !== null && confidence < 60) return false;
  return true;
}

function previousTrustedClose(ticker, beforeDate) {
  const file = path.join(HISTORY_DIR, `${ticker}.json`);
  const document = readJson(file, {});
  const sessions = (Array.isArray(document?.sessions) ? document.sessions : [])
    .filter(row => {
      const date = dateOnly(row?.date || row?.sessionDate);
      return date && date < beforeDate && historicalRowTrusted(row);
    })
    .sort((a, b) => String(a.date || a.sessionDate).localeCompare(String(b.date || b.sessionDate)));
  return n(sessions.at(-1)?.close);
}

function normalizeMarketRow(row, expectedSession, sourceName, generatedAt) {
  const ticker = normSymbol(row?.symbol || row?.ticker || row?.code);
  const close = n(row?.price ?? row?.last ?? row?.close);
  if (!ticker || !(close > 0)) return { dropped: true, ticker: ticker || null, reason: 'INVALID_TICKER_OR_CLOSE' };

  const previousClose = n(row?.previousClose);
  const hasCompleteOhlc = n(row?.open) > 0 && n(row?.high) > 0 && n(row?.low) > 0;
  const open = n(row?.open, previousClose ?? close);
  const high = Math.max(n(row?.high, Math.max(open, close)), open, close);
  const low = Math.min(n(row?.low, Math.min(open, close)), open, close);
  const volume = Math.max(0, n(row?.volume, 0));
  if (!(open > 0 && high >= open && high >= close && low > 0 && low <= open && low <= close)) {
    return { dropped: true, ticker, reason: 'INVALID_RECONSTRUCTED_OHLC', close: round(close), open: round(open), high: round(high), low: round(low) };
  }

  const priorTrusted = previousTrustedClose(ticker, expectedSession);
  const jumpPct = priorTrusted > 0 ? Math.abs(close / priorTrusted - 1) * 100 : null;
  const impliedChangePct = previousClose > 0 ? (close / previousClose - 1) * 100 : null;
  const reportedChangePct = n(row?.changePct);
  const changeConsistent = impliedChangePct === null || reportedChangePct === null || Math.abs(impliedChangePct - reportedChangePct) <= 3;

  if (jumpPct !== null && jumpPct > MAX_SINGLE_SESSION_JUMP_PCT) {
    return {
      rejected: true,
      ticker,
      reason: 'EXTREME_JUMP_REQUIRES_SECOND_SOURCE',
      close: round(close),
      previousTrustedClose: round(priorTrusted),
      jumpPct: round(jumpPct, 2),
      source: sourceName
    };
  }
  if (!changeConsistent) {
    return {
      rejected: true,
      ticker,
      reason: 'REPORTED_CHANGE_MISMATCH',
      close: round(close),
      previousClose: round(previousClose),
      reportedChangePct: round(reportedChangePct, 2),
      impliedChangePct: round(impliedChangePct, 2),
      source: sourceName
    };
  }

  return {
    ticker,
    date: expectedSession,
    open: round(open), high: round(high), low: round(low), close: round(close),
    adjustedClose: round(close), volume: round(volume, 0), currency: 'EGP',
    source: 'v15_precise_public_price_truth',
    primarySource: sourceName,
    officialVerified: false,
    verifiedBy: [sourceName],
    sourceUrls: row?.sourceUrl ? { primary: row.sourceUrl, verification: [] } : undefined,
    fetchedAt: row?.updatedAt || generatedAt,
    validatedAt: new Date().toISOString(),
    confidence: { overall: 84, ohlc: hasCompleteOhlc ? 86 : 78, volume: volume > 0 ? 82 : 65, symbolIdentity: 95 },
    validationStatus: 'precise_public_source_confirmed',
    warnings: hasCompleteOhlc ? [] : ['partial_ohlc_reconstructed_from_close_or_previous_close'],
    priceTruthMode: 'PRECISE_PUBLIC_SINGLE_SOURCE_WITH_ANOMALY_GUARD',
    previousTrustedClose: round(priorTrusted),
    jumpPct: round(jumpPct, 2)
  };
}

function mergeIntoHistory(rows) {
  let updated = 0;
  const missingHistoryFiles = [];
  for (const row of rows) {
    const file = path.join(HISTORY_DIR, `${row.ticker}.json`);
    if (!fs.existsSync(file)) {
      missingHistoryFiles.push(row.ticker);
      continue;
    }
    const document = readJson(file, {});
    const sessions = Array.isArray(document.sessions) ? document.sessions : [];
    const byDate = new Map();
    for (const session of sessions) {
      const date = dateOnly(session?.date || session?.sessionDate);
      if (date) byDate.set(date, session);
    }
    byDate.set(row.date, row);
    document.sessions = [...byDate.values()].sort((a, b) => String(a.date || a.sessionDate).localeCompare(String(b.date || b.sessionDate)));
    document.firstSession = dateOnly(document.sessions[0]?.date || document.sessions[0]?.sessionDate);
    document.lastSession = dateOnly(document.sessions.at(-1)?.date || document.sessions.at(-1)?.sessionDate);
    document.availableSessions = document.sessions.length;
    document.staleData = false;
    document.updateFailed = false;
    document.generatedAt = new Date().toISOString();
    document.priceTruthLatest = {
      date: row.date,
      close: row.close,
      source: row.primarySource,
      validationStatus: row.validationStatus,
      confidence: row.confidence.overall
    };
    writeJson(file, document);
    updated++;
  }
  return { updated, missingHistoryFiles };
}

function main() {
  const expectedSession = expectedLatestCompletedSessionCairo();
  const market = readJson(MARKET_PATH, {});
  const legacyStatus = readJson(FETCH_STATUS_PATH, {});
  const generatedAt = market?.generatedAt || market?.updatedAt || legacyStatus?.generatedAt || null;
  const sourceName = String(market?.source || legacyStatus?.sourceName || 'unknown');
  const rows = Array.isArray(market?.rows) ? market.rows : [];

  const currentSnapshot = dateOnly(generatedAt) === expectedSession;
  const preciseSource = PRECISE_SOURCE_PATTERN.test(sourceName);
  const realFetch = market?.ok === true && legacyStatus?.realFetch === true;
  const broadCoverage = rows.length >= MIN_EXECUTION_ROWS;
  const sourceEligible = currentSnapshot && preciseSource && realFetch && broadCoverage;

  const accepted = [];
  const rejected = [];
  const dropped = [];
  if (sourceEligible) {
    for (const row of rows) {
      const normalized = normalizeMarketRow(row, expectedSession, sourceName, generatedAt);
      if (!normalized) continue;
      if (normalized.rejected) rejected.push(normalized);
      else if (normalized.dropped) dropped.push(normalized);
      else accepted.push(normalized);
    }
  } else {
    rejected.push({
      reason: 'SNAPSHOT_NOT_ELIGIBLE',
      expectedSession,
      generatedAt,
      currentSnapshot,
      sourceName,
      preciseSource,
      realFetch,
      marketRows: rows.length,
      minimumRows: MIN_EXECUTION_ROWS
    });
  }

  const unique = new Map();
  for (const row of accepted) unique.set(row.ticker, row);
  const acceptedRows = [...unique.values()];
  const mergeResult = mergeIntoHistory(acceptedRows);
  const ready = sourceEligible && acceptedRows.length >= MIN_EXECUTION_ROWS && mergeResult.updated >= MIN_EXECUTION_ROWS;
  const acceptedMap = new Map(acceptedRows.map(row => [row.ticker, row]));
  const rejectedMap = new Map(rejected.filter(row => row.ticker).map(row => [row.ticker, row]));
  const droppedMap = new Map(dropped.filter(row => row.ticker).map(row => [row.ticker, row]));

  const report = {
    schemaVersion: '15.2.1',
    generatedAt: new Date().toISOString(),
    expectedSession,
    ready,
    executionGrade: ready,
    acceptanceMode: 'PRECISE_PUBLIC_SOURCE_WITH_PER_SYMBOL_ANOMALY_GUARD',
    minimumExecutionRows: MIN_EXECUTION_ROWS,
    maximumSingleSessionJumpPct: MAX_SINGLE_SESSION_JUMP_PCT,
    source: { name: sourceName, generatedAt, currentSnapshot, preciseSource, realFetch, inputRows: rows.length },
    acceptedRows: acceptedRows.length,
    rejectedRows: rejected.length,
    droppedRows: dropped.length,
    updatedHistoryFiles: mergeResult.updated,
    missingHistoryFiles: mergeResult.missingHistoryFiles,
    focusAudit: FOCUS_TICKERS.map(ticker => {
      const acceptedRow = acceptedMap.get(ticker);
      const rejectedRow = rejectedMap.get(ticker);
      const droppedRow = droppedMap.get(ticker);
      const history = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
      return {
        ticker,
        status: acceptedRow ? 'ACCEPTED' : rejectedRow ? 'REJECTED' : droppedRow ? 'DROPPED' : 'NOT_IN_MARKET',
        close: acceptedRow?.close ?? rejectedRow?.close ?? droppedRow?.close ?? null,
        reason: rejectedRow?.reason ?? droppedRow?.reason ?? null,
        historyLastSession: history?.lastSession || null,
        historyLatestClose: history?.priceTruthLatest?.close ?? null
      };
    }),
    sampleAccepted: acceptedRows.slice(0, 40).map(row => ({ ticker: row.ticker, close: row.close, previousTrustedClose: row.previousTrustedClose, jumpPct: row.jumpPct, mode: row.priceTruthMode, warnings: row.warnings })),
    sampleRejected: rejected.slice(0, 50),
    sampleDropped: dropped.slice(0, 50)
  };
  writeJson(OUT_PATH, report);

  writeJson(FETCH_STATUS_PATH, {
    ok: ready,
    realFetch,
    scriptExists: true,
    generatedAt: report.generatedAt,
    mode: ready ? 'v15_precise_public_execution_grade' : 'v15_precise_public_not_ready',
    sourceName,
    sourceUrl: market?.sourceUrl || null,
    marketRows: acceptedRows.length,
    coveragePct: rows.length ? round(acceptedRows.length / rows.length * 100, 2) : 0,
    message: ready
      ? `Accepted ${acceptedRows.length} current-session EGX prices from ${sourceName}; anomalous symbols were excluded.`
      : `Price truth not ready: accepted ${acceptedRows.length}; ${MIN_EXECUTION_ROWS} required.`,
    executionGrade: ready,
    expectedSession,
    currentSessionRows: acceptedRows.length,
    rejectedCurrentSessionRows: rejected.length,
    droppedCurrentSessionRows: dropped.length
  });

  console.log(JSON.stringify(report, null, 2));
  if (!ready) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  const generatedAt = new Date().toISOString();
  const expectedSession = expectedLatestCompletedSessionCairo();
  writeJson(OUT_PATH, { schemaVersion: '15.2.1', generatedAt, expectedSession, ready: false, executionGrade: false, error: error.stack || error.message });
  writeJson(FETCH_STATUS_PATH, { ok: false, realFetch: false, scriptExists: true, generatedAt, mode: 'v15_price_truth_exception', executionGrade: false, expectedSession, message: error.message });
  console.error(error);
  process.exitCode = 1;
}
