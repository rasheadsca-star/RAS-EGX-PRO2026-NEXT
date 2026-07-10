#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  fetchTargetedTicker,
  evaluateSparseEvidence,
  analyzeAdjustment,
  scaleRows,
} = require('./adapters/starta-targeted-adapter.cjs');
const { mergeAndValidate } = require('./history-validator.cjs');
const { readHistory, writeHistory } = require('./history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const { nowIso, readJson, round, safeTicker, sleep, unique, writeJsonAtomic } = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'history-targeted-seven-config.json');
const APPROVAL_PATH = path.join(DATA, 'history-adjustment-approval.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const REPORT_PATH = path.join(DATA, 'history-targeted-seven-report.json');
const QUARANTINE_PATH = path.join(DATA, 'history-targeted-seven-quarantine.json');
const SOURCE_AUDIT_PATH = path.join(DATA, 'source-audit.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');
const QUEUE_PATH = path.join(DATA, 'history-approved-gap-queue.json');
const MODE = String(process.env.TARGETED_REPAIR_MODE || 'safe_apply');
const ONLY_TICKER = safeTicker(process.env.TARGETED_REPAIR_TICKER || '');

function mapEntries(raw) {
  return Array.isArray(raw) ? raw : Object.values(raw || {});
}

function normalizeMap(raw) {
  const map = new Map();
  for (const item of mapEntries(raw)) {
    const ticker = safeTicker(item?.ticker);
    if (ticker) map.set(ticker, { ...item, ticker });
  }
  return map;
}

function serializeMap(original, map) {
  if (Array.isArray(original)) {
    return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  const output = {};
  const originalKeys = Object.keys(original || {});
  for (const key of originalKeys) {
    const ticker = safeTicker(original[key]?.ticker || key);
    if (ticker && map.has(ticker)) output[key] = map.get(ticker);
    else output[key] = original[key];
  }
  for (const [ticker, entry] of map.entries()) {
    if (!Object.values(output).some((item) => safeTicker(item?.ticker) === ticker)) output[ticker] = entry;
  }
  return output;
}

function averageConfidence(sessions) {
  const values = (sessions || [])
    .map((item) => Number(item?.confidence?.overall ?? item?.confidence ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : 0;
}

function dateDiffDays(later, earlier) {
  if (!later || !earlier) return null;
  const a = new Date(`${later}T00:00:00Z`).getTime();
  const b = new Date(`${earlier}T00:00:00Z`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 86400000) : null;
}

function updateQueue(report) {
  const queue = readJson(QUEUE_PATH, null);
  if (!queue || !Array.isArray(queue.items)) return;
  const byTicker = new Map(report.results.map((item) => [item.ticker, item]));
  queue.generatedAt = report.completedAt;
  queue.items = queue.items
    .map((item) => {
      const result = byTicker.get(item.ticker);
      if (!result) return item;
      return {
        ...item,
        v13Status: result.status,
        v13Method: result.evidence?.method || result.action || null,
        v13LastAttemptAt: result.completedAt,
        v13LastError: result.error || null,
        approvedImportStatus:
          result.status === 'improved'
            ? 'completed_by_v13_targeted_repair'
            : result.status === 'inactive_delisted'
              ? 'not_required_instrument_delisted'
              : item.approvedImportStatus,
      };
    })
    .filter((item) => item.ticker !== report.delistedInstrument?.ticker);
  writeJsonAtomic(QUEUE_PATH, queue);
}

function updateAudit(report) {
  const raw = readJson(SOURCE_AUDIT_PATH, { operations: [] });
  const operations = Array.isArray(raw) ? raw : (Array.isArray(raw?.operations) ? raw.operations : []);
  const records = report.results.map((item) => ({
    operation: 'v13_targeted_seven_repair',
    ticker: item.ticker,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    status: item.status,
    action: item.action || null,
    evidence: item.evidence || null,
    errors: item.error ? [item.error] : [],
    warnings: item.warnings || [],
  }));
  const merged = [...operations, ...records].slice(-5000);
  writeJsonAtomic(SOURCE_AUDIT_PATH, Array.isArray(raw) ? merged : {
    ...(raw || {}),
    schemaVersion: '13.0.0',
    generatedAt: report.completedAt,
    lastOperation: records.at(-1) || null,
    operations: merged,
  });
}

function approvalByTicker(raw) {
  const entries = Array.isArray(raw?.items) ? raw.items : [];
  return new Map(entries.map((item) => [safeTicker(item.ticker), item]));
}

function deactivateDelistedInstrument(target, symbolMap, originalMap, results, summaryBefore) {
  const ticker = safeTicker(target.ticker);
  const startedAt = nowIso();
  const entry = symbolMap.get(ticker);
  if (!entry) {
    results.push({ ticker, startedAt, completedAt: nowIso(), status: 'failed', action: 'delisting_cleanup', error: 'ticker_missing_from_symbol_map', warnings: [] });
    return null;
  }
  const nextEntry = {
    ...entry,
    active: false,
    instrumentStatus: 'delisted',
    excludeFromDecision: true,
    delistedAt: target.delistedAt,
    delistingSource: target.delistingSource,
    delistingSourceUrl: target.delistingSourceUrl,
    lastVerifiedAt: nowIso(),
    statusReason: 'official_egx_final_delisting',
  };
  symbolMap.set(ticker, nextEntry);
  const history = readHistory(ROOT, ticker);
  if (history) {
    writeHistory(ROOT, ticker, {
      ...history,
      schemaVersion: '13.0.0',
      generatedAt: nowIso(),
      historyStatus: 'inactive_delisted',
      staleData: true,
      updateFailed: false,
      eligibleForDecision: false,
      instrumentStatus: 'delisted',
      delistedAt: target.delistedAt,
      delistingSourceUrl: target.delistingSourceUrl,
      warnings: unique([...(history.warnings || []), `official_egx_final_delisting:${target.delistedAt}`]),
    });
  }
  results.push({
    ticker,
    startedAt,
    completedAt: nowIso(),
    status: 'inactive_delisted',
    action: 'removed_from_active_universe',
    beforeActive: entry.active !== false,
    afterActive: false,
    source: target.delistingSource,
    sourceUrl: target.delistingSourceUrl,
    warnings: ['historical_file_preserved_for_audit', 'excluded_from_trading_decision_and_coverage_denominator'],
    error: null,
  });
  return { ticker, delistedAt: target.delistedAt, sourceUrl: target.delistingSourceUrl, denominatorBefore: summaryBefore?.coverage?.denominator || null };
}

async function processSparseTarget(target, mapEntry, config, latestMarketSession, quarantine) {
  const ticker = safeTicker(target.ticker);
  const startedAt = nowIso();
  const existing = readHistory(ROOT, ticker);
  const beforeSessions = Array.isArray(existing?.sessions) ? existing.sessions.length : 0;
  const previousLastSession = existing?.lastSession || existing?.sessions?.at(-1)?.date || null;
  const base = {
    ticker,
    startedAt,
    completedAt: null,
    status: 'failed',
    action: 'sparse_extended_overlap_repair',
    beforeSessions,
    afterSessions: beforeSessions,
    previousLastSession,
    lastSession: previousLastSession,
    rowsReceived: 0,
    appendedSessions: 0,
    becameComplete100: false,
    recentEnough: false,
    evidence: null,
    identity: null,
    sourceUrl: null,
    warnings: [],
    error: null,
  };
  try {
    if (!mapEntry) throw new Error('ticker_missing_from_symbol_map');
    if (!existing || !Array.isArray(existing.sessions) || !existing.sessions.length) throw new Error('existing_history_missing');
    const fetched = await fetchTargetedTicker(ticker, mapEntry, target, config);
    base.rowsReceived = fetched.rows.length + fetched.rejected.length;
    base.identity = fetched.identity;
    base.sourceUrl = fetched.sourceUrl;
    quarantine.push(...fetched.rejected.map((row) => ({ ...row, source: 'starta_targeted_ohlc' })));
    const boundedRows = fetched.rows.filter((row) => !latestMarketSession || row.date <= latestMarketSession);
    const evidence = evaluateSparseEvidence(existing.sessions, boundedRows, fetched.identity, config);
    base.evidence = evidence;
    if (!evidence.accepted) throw new Error(`targeted_evidence_failed:${JSON.stringify({ exact: evidence.exact, shifted: evidence.shifted, bridge: evidence.bridge })}`);
    const newer = boundedRows.filter((row) => row.date > previousLastSession);
    if (newer.length < Number(config.minimumNewSessions || 1)) throw new Error('no_new_valid_sessions_after_existing_last_date');
    if (MODE === 'diagnose') {
      return { ...base, completedAt: nowIso(), status: 'diagnosed_ready', appendedSessions: newer.length, lastSession: newer.at(-1)?.date || previousLastSession };
    }
    const merged = mergeAndValidate(existing.sessions, newer, Number(config.targetSessions || 100));
    quarantine.push(...merged.quarantine.map((row) => ({ ...row, source: 'v13_merged_history_validation' })));
    const lastSession = merged.sessions.at(-1)?.date || previousLastSession;
    const lag = latestMarketSession ? dateDiffDays(latestMarketSession, lastSession) : null;
    const recentEnough = lag !== null && lag <= Number(config.maxMarketLagCalendarDays || 21);
    const becameComplete100 = beforeSessions < 100 && merged.sessions.length >= 100;
    const warnings = unique([
      ...(existing.warnings || []).filter((warning) => !['historical_seed_requires_recent_gap_fill','latest_session_stale'].includes(warning)),
      'v13_targeted_sparse_repair_applied',
      `v13_evidence_method:${evidence.method}`,
      'non_official_public_database_fallback',
      'not_independently_verified_by_egx',
      !recentEnough ? `latest_session_lags_market:${lag ?? 'unknown'}_calendar_days` : null,
      ...merged.corporateActions.map(() => 'corporate_action_review_required'),
    ]);
    writeHistory(ROOT, ticker, {
      ...existing,
      schemaVersion: '13.0.0',
      generatedAt: nowIso(),
      availableSessions: merged.sessions.length,
      firstSession: merged.sessions[0]?.date || null,
      lastSession,
      historyStatus: historyStatus(merged.sessions.length),
      primarySource: 'mixed_history_with_starta_targeted_repair',
      verificationSources: unique([...(existing.verificationSources || []), 'starta_exact_symbol_isin_targeted_evidence']),
      officiallyVerifiedLatestSession: false,
      symbolVerified: true,
      averageConfidence: averageConfidence(merged.sessions),
      staleData: !recentEnough,
      updateFailed: false,
      lastUpdateError: null,
      eligibleForDecision: recentEnough && merged.sessions.length >= 50,
      warnings,
      v13TargetedRepair: {
        importedAt: nowIso(),
        source: 'starta_ohlc_api',
        sourceUrl: fetched.sourceUrl,
        periodUsed: fetched.period,
        identityEvidence: fetched.identity,
        sparseEvidence: evidence,
        rowsReceived: base.rowsReceived,
        rowsAccepted: newer.length,
        confidenceCap: Number(config.sourceConfidence || 70),
      },
      sessions: merged.sessions,
    });
    return {
      ...base,
      completedAt: nowIso(),
      status: 'improved',
      afterSessions: merged.sessions.length,
      appendedSessions: newer.length,
      lastSession,
      becameComplete100,
      recentEnough,
      warnings,
    };
  } catch (error) {
    return { ...base, completedAt: nowIso(), status: 'failed', error: error.message, details: error.details || null, warnings: ['existing_history_preserved_unchanged'] };
  }
}

async function processAdjustmentTarget(target, mapEntry, config, approval, latestMarketSession, quarantine) {
  const ticker = safeTicker(target.ticker);
  const startedAt = nowIso();
  const existing = readHistory(ROOT, ticker);
  const beforeSessions = Array.isArray(existing?.sessions) ? existing.sessions.length : 0;
  const previousLastSession = existing?.lastSession || existing?.sessions?.at(-1)?.date || null;
  const base = {
    ticker,
    startedAt,
    completedAt: null,
    status: 'failed',
    action: 'stable_adjustment_factor_review',
    beforeSessions,
    afterSessions: beforeSessions,
    previousLastSession,
    lastSession: previousLastSession,
    appendedSessions: 0,
    adjustment: null,
    approval: approval || null,
    sourceUrl: null,
    warnings: [],
    error: null,
  };
  try {
    if (!mapEntry) throw new Error('ticker_missing_from_symbol_map');
    if (!existing || !Array.isArray(existing.sessions) || !existing.sessions.length) throw new Error('existing_history_missing');
    const fetched = await fetchTargetedTicker(ticker, mapEntry, target, config);
    base.sourceUrl = fetched.sourceUrl;
    quarantine.push(...fetched.rejected.map((row) => ({ ...row, source: 'starta_adjustment_review' })));
    const boundedRows = fetched.rows.filter((row) => !latestMarketSession || row.date <= latestMarketSession);
    const adjustment = analyzeAdjustment(existing.sessions, boundedRows, config);
    base.adjustment = adjustment;
    if (!adjustment.stable) throw new Error('stable_adjustment_factor_not_established');
    const newerRaw = boundedRows.filter((row) => row.date > previousLastSession);
    if (MODE !== 'apply_approved_adjustments') {
      return {
        ...base,
        completedAt: nowIso(),
        status: 'manual_approval_required',
        action: 'stable_adjustment_factor_detected_no_write',
        proposedNewSessions: newerRaw.length,
        warnings: ['no_history_changed', 'corporate_action_or_adjusted_close_review_required'],
      };
    }
    if (!approval?.approved || !approval?.reviewedBy || !approval?.reviewedAt || !Array.isArray(approval?.sourceUrls) || !approval.sourceUrls.length) {
      throw new Error('adjustment_factor_not_admin_approved_with_source_evidence');
    }
    const approvedFactor = Number(approval.factor);
    if (!(approvedFactor > 0)) throw new Error('invalid_approved_adjustment_factor');
    const differencePct = Math.abs(approvedFactor - adjustment.factor) / adjustment.factor * 100;
    if (differencePct > Number(config.approvedFactorMaximumDifferencePct || 0.5)) {
      throw new Error(`approved_factor_differs_from_detected:${round(differencePct, 6)}%`);
    }
    const scaled = scaleRows(newerRaw, approvedFactor, ticker, approval);
    if (scaled.length < Number(config.minimumNewSessions || 1)) throw new Error('no_new_valid_sessions_after_existing_last_date');
    const merged = mergeAndValidate(existing.sessions, scaled, Number(config.targetSessions || 100));
    quarantine.push(...merged.quarantine.map((row) => ({ ...row, source: 'v13_adjusted_merge_validation' })));
    const lastSession = merged.sessions.at(-1)?.date || previousLastSession;
    const lag = latestMarketSession ? dateDiffDays(latestMarketSession, lastSession) : null;
    const recentEnough = lag !== null && lag <= Number(config.maxMarketLagCalendarDays || 21);
    const warnings = unique([
      ...(existing.warnings || []),
      'v13_admin_approved_adjustment_factor_applied',
      'not_officially_verified_by_egx',
      !recentEnough ? `latest_session_lags_market:${lag ?? 'unknown'}_calendar_days` : null,
    ]);
    writeHistory(ROOT, ticker, {
      ...existing,
      schemaVersion: '13.0.0',
      generatedAt: nowIso(),
      availableSessions: merged.sessions.length,
      firstSession: merged.sessions[0]?.date || null,
      lastSession,
      historyStatus: historyStatus(merged.sessions.length),
      primarySource: 'mixed_history_with_admin_approved_adjustment_factor',
      verificationSources: unique([...(existing.verificationSources || []), 'admin_reviewed_adjustment_source']),
      officiallyVerifiedLatestSession: false,
      averageConfidence: Math.min(65, averageConfidence(merged.sessions)),
      staleData: !recentEnough,
      updateFailed: false,
      lastUpdateError: null,
      eligibleForDecision: false,
      warnings,
      v13AdjustmentRepair: {
        importedAt: nowIso(),
        sourceUrl: fetched.sourceUrl,
        detectedAdjustment: adjustment,
        approvedFactor,
        approval,
        rowsAccepted: scaled.length,
      },
      sessions: merged.sessions,
    });
    return {
      ...base,
      completedAt: nowIso(),
      status: 'improved_with_admin_approval',
      action: 'approved_adjustment_factor_applied',
      afterSessions: merged.sessions.length,
      appendedSessions: scaled.length,
      lastSession,
      recentEnough,
      warnings,
    };
  } catch (error) {
    return { ...base, completedAt: nowIso(), status: 'failed', error: error.message, details: error.details || null, warnings: ['existing_history_preserved_unchanged'] };
  }
}

async function main() {
  const startedAt = nowIso();
  const config = readJson(CONFIG_PATH, null);
  if (!config || !Array.isArray(config.targets)) throw new Error('Invalid data/history-targeted-seven-config.json');
  const originalMap = readJson(MAP_PATH, {});
  const symbolMap = normalizeMap(originalMap);
  const approvalMap = approvalByTicker(readJson(APPROVAL_PATH, { items: [] }));
  const summaryBefore = readJson(SUMMARY_PATH, {});
  const latestMarketSession = summaryBefore.latestMarketSession || null;
  const results = [];
  const quarantine = [];
  let delistedInstrument = null;

  for (let index = 0; index < config.targets.length; index += 1) {
    const target = config.targets[index];
    const ticker = safeTicker(target.ticker);
    if (ONLY_TICKER && ticker !== ONLY_TICKER) continue;
    if (target.strategy === 'official_delisting_cleanup') {
      if (MODE !== 'diagnose') delistedInstrument = deactivateDelistedInstrument(target, symbolMap, originalMap, results, summaryBefore);
      else results.push({ ticker, startedAt: nowIso(), completedAt: nowIso(), status: 'diagnosed_delisted', action: 'would_remove_from_active_universe', sourceUrl: target.delistingSourceUrl, warnings: [], error: null });
    } else if (target.strategy === 'stable_adjustment_review') {
      results.push(await processAdjustmentTarget(target, symbolMap.get(ticker), config, approvalMap.get(ticker), latestMarketSession, quarantine));
    } else if (target.strategy === 'sparse_extended_overlap') {
      results.push(await processSparseTarget(target, symbolMap.get(ticker), config, latestMarketSession, quarantine));
    }
    if (index < config.targets.length - 1) await sleep(Number(config.delayBetweenTickersMs || 1000));
  }

  if (MODE !== 'diagnose' && delistedInstrument) writeJsonAtomic(MAP_PATH, serializeMap(originalMap, symbolMap));
  const activeEntries = [...symbolMap.values()].filter((entry) => entry.active !== false).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const summaryAfter = MODE === 'diagnose'
    ? summaryBefore
    : buildSummary(ROOT, activeEntries, {
        ...(summaryBefore.sources || {}),
        startaTargeted: { status: 'targeted_non_official_fallback', role: 'extended sparse repair and adjustment diagnostics' },
      });
  if (MODE !== 'diagnose') buildSessionCalendar(ROOT, summaryAfter);
  const completedAt = nowIso();
  const report = {
    schemaVersion: '13.0.0',
    startedAt,
    completedAt,
    mode: MODE,
    latestMarketSession,
    source: {
      name: 'Starta Markets public EGX OHLC API',
      role: 'targeted sparse repair and adjustment diagnostics',
      officialEgxVerified: false,
      confidenceCap: Number(config.sourceConfidence || 70),
    },
    delistedInstrument,
    counts: {
      selected: results.length,
      improved: results.filter((item) => ['improved','improved_with_admin_approval'].includes(item.status)).length,
      manualApprovalRequired: results.filter((item) => item.status === 'manual_approval_required').length,
      inactiveDelisted: results.filter((item) => item.status === 'inactive_delisted').length,
      failed: results.filter((item) => item.status === 'failed').length,
      appendedSessions: results.reduce((sum, item) => sum + (item.appendedSessions || 0), 0),
      becameComplete100: results.filter((item) => item.becameComplete100).length,
    },
    coverageBefore: summaryBefore.coverage || null,
    coverageAfter: summaryAfter.coverage || null,
    summaryAfter: {
      symbolsTotal: summaryAfter.symbolsTotal ?? summaryBefore.symbolsTotal,
      symbolsComplete100: summaryAfter.symbolsComplete100 ?? summaryBefore.symbolsComplete100,
      symbolsComplete50: summaryAfter.symbolsComplete50 ?? summaryBefore.symbolsComplete50,
      symbolsFailed: summaryAfter.symbolsFailed ?? summaryBefore.symbolsFailed,
      averageConfidence: summaryAfter.averageConfidence ?? summaryBefore.averageConfidence,
      latestMarketSession: summaryAfter.latestMarketSession ?? summaryBefore.latestMarketSession,
    },
    results,
    warnings: [
      'Sparse repairs require exact EGX identity and ISIN plus overlap, shifted overlap, or a conservative contiguous bridge.',
      'EGSA and FAITA are never adjusted automatically; a stable factor is only reported until explicit reviewed approval is supplied.',
      'ESRS is excluded from the active universe based on official EGX final delisting while its historical file is preserved for audit.',
      'This source is not the official EGX and cannot receive 100% confidence.',
    ],
  };
  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(QUARANTINE_PATH, { schemaVersion: '13.0.0', generatedAt: completedAt, total: quarantine.length, rows: quarantine });
  if (MODE !== 'diagnose') {
    updateAudit(report);
    updateQueue(report);
    writeJsonAtomic(LAST_RUN_PATH, {
      schemaVersion: '13.0.0',
      generatedAt: completedAt,
      mode: 'v13_targeted_seven_repair',
      succeededTickers: results.filter((item) => ['improved','improved_with_admin_approval','inactive_delisted'].includes(item.status)).map((item) => item.ticker),
      pendingApproval: results.filter((item) => item.status === 'manual_approval_required').map((item) => ({ ticker: item.ticker, factor: item.adjustment?.factor || null })),
      failed: results.filter((item) => item.status === 'failed').map((item) => ({ ticker: item.ticker, error: item.error })),
    });
  }
  console.log(`V13.0 ${MODE}: improved=${report.counts.improved}, approval=${report.counts.manualApprovalRequired}, delisted=${report.counts.inactiveDelisted}, failed=${report.counts.failed}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
