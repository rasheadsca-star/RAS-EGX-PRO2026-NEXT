#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateSession } = require('./history-validator.cjs');
const { readJson, safeTicker } = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const report = readJson(path.join(DATA, 'history-targeted-seven-report.json'), null);
const config = readJson(path.join(DATA, 'history-targeted-seven-config.json'), null);
const symbolMapRaw = readJson(path.join(DATA, 'symbol-map.json'), {});
const mode = String(process.env.TARGETED_REPAIR_MODE || 'safe_apply');
const minimum = Number(process.env.TARGETED_REPAIR_MIN_IMPROVED || 0);
const onlyTicker = safeTicker(process.env.TARGETED_REPAIR_TICKER || '');
const errors = [];

function mapEntries(raw) {
  return Array.isArray(raw) ? raw : Object.values(raw || {});
}

if (!report || report.schemaVersion !== '13.0.0') errors.push('missing_or_invalid_report');
if (!config || !Array.isArray(config.targets)) errors.push('missing_or_invalid_config');
if (report?.mode !== mode) errors.push(`report_mode_mismatch:${report?.mode}:${mode}`);
if (mode !== 'diagnose' && Number(report?.counts?.improved || 0) < minimum) {
  errors.push(`improved_below_minimum:${report?.counts?.improved || 0}<${minimum}`);
}

for (const result of report?.results || []) {
  const ticker = safeTicker(result.ticker);
  if (!ticker) { errors.push('result_missing_ticker'); continue; }
  if (!['improved','improved_with_admin_approval'].includes(result.status)) continue;
  const file = path.join(DATA, 'history', `${ticker}.json`);
  if (!fs.existsSync(file)) { errors.push(`${ticker}:history_file_missing`); continue; }
  const document = readJson(file, null);
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  if (!sessions.length || sessions.length > 100) errors.push(`${ticker}:invalid_session_count:${sessions.length}`);
  const dates = sessions.map((item) => item.date);
  if (new Set(dates).size !== dates.length) errors.push(`${ticker}:duplicate_dates`);
  if (JSON.stringify([...dates].sort()) !== JSON.stringify(dates)) errors.push(`${ticker}:dates_not_sorted`);
  for (const session of sessions) {
    const checked = validateSession(session);
    if (!checked.valid) errors.push(`${ticker}:${session.date}:${checked.errors.join(',')}`);
  }
  if (document.officiallyVerifiedLatestSession === true) errors.push(`${ticker}:incorrect_official_verification_flag`);
  if (result.status === 'improved') {
    const marker = document?.v13TargetedRepair;
    if (!marker) errors.push(`${ticker}:missing_v13_targeted_repair_marker`);
    if (!marker?.identityEvidence?.exactSymbol) errors.push(`${ticker}:missing_exact_symbol_evidence`);
    if (!marker?.identityEvidence?.exactIsin) errors.push(`${ticker}:missing_exact_isin_evidence`);
    if (!marker?.sparseEvidence?.accepted) errors.push(`${ticker}:missing_accepted_sparse_evidence`);
  }
  if (result.status === 'improved_with_admin_approval') {
    if (!document?.v13AdjustmentRepair?.approval?.reviewedBy) errors.push(`${ticker}:missing_adjustment_reviewer`);
    if (document?.eligibleForDecision !== false) errors.push(`${ticker}:adjusted_history_must_remain_non_executable`);
  }
}

if (mode !== 'diagnose' && (!onlyTicker || onlyTicker === 'ESRS')) {
  const esrs = mapEntries(symbolMapRaw).find((item) => safeTicker(item?.ticker) === 'ESRS');
  if (!esrs) errors.push('ESRS:missing_from_symbol_map');
  else {
    if (esrs.active !== false) errors.push('ESRS:not_deactivated');
    if (esrs.instrumentStatus !== 'delisted') errors.push('ESRS:not_marked_delisted');
    if (esrs.excludeFromDecision !== true) errors.push('ESRS:not_excluded_from_decision');
  }
  const esrsHistory = readJson(path.join(DATA, 'history', 'ESRS.json'), null);
  if (esrsHistory) {
    if (esrsHistory.historyStatus !== 'inactive_delisted') errors.push('ESRS:history_status_not_inactive_delisted');
    if (esrsHistory.eligibleForDecision !== false) errors.push('ESRS:history_not_excluded_from_decision');
  }
}

for (const result of report?.results || []) {
  if (result.status === 'manual_approval_required') {
    if (result.appendedSessions) errors.push(`${result.ticker}:manual_review_must_not_write_sessions`);
    if (!result.adjustment?.stable) errors.push(`${result.ticker}:manual_review_without_stable_factor`);
  }
}

if (errors.length) {
  console.error('V13.0 acceptance failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`V13.0 acceptance passed. mode=${mode}; improved=${report?.counts?.improved || 0}; approval=${report?.counts?.manualApprovalRequired || 0}; failed=${report?.counts?.failed || 0}`);
