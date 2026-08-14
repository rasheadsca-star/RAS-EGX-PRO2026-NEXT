#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const FETCH_STATUS_PATH = path.join(ROOT, 'data/fetch-status.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v15-price-truth.json');
const EVIDENCE_PATH = path.join(ROOT, 'data/stable/v16-source-session-evidence.json');
const REPAIR_PATH = path.join(ROOT, 'data/stable/v16-session-repair-report.json');

const MIN_EXECUTION_ROWS = Number(process.env.EGX_MIN_EXECUTION_ROWS || 80);
const MAX_SINGLE_SESSION_JUMP_PCT = Number(process.env.EGX_MAX_SINGLE_SESSION_JUMP_PCT || 35);
const EVIDENCE_CONCURRENCY = Math.max(2, Math.min(Number(process.env.EGX_SESSION_EVIDENCE_CONCURRENCY || 10), 16));
const EVIDENCE_TIMEOUT_MS = Number(process.env.EGX_SESSION_EVIDENCE_TIMEOUT_MS || 18000);
const PRECISE_SOURCE_PATTERN = /mubasher_symbol_pages_precise/i;
const FOCUS_TICKERS = ['AALR', 'ODIN', 'NIPH'];

// This fingerprint identifies the 2026-08-13 run that stamped fetch time as
// market-session time. It is deliberately narrow so older valid history is not
// rewritten. Fresh verified 2026-08-13 rows are re-created below from source
// pages that explicitly report the session date.
const CONTAMINATED_SESSION = '2026-08-13';
const CONTAMINATED_FETCH_PREFIX = '2026-08-13T21:21:32';

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

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = new Map([
  ['january', 1], ['jan', 1], ['february', 2], ['feb', 2], ['march', 3], ['mar', 3],
  ['april', 4], ['apr', 4], ['may', 5], ['june', 6], ['jun', 6], ['july', 7], ['jul', 7],
  ['august', 8], ['aug', 8], ['september', 9], ['sep', 9], ['sept', 9], ['october', 10], ['oct', 10],
  ['november', 11], ['nov', 11], ['december', 12], ['dec', 12]
]);
function parseSourceSessionDate(value, expectedSession) {
  const text = String(value || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const yearFallback = Number(String(expectedSession || '').slice(0, 4)) || new Date().getUTCFullYear();
  let match = text.match(/\b(\d{1,2})\s+(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)(?:\s+(20\d{2}))?\b/i);
  if (match) {
    const month = MONTHS.get(match[2].toLowerCase());
    const year = Number(match[3] || yearFallback);
    if (month) return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
  }
  match = text.match(/\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\s+(\d{1,2})(?:\s+(20\d{2}))?\b/i);
  if (match) {
    const month = MONTHS.get(match[1].toLowerCase());
    const year = Number(match[3] || yearFallback);
    if (month) return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  }
  return null;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVIDENCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        'accept-language': 'en-US,en;q=0.9,ar;q=0.7',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        referer: 'https://english.mubasher.info/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 EGXProV16SessionTruth/1.0'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return result;
}

function sourceUrlForRow(row) {
  return row?.sourceUrl || row?.sourceUrls?.primary || null;
}

async function establishRowSessionEvidence(row, expectedSession) {
  const symbol = normSymbol(row?.symbol || row?.ticker || row?.code);
  const existingText = row?.sourceMarketTime || row?.marketTime || null;
  const explicit = dateOnly(row?.sourceSessionDate || row?.marketSessionDate || row?.sessionDate)
    || parseSourceSessionDate(existingText, expectedSession);
  if (explicit) {
    return {
      ...row,
      sourceSessionDate: explicit,
      sourceMarketTime: existingText,
      sourceSessionEvidence: row?.sourceSessionEvidence || 'embedded_source_session',
      sourceSessionCheckedAt: new Date().toISOString()
    };
  }

  const url = sourceUrlForRow(row);
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      ...row,
      sourceSessionDate: null,
      sourceSessionEvidence: 'missing_source_url',
      sourceSessionCheckedAt: new Date().toISOString()
    };
  }

  try {
    const html = await fetchText(url);
    const plain = stripHtml(html);
    const match = plain.match(/Last update:\s*(.{1,120}?market time)/i);
    const sourceMarketTime = match ? match[1].trim() : null;
    const sourceSessionDate = parseSourceSessionDate(sourceMarketTime, expectedSession);
    return {
      ...row,
      sourceMarketTime,
      sourceSessionDate,
      sourceSessionEvidence: sourceSessionDate ? 'mubasher_page_last_update' : 'last_update_date_unparsed',
      sourceSessionCheckedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...row,
      sourceSessionDate: null,
      sourceSessionEvidence: 'source_evidence_fetch_failed',
      sourceSessionEvidenceError: error.message,
      sourceSessionCheckedAt: new Date().toISOString()
    };
  }
}

