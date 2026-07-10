#!/usr/bin/env node
'use strict';

const path = require('path');
const { mergeAndValidate, validateSession } = require('./history-validator.cjs');
const { readHistory, writeHistory } = require('./history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const {
  nowIso,
  readJson,
  round,
  safeTicker,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'history-gap-diagnostics-config.json');
const IMPORT_PATH = path.join(DATA, 'history-approved-gap-import.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const REPORT_PATH = path.join(DATA, 'history-approved-gap-import-report.json');
const QUARANTINE_PATH = path.join(DATA, 'history-approved-gap-quarantine.json');
const QUEUE_PATH = path.join(DATA, 'history-approved-gap-queue.json');
const SOURCE_AUDIT_PATH = path.join(DATA, 'source-audit.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');
const ONLY_TICKER = safeTicker(process.env.APPROVED_GAP_TICKER || '');

function normalizeMap(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  const result = new Map();
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const ticker = safeTicker(item.ticker);
    if (ticker) result.set(ticker, { ...item, ticker });
  }
  return result;
}

function parseDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSession(ticker, raw, item, confidence, importedAt) {
  return {
    ticker,
    date: parseDate(raw.date),
    open: toFinite(raw.open),
    high: toFinite(raw.high),
    low: toFinite(raw.low),
    close: toFinite(raw.close),
    adjustedClose: raw.adjustedClose === null || raw.adjustedClose === undefined ? null : toFinite(raw.adjustedClose),
    volume: raw.volume === null || raw.volume === undefined || raw.volume === '' ? null : toFinite(raw.volume),
    currency: raw.currency || 'EGP',
    primarySource: item.source,
    officialVerified: item.source === 'egx_official' || (item.verificationSources || []).includes('egx_official'),
    verifiedBy: unique(item.verificationSources || []),
    sourceUrls: {
      primary: item.sourceUrl,
      verification: Array.isArray(item.verificationUrls) ? item.verificationUrls : [],
    },
    fetchedAt: raw.fetchedAt || importedAt,
    validatedAt: importedAt,
    confidence: {
      overall: confidence,
      ohlc: confidence,
      volume: raw.volume === null || raw.volume === undefined || raw.volume === '' ? 60 : confidence,
      symbolIdentity: item.identityVerifiedByAdmin ? 100 : 0,
    },
    validationStatus: item.source === 'egx_official'
      ? 'officially_verified_approved_import'
      : 'approved_gap_import_validated',
    warnings: unique([
      'approved_gap_import',
      item.source !== 'egx_official' ? 'not_officially_verified_by_egx' : null,
      raw.volume === null || raw.volume === undefined || raw.volume === '' ? 'volume_missing' : null,
    ]),
  };
}

function sourceConfidence(item, config) {
  const table = config.sourceConfidence || {};
  const source = String(item.source || '');
  let confidence = Number(table[source] || 0);
  const verification = unique(item.verificationSources || []);
  if (source === 'egx_official' || verification.includes('egx_official')) return 100;
  const independent = unique([source, ...verification].filter((value) => ['mubasher', 'investing', 'approved_csv'].includes(value)));
  if (independent.length >= 2) confidence = Math.max(confidence, 90);
  return Math.max(0, Math.min(100, confidence));
}

function averageConfidence(sessions) {
  const values = sessions.map((item) => Number(item?.confidence?.overall ?? item?.confidence ?? 0)).filter(Number.isFinite);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : 0;
}