function repairKnownContaminatedHistory() {
  if (!fs.existsSync(HISTORY_DIR)) return { scannedFiles: 0, repairedFiles: 0, removedRows: 0, tickers: [] };
  let scannedFiles = 0;
  let repairedFiles = 0;
  let removedRows = 0;
  const tickers = [];

  for (const name of fs.readdirSync(HISTORY_DIR).filter(file => file.endsWith('.json'))) {
    scannedFiles++;
    const file = path.join(HISTORY_DIR, name);
    const document = readJson(file, null);
    if (!document || !Array.isArray(document.sessions)) continue;

    const before = document.sessions.length;
    document.sessions = document.sessions.filter(row => {
      const rowDate = dateOnly(row?.date || row?.sessionDate);
      const badRun = rowDate === CONTAMINATED_SESSION
        && String(row?.source || '') === 'v15_precise_public_price_truth'
        && /mubasher_symbol_pages_precise_enriched/i.test(String(row?.primarySource || ''))
        && String(row?.fetchedAt || '').startsWith(CONTAMINATED_FETCH_PREFIX)
        && !dateOnly(row?.sourceSessionDate);
      return !badRun;
    });

    const removed = before - document.sessions.length;
    if (!removed) continue;
    removedRows += removed;
    repairedFiles++;
    tickers.push(path.basename(name, '.json'));
    document.sessions.sort((a, b) => String(a.date || a.sessionDate).localeCompare(String(b.date || b.sessionDate)));
    document.firstSession = dateOnly(document.sessions[0]?.date || document.sessions[0]?.sessionDate);
    document.lastSession = dateOnly(document.sessions.at(-1)?.date || document.sessions.at(-1)?.sessionDate);
    document.availableSessions = document.sessions.length;
    const latest = document.sessions.at(-1);
    document.priceTruthLatest = latest ? {
      date: dateOnly(latest?.date || latest?.sessionDate),
      close: n(latest?.close),
      source: latest?.primarySource || latest?.source || null,
      validationStatus: latest?.validationStatus || null,
      confidence: n(latest?.confidence?.overall)
    } : null;
    document.generatedAt = new Date().toISOString();
    writeJson(file, document);
  }

  return { scannedFiles, repairedFiles, removedRows, tickers };
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
  const sourceSessionDate = dateOnly(row?.sourceSessionDate);
  if (!ticker) return { dropped: true, ticker: null, reason: 'INVALID_TICKER' };
  if (!sourceSessionDate) return { rejected: true, ticker, reason: 'SOURCE_SESSION_UNKNOWN' };
  if (sourceSessionDate !== expectedSession) {
    return { rejected: true, ticker, reason: 'SOURCE_SESSION_MISMATCH', sourceSessionDate, expectedSession };
  }

  const close = n(row?.price ?? row?.last ?? row?.close);
  if (!(close > 0)) return { dropped: true, ticker, reason: 'INVALID_CLOSE' };

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
      rejected: true, ticker, reason: 'EXTREME_JUMP_REQUIRES_SECOND_SOURCE',
      close: round(close), previousTrustedClose: round(priorTrusted), jumpPct: round(jumpPct, 2), source: sourceName,
      sourceSessionDate
    };
  }
  if (!changeConsistent) {
    return {
      rejected: true, ticker, reason: 'REPORTED_CHANGE_MISMATCH',
      close: round(close), previousClose: round(previousClose), reportedChangePct: round(reportedChangePct, 2),
      impliedChangePct: round(impliedChangePct, 2), source: sourceName, sourceSessionDate
    };
  }

  return {
    ticker,
    date: sourceSessionDate,
    sourceSessionDate,
    sourceMarketTime: row?.sourceMarketTime || null,
    sourceSessionEvidence: row?.sourceSessionEvidence || null,
    sourceSessionCheckedAt: row?.sourceSessionCheckedAt || null,
    open: round(open), high: round(high), low: round(low), close: round(close),
    adjustedClose: round(close), volume: round(volume, 0), currency: 'EGP',
    source: 'v16_session_aware_price_truth',
    primarySource: sourceName,
    officialVerified: false,
    verifiedBy: [sourceName, row?.sourceSessionEvidence || 'source_session_evidence'],
    sourceUrls: sourceUrlForRow(row) ? { primary: sourceUrlForRow(row), verification: [] } : undefined,
    fetchedAt: row?.updatedAt || generatedAt,
    validatedAt: new Date().toISOString(),
    confidence: { overall: 86, ohlc: hasCompleteOhlc ? 86 : 78, volume: volume > 0 ? 82 : 65, symbolIdentity: 95, sessionDate: 100 },
    validationStatus: 'precise_public_source_session_confirmed',
    warnings: hasCompleteOhlc ? [] : ['partial_ohlc_reconstructed_from_close_or_previous_close'],
    priceTruthMode: 'PRECISE_PUBLIC_SOURCE_WITH_EXPLICIT_SESSION_EVIDENCE',
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
      confidence: row.confidence.overall,
      sourceSessionDate: row.sourceSessionDate
    };
    writeJson(file, document);
    updated++;
  }
  return { updated, missingHistoryFiles };
}