function dateDiffDays(later, earlier) {
  if (!later || !earlier) return null;
  const a = new Date(`${later}T00:00:00Z`).getTime();
  const b = new Date(`${earlier}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

function updateSourceAudit(report) {
  const raw = readJson(SOURCE_AUDIT_PATH, { operations: [] });
  const operations = Array.isArray(raw) ? raw : (Array.isArray(raw?.operations) ? raw.operations : []);
  const records = report.results.map((item) => ({
    operation: 'approved_gap_import',
    ticker: item.ticker,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    status: item.status,
    source: item.source || null,
    rowsSubmitted: item.rowsSubmitted || 0,
    rowsAccepted: item.rowsAccepted || 0,
    appendedSessions: item.appendedSessions || 0,
    beforeSessions: item.beforeSessions || 0,
    afterSessions: item.afterSessions || 0,
    errors: item.error ? [item.error] : [],
    warnings: item.warnings || [],
  }));
  const merged = [...operations, ...records].slice(-4000);
  writeJsonAtomic(SOURCE_AUDIT_PATH, Array.isArray(raw) ? merged : {
    ...(raw && typeof raw === 'object' ? raw : {}),
    schemaVersion: '12.8.0',
    generatedAt: report.completedAt,
    lastOperation: records.at(-1) || null,
    operations: merged,
  });
}

function updateQueue(report) {
  const queue = readJson(QUEUE_PATH, null);
  if (!queue || !Array.isArray(queue.items)) return;
  const byTicker = new Map(report.results.map((item) => [item.ticker, item]));
  queue.generatedAt = report.completedAt;
  queue.items = queue.items.map((item) => {
    const result = byTicker.get(item.ticker);
    if (!result) return item;
    return {
      ...item,
      approvedImportStatus: result.status,
      importedSessions: result.appendedSessions || 0,
      lastImportAt: report.completedAt,
      lastImportError: result.error || null,
    };
  });
  writeJsonAtomic(QUEUE_PATH, queue);
}

async function main() {
  const startedAt = nowIso();
  const config = readJson(CONFIG_PATH, {});
  const payload = readJson(IMPORT_PATH, null);
  if (!payload || !Array.isArray(payload.imports)) throw new Error('Invalid data/history-approved-gap-import.json');
  const map = normalizeMap(readJson(MAP_PATH, {}));
  const summaryBefore = readJson(SUMMARY_PATH, {});
  const latestMarketSession = summaryBefore.latestMarketSession || null;
  const acceptedSources = new Set(config.acceptedImportSources || []);
  const approvedForImport = payload.approvedForImport === true;
  const imports = payload.imports.filter((item) => !ONLY_TICKER || safeTicker(item.ticker) === ONLY_TICKER);
  const quarantine = [];
  const results = [];

  for (const item of imports) {
    const ticker = safeTicker(item.ticker);
    const entry = map.get(ticker);
    const existing = readHistory(ROOT, ticker);
    const base = {
      ticker,
      status: 'skipped',
      source: item.source || null,
      rowsSubmitted: Array.isArray(item.sessions) ? item.sessions.length : 0,
      rowsAccepted: 0,
      appendedSessions: 0,
      beforeSessions: Array.isArray(existing?.sessions) ? existing.sessions.length : 0,
      afterSessions: Array.isArray(existing?.sessions) ? existing.sessions.length : 0,
      previousLastSession: existing?.lastSession || existing?.sessions?.at(-1)?.date || null,
      lastSession: existing?.lastSession || existing?.sessions?.at(-1)?.date || null,
      becameComplete100: false,
      recentEnough: false,
      warnings: [],
      error: null,
    };

    try {
      if (!approvedForImport) throw new Error('top_level_approvedForImport_is_false');
      if (!item.approved) throw new Error('ticker_not_approved');
      if (!item.identityVerifiedByAdmin) throw new Error('identity_not_verified_by_admin');
      if (!entry) throw new Error('ticker_missing_from_symbol_map');
      if (!existing || !Array.isArray(existing.sessions) || !existing.sessions.length) throw new Error('existing_history_missing');
      if (!acceptedSources.has(item.source)) throw new Error(`unapproved_source:${item.source || 'missing'}`);
      if (!String(item.sourceUrl || '').trim()) throw new Error('source_url_or_file_reference_missing');
      if (item.isin && entry.isin && String(item.isin).toUpperCase() !== String(entry.isin).toUpperCase()) throw new Error('isin_mismatch');
      if (!Array.isArray(item.sessions) || !item.sessions.length) throw new Error('no_sessions_submitted');

      const confidence = sourceConfidence(item, config);
      if (confidence < 65) throw new Error('source_confidence_below_import_threshold');
      const normalized = [];
      for (const raw of item.sessions) {
        const session = normalizeSession(ticker, raw, item, confidence, startedAt);
        const checked = validateSession(session);
        if (!checked.valid) {
          quarantine.push({ ticker, date: raw?.date || null, errors: checked.errors, row: raw });
          continue;
        }
        normalized.push(checked.session);
      }
      const existingLast = base.previousLastSession;
      const newer = normalized.filter((session) => session.date > existingLast);
      const duplicates = normalized.filter((session) => session.date <= existingLast);
      if (!newer.length) throw new Error('no_new_sessions_after_existing_last_date');

      const merged = mergeAndValidate(existing.sessions, newer, Number(config.targetSessions || 100));
      const lastSession = merged.sessions.at(-1)?.date || existingLast;
      const lag = latestMarketSession ? dateDiffDays(latestMarketSession, lastSession) : null;
      const recentEnough = lag !== null && lag <= Number(config.maxMarketSessionLagCalendarDays || 14);
      const becameComplete100 = base.beforeSessions < 100 && merged.sessions.length >= 100;
      const verificationSources = unique([
        ...(existing.verificationSources || []),
        item.source,
        ...(item.verificationSources || []),
      ]);
      const official = item.source === 'egx_official' || verificationSources.includes('egx_official');
      const warnings = unique([
        ...(existing.warnings || []).filter((warning) => warning !== 'historical_seed_requires_recent_gap_fill'),
        'approved_gap_import_applied',
        !official ? 'official_egx_verification_not_available' : null,
        !recentEnough ? `latest_session_lags_market:${lag ?? 'unknown'}_calendar_days` : null,
        duplicates.length ? `submitted_overlap_rows_ignored:${duplicates.length}` : null,
        ...merged.corporateActions.map(() => 'corporate_action_review_required'),
      ]);

      const next = {
        ...existing,
        schemaVersion: '12.8.0',
        generatedAt: nowIso(),
        availableSessions: merged.sessions.length,
        firstSession: merged.sessions[0]?.date || null,
        lastSession,
        historyStatus: historyStatus(merged.sessions.length),
        primarySource: 'mixed_history_with_approved_gap_import',
        verificationSources,
        officiallyVerifiedLatestSession: official,
        symbolVerified: true,
        averageConfidence: averageConfidence(merged.sessions),
        staleData: !recentEnough,
        updateFailed: false,
        lastUpdateError: null,
        warnings,
        approvedGapImport: {
          importedAt: startedAt,
          source: item.source,
          sourceUrl: item.sourceUrl,
          verificationSources: item.verificationSources || [],
          reviewedBy: payload.reviewedBy || null,
          reviewedAt: payload.reviewedAt || null,
          rowsSubmitted: item.sessions.length,
          rowsAccepted: newer.length,
          ignoredOverlapRows: duplicates.length,
        },
        sessions: merged.sessions,
      };
      writeHistory(ROOT, ticker, next);
      results.push({
        ...base,
        status: 'imported',
        rowsAccepted: newer.length,
        appendedSessions: newer.length,
        afterSessions: merged.sessions.length,
        lastSession,
        becameComplete100,
        recentEnough,
        warnings,
      });
    } catch (error) {
      results.push({ ...base, status: 'skipped', error: error.message });
    }
  }

  const activeEntries = [...map.values()].filter((entry) => entry.active !== false).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const summaryAfter = buildSummary(ROOT, activeEntries, summaryBefore.sources || {});
  buildSessionCalendar(ROOT, summaryAfter);
  const completedAt = nowIso();
  const report = {
    schemaVersion: '12.8.0',
    startedAt,
    completedAt,
    mode: 'approved_gap_import',
    approvedForImport,
    reviewedBy: payload.reviewedBy || null,
    reviewedAt: payload.reviewedAt || null,
    counts: {
      submittedTickers: imports.length,
      importedTickers: results.filter((item) => item.status === 'imported').length,
      skippedTickers: results.filter((item) => item.status !== 'imported').length,
      rowsSubmitted: results.reduce((sum, item) => sum + (item.rowsSubmitted || 0), 0),
      rowsAccepted: results.reduce((sum, item) => sum + (item.rowsAccepted || 0), 0),
      rowsQuarantined: quarantine.length,
      becameComplete100: results.filter((item) => item.becameComplete100).length,
      recentEnough: results.filter((item) => item.status === 'imported' && item.recentEnough).length,
    },
    coverageBefore: summaryBefore.coverage || null,
    coverageAfter: summaryAfter.coverage || null,
    results,
    warnings: [
      'Existing stored sessions always win on duplicate dates.',
      'Only valid sessions after each existing lastSession are appended.',
      'Confidence reflects source and verification evidence; only EGX official verification may reach 100.',
    ],
  };
  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(QUARANTINE_PATH, {
    schemaVersion: '12.8.0', generatedAt: completedAt, total: quarantine.length, rows: quarantine,
  });
  updateSourceAudit(report);
  updateQueue(report);
  writeJsonAtomic(LAST_RUN_PATH, {
    schemaVersion: '12.8.0',
    generatedAt: completedAt,
    mode: 'approved_gap_import',
    succeededTickers: results.filter((item) => item.status === 'imported').map((item) => item.ticker),
    failed: results.filter((item) => item.status !== 'imported').map((item) => ({ ticker: item.ticker, error: item.error })),
  });
  console.log(`V12.8 approved import complete: ${report.counts.importedTickers} tickers, ${report.counts.rowsAccepted} sessions.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