async function main() {
  const expectedSession = expectedLatestCompletedSessionCairo();
  const repair = repairKnownContaminatedHistory();
  writeJson(REPAIR_PATH, {
    schemaVersion: '16.3.4-session-repair',
    generatedAt: new Date().toISOString(),
    contaminatedSession: CONTAMINATED_SESSION,
    contaminatedFetchPrefix: CONTAMINATED_FETCH_PREFIX,
    ...repair
  });

  const market = readJson(MARKET_PATH, {});
  const legacyStatus = readJson(FETCH_STATUS_PATH, {});
  const generatedAt = market?.generatedAt || market?.updatedAt || legacyStatus?.generatedAt || null;
  const sourceName = String(market?.source || legacyStatus?.sourceName || 'unknown');
  const inputRows = Array.isArray(market?.rows) ? market.rows : [];

  const evidencedRows = await mapLimit(inputRows, EVIDENCE_CONCURRENCY, row => establishRowSessionEvidence(row, expectedSession));
  market.rows = evidencedRows;
  market.sourceSessionEvidence = {
    expectedSession,
    checkedAt: new Date().toISOString(),
    totalRows: evidencedRows.length,
    matchingRows: evidencedRows.filter(row => dateOnly(row?.sourceSessionDate) === expectedSession).length,
    mismatchedRows: evidencedRows.filter(row => dateOnly(row?.sourceSessionDate) && dateOnly(row?.sourceSessionDate) !== expectedSession).length,
    unknownRows: evidencedRows.filter(row => !dateOnly(row?.sourceSessionDate)).length
  };
  market.sourceSessionEvidence.coveragePct = market.sourceSessionEvidence.totalRows
    ? round(market.sourceSessionEvidence.matchingRows / market.sourceSessionEvidence.totalRows * 100, 2)
    : 0;
  writeJson(MARKET_PATH, market);

  const preciseSource = PRECISE_SOURCE_PATTERN.test(sourceName);
  const realFetch = market?.ok === true && legacyStatus?.realFetch === true;
  const sameSessionRows = evidencedRows.filter(row => dateOnly(row?.sourceSessionDate) === expectedSession);
  const sourceEligible = preciseSource && realFetch && sameSessionRows.length >= MIN_EXECUTION_ROWS;

  const accepted = [];
  const rejected = [];
  const dropped = [];

  for (const row of evidencedRows) {
    const normalized = normalizeMarketRow(row, expectedSession, sourceName, generatedAt);
    if (normalized.rejected) rejected.push(normalized);
    else if (normalized.dropped) dropped.push(normalized);
    else if (sourceEligible) accepted.push(normalized);
  }

  if (!sourceEligible) {
    rejected.unshift({
      reason: 'SOURCE_SESSION_COVERAGE_NOT_EXECUTION_GRADE',
      expectedSession,
      sourceName,
      preciseSource,
      realFetch,
      inputRows: evidencedRows.length,
      matchingSourceSessionRows: sameSessionRows.length,
      minimumRows: MIN_EXECUTION_ROWS,
      sourceSessionEvidenceCoveragePct: market.sourceSessionEvidence.coveragePct
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

  const evidenceReport = {
    schemaVersion: '16.3.4-source-session-evidence',
    generatedAt: new Date().toISOString(),
    expectedSession,
    sourceName,
    totalRows: evidencedRows.length,
    matchingRows: market.sourceSessionEvidence.matchingRows,
    mismatchedRows: market.sourceSessionEvidence.mismatchedRows,
    unknownRows: market.sourceSessionEvidence.unknownRows,
    coveragePct: market.sourceSessionEvidence.coveragePct,
    minimumExecutionRows: MIN_EXECUTION_ROWS,
    readyForPriceTruth: sourceEligible,
    bySourceSession: Object.entries(evidencedRows.reduce((acc, row) => {
      const key = dateOnly(row?.sourceSessionDate) || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => a[0].localeCompare(b[0])).map(([session, count]) => ({ session, count })),
    staleSymbols: evidencedRows.filter(row => dateOnly(row?.sourceSessionDate) && dateOnly(row?.sourceSessionDate) !== expectedSession).map(row => ({
      ticker: normSymbol(row?.symbol || row?.ticker || row?.code),
      sourceSessionDate: dateOnly(row?.sourceSessionDate),
      sourceMarketTime: row?.sourceMarketTime || null
    })),
    unknownSymbols: evidencedRows.filter(row => !dateOnly(row?.sourceSessionDate)).map(row => normSymbol(row?.symbol || row?.ticker || row?.code)).filter(Boolean)
  };
  writeJson(EVIDENCE_PATH, evidenceReport);

  const report = {
    schemaVersion: '16.3.4-session-aware-price-truth',
    generatedAt: new Date().toISOString(),
    expectedSession,
    ready,
    executionGrade: ready,
    acceptanceMode: 'PRECISE_PUBLIC_SOURCE_WITH_EXPLICIT_SOURCE_SESSION_EVIDENCE',
    minimumExecutionRows: MIN_EXECUTION_ROWS,
    maximumSingleSessionJumpPct: MAX_SINGLE_SESSION_JUMP_PCT,
    source: {
      name: sourceName,
      fetchGeneratedAt: generatedAt,
      preciseSource,
      realFetch,
      inputRows: evidencedRows.length,
      verifiedExpectedSessionRows: sameSessionRows.length,
      sourceSessionEvidenceCoveragePct: market.sourceSessionEvidence.coveragePct
    },
    acceptedRows: acceptedRows.length,
    rejectedRows: rejected.length,
    droppedRows: dropped.length,
    updatedHistoryFiles: mergeResult.updated,
    missingHistoryFiles: mergeResult.missingHistoryFiles,
    repairedContaminatedRows: repair.removedRows,
    focusAudit: FOCUS_TICKERS.map(ticker => {
      const acceptedRow = acceptedMap.get(ticker);
      const rejectedRow = rejectedMap.get(ticker);
      const droppedRow = droppedMap.get(ticker);
      const history = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
      return {
        ticker,
        status: acceptedRow ? 'ACCEPTED' : rejectedRow ? 'REJECTED' : droppedRow ? 'DROPPED' : 'NOT_IN_MARKET',
        close: acceptedRow?.close ?? rejectedRow?.close ?? droppedRow?.close ?? null,
        sourceSessionDate: acceptedRow?.sourceSessionDate ?? rejectedRow?.sourceSessionDate ?? null,
        reason: rejectedRow?.reason ?? droppedRow?.reason ?? null,
        historyLastSession: history?.lastSession || null,
        historyLatestClose: history?.priceTruthLatest?.close ?? null
      };
    }),
    sampleAccepted: acceptedRows.slice(0, 40).map(row => ({
      ticker: row.ticker, close: row.close, sourceSessionDate: row.sourceSessionDate,
      previousTrustedClose: row.previousTrustedClose, jumpPct: row.jumpPct,
      mode: row.priceTruthMode, warnings: row.warnings
    })),
    sampleRejected: rejected.slice(0, 80),
    sampleDropped: dropped.slice(0, 50)
  };
  writeJson(OUT_PATH, report);

  writeJson(FETCH_STATUS_PATH, {
    ok: ready,
    realFetch,
    scriptExists: true,
    generatedAt: report.generatedAt,
    mode: ready ? 'v16_session_aware_public_execution_grade' : 'v16_source_session_not_ready',
    sourceName,
    sourceUrl: market?.sourceUrl || null,
    marketRows: acceptedRows.length,
    inputRows: evidencedRows.length,
    sourceSessionVerifiedRows: sameSessionRows.length,
    sourceSessionEvidenceCoveragePct: market.sourceSessionEvidence.coveragePct,
    coveragePct: evidencedRows.length ? round(acceptedRows.length / evidencedRows.length * 100, 2) : 0,
    message: ready
      ? `Accepted ${acceptedRows.length} EGX prices whose source explicitly reports session ${expectedSession}.`
      : `Session truth not ready: ${sameSessionRows.length}/${evidencedRows.length} source rows explicitly match ${expectedSession}; ${MIN_EXECUTION_ROWS} executable rows required.`,
    executionGrade: ready,
    expectedSession,
    currentSessionRows: acceptedRows.length,
    rejectedCurrentSessionRows: rejected.length,
    droppedCurrentSessionRows: dropped.length
  });

  console.log(JSON.stringify({
    expectedSession,
    sourceName,
    inputRows: evidencedRows.length,
    sourceSessionVerifiedRows: sameSessionRows.length,
    sourceSessionEvidenceCoveragePct: market.sourceSessionEvidence.coveragePct,
    acceptedRows: acceptedRows.length,
    rejectedRows: rejected.length,
    repairedContaminatedRows: repair.removedRows,
    ready,
    focusAudit: report.focusAudit
  }, null, 2));

  if (!ready) process.exitCode = 2;
}

main().catch(error => {
  const generatedAt = new Date().toISOString();
  const expectedSession = expectedLatestCompletedSessionCairo();
  writeJson(OUT_PATH, {
    schemaVersion: '16.3.4-session-aware-price-truth', generatedAt, expectedSession,
    ready: false, executionGrade: false, error: error.stack || error.message
  });
  writeJson(FETCH_STATUS_PATH, {
    ok: false, realFetch: false, scriptExists: true, generatedAt,
    mode: 'v16_session_aware_price_truth_exception', executionGrade: false,
    expectedSession, message: error.message
  });
  console.error(error);
  process.exitCode = 1;
});
