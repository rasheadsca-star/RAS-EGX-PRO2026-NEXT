#!/usr/bin/env node
// Trigger marker: validate DCCC/POCO documented temporary-listing no-trade exceptions.
// Trigger marker: recertify ARVA->AMII identity and reviewed Sep-17 no-trade exceptions.
// Trigger marker: validate NDRL cross-verified 2026-09-17 legitimate no-trade exception.
// Trigger marker: validate SAIB cross-verified 2026-09-17 legitimate no-trade exception.
// Trigger marker: validate GPPL cross-verified 2026-09-17 legitimate no-trade exception.
// Trigger marker: validate MEGM no-trade exception and POCO exact identity evidence.
// Trigger marker: recertify corrected current stale accounting after legitimate-session exception.
// Trigger marker: validate EPPK regulator-documented legitimate suspension exception.
// Trigger marker: recertify after evidence-backed IRAX/TORA legacy scope retirement.
// Trigger marker: rerun current-session closure after SecurityMaster alias dedup and EHDR persistence.
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { readHistory, writeHistory } = require('../../scripts/history/history-storage.cjs');
const { validateCurrentRow } = require('../../scripts/history/adapters/g11-approved-current-source-adapter.cjs');
const { readJson, safeTicker, writeJsonAtomic } = require('../../scripts/history/lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => readJson(R(p), d);
const write = (p, v) => writeJsonAtomic(R(p), v);
const expected = String(process.env.EXPECTED_SESSION || '').slice(0, 10);
const evaluatedAt = process.env.G11_EVALUATED_AT || new Date().toISOString();
if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error(`EXPECTED_SESSION missing/invalid: ${expected}`);

function mapRows(raw) {
  return Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
}
function dateOnly(v) { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
function validCurrent(doc) {
  const row = (doc?.sessions || []).find((s) => dateOnly(s.date || s.sessionDate) === expected);
  if (!row || doc?.symbolVerified !== true) return false;
  return validateCurrentRow({
    sessionDate: expected,
    open:Number(row.open), high:Number(row.high), low:Number(row.low), close:Number(row.close),
    volume:row.volume === null || row.volume === undefined ? null : Number(row.volume),
  }, expected).ok;
}

function runDynamicReviewedPreflight() {
  const result = cp.spawnSync(process.execPath, [R('astra/data-health/g11-current-reviewed-import-preflight.cjs')], {
    cwd:ROOT,
    stdio:'inherit',
    env:{...process.env, EXPECTED_SESSION:expected, G11_EVALUATED_AT:evaluatedAt},
  });
  if (result.status !== 0) throw new Error(`dynamic_reviewed_import_preflight_failed:${result.status}`);
}

function findClosureRecord(closureRun, ticker) {
  const groups = [closureRun?.noncoverage?.records, closureRun?.invalidSource?.records, closureRun?.stale?.records];
  for (const records of groups) {
    const found = (records || []).find((x) => safeTicker(x?.ticker) === ticker);
    if (found) return found;
  }
  return null;
}

function normalizeResolvedReviewedRows() {
  const preflight = read('docs/astra/G11_CURRENT_REVIEWED_IMPORT_PREFLIGHT.json', { acceptedCurrentTickers:[] });
  const staged = read('data/history-fallback-import.json', { records:[] });
  const closureRun = read('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json', null);
  if (!closureRun) throw new Error('approved_source_closure_evidence_missing_before_reviewed_normalization');
  const normalized = [];
  const unresolved = [];
  const logicalEvidence = [];

  for (const tickerRaw of preflight.acceptedCurrentTickers || []) {
    const ticker = safeTicker(tickerRaw);
    const stagedRecord = (staged.records || []).find((x) => safeTicker(x.ticker) === ticker && x.approved === true && x.symbolVerified === true);
    const stagedRow = (stagedRecord?.sessions || []).find((x) => dateOnly(x.date || x.sessionDate) === expected);
    if (!stagedRecord || !stagedRow) throw new Error(`reviewed_staging_missing_after_preflight:${ticker}`);

    const doc = readHistory(ROOT, ticker);
    const current = (doc?.sessions || []).find((x) => dateOnly(x.date || x.sessionDate) === expected);
    if (!current) {
      unresolved.push({ ticker, reason:'NO_CANONICAL_CURRENT_ROW_AFTER_APPROVED_SOURCE_CLOSURE' });
      continue;
    }

    const source = String(stagedRecord.source || '').toLowerCase();
    const primary = String(current.primarySource || '').toLowerCase();
    const verifiedBy = (current.verifiedBy || []).map((x) => String(x).toLowerCase());
    const hasReviewedProvenance = primary === source || verifiedBy.includes(source);
    const parity = ['open','high','low','close','volume'].every((field) => Number(current[field]) === Number(stagedRow[field]));

    if (!hasReviewedProvenance) {
      unresolved.push({ ticker, reason:'CURRENT_ROW_FROM_OTHER_SOURCE_NOT_RELABELED', primarySource:primary || null });
      continue;
    }
    if (!parity) throw new Error(`reviewed_canonical_ohlcv_parity_failed:${ticker}`);

    const closureRecord = findClosureRecord(closureRun, ticker);
    if (!closureRecord || !String(closureRecord.finalDisposition || '').startsWith('RESOLVED_')) {
      throw new Error(`reviewed_closure_record_not_resolved:${ticker}`);
    }
    const reviewedAttempt = {
      ok:true,
      sourceId:'approved_reviewed_import',
      underlyingSourceId:source,
      row:{
        ticker,
        sourceSymbol:ticker,
        sessionDate:expected,
        open:Number(stagedRow.open),
        high:Number(stagedRow.high),
        low:Number(stagedRow.low),
        close:Number(stagedRow.close),
        volume:Number(stagedRow.volume),
        sourceId:'approved_reviewed_import',
        underlyingSourceId:source,
        sourceUrl:stagedRecord.sourceUrl || null,
        fetchedAt:stagedRecord.fetchedAt || evaluatedAt,
        approvedRecord:true,
      },
      evidence:{
        stagedApproved:true,
        stagedSymbolVerified:true,
        exactExpectedSession:true,
        exactCanonicalOhlcvParity:true,
        reviewedProvenanceVerified:true,
        noCarryForward:true,
        syntheticMarketData:false,
      },
    };
    closureRecord.fallbackAttempts = [
      ...(closureRecord.fallbackAttempts || []).filter((x) => String(x?.sourceId || '') !== 'approved_reviewed_import'),
      reviewedAttempt,
    ];
    logicalEvidence.push({ ticker, sourceId:'approved_reviewed_import', underlyingSourceId:source, exactCanonicalOhlcvParity:true });

    if (current.validationStatus === 'g11_approved_current_source_validated') {
      current.validationStatus = 'approved_fallback_import';
      current.verifiedBy = [...new Set([...(current.verifiedBy || []), source])];
      current.warnings = [...new Set([...(current.warnings || []), 'reviewed_import_provenance_normalized_after_exact_parity'])];
      writeHistory(ROOT, ticker, doc);
      normalized.push(ticker);
    } else if (current.validationStatus === 'approved_fallback_import') {
      normalized.push(ticker);
    } else {
      throw new Error(`unexpected_reviewed_canonical_validation_status:${ticker}:${current.validationStatus || 'missing'}`);
    }
  }

  write('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json', closureRun);
  write('docs/astra/G11_CURRENT_REVIEWED_IMPORT_NORMALIZATION.json', {
    schemaVersion:'astra-g11-current-reviewed-import-normalization-2',
    generatedAt:evaluatedAt,
    expectedSession:expected,
    normalizedTickers:normalized,
    logicalReviewedImportEvidence:logicalEvidence,
    unresolved,
    safety:{ exactOhlcvParityRequired:true, reviewedProvenanceRequired:true, carryForward:false, syntheticMarketData:false },
  });
  console.log('ASTRA_G11_CURRENT_REVIEWED_IMPORT_NORMALIZATION ' + JSON.stringify({ expectedSession:expected, normalized, logicalEvidence, unresolved }));
}

const symbolMap = read('data/symbol-map.json', {});
const active = mapRows(symbolMap).map((x) => ({ ...x, ticker:safeTicker(x.ticker) })).filter((x) => x.ticker && x.active !== false);
const gaps = [];
for (const entry of active) {
  const doc = readHistory(ROOT, entry.ticker);
  if (validCurrent(doc)) continue;
  const latest = (doc?.sessions || []).map((s) => dateOnly(s.date || s.sessionDate)).filter(Boolean).sort().at(-1) || null;
  gaps.push({
    securityId:`EGX:${entry.ticker}`,
    ticker:entry.ticker,
    component:'CURRENT_CANONICAL_HISTORY_AND_V16_SOURCE_FEATURES',
    expectedSession:expected,
    actualSession:latest,
    source:`data/history/${entry.ticker}.json`,
    reason:latest && latest < expected ? 'LATEST_VALIDATION_APPROVED_ROW_PREDATES_EXPECTED_SESSION' : 'EXPECTED_SESSION_VALIDATED_ROW_UNAVAILABLE',
    affectedStrategy:'PORTFOLIO_BASKET_EQUAL_WEIGHT',
    affectedModule:'market-regime + V16 source features + production candidate selection',
    canAffectCurrentDecisioning:true,
    status:'UNRESOLVED_CURRENT_SESSION_GAP',
  });
}

const identityPath = R('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json');
const identityBytes = fs.readFileSync(identityPath);
const identity = JSON.parse(identityBytes.toString('utf8'));

write('docs/astra/G11_STALE_RECORDS.json', {
  schemaVersion:'astra-g11-stale-records-1',
  evaluatedAt,
  sourceHead:process.env.GITHUB_SHA || null,
  expectedSession:expected,
  total:gaps.length,
  resolved:0,
  unresolved:gaps.length,
  records:gaps,
  rebaselinedForCurrentSession:true,
  safety:{carryForward:false,syntheticMarketData:false},
});
write('docs/astra/G11_CURRENT_GAP_REBASELINE.json', {
  schemaVersion:'astra-g11-current-gap-rebaseline-1',
  generatedAt:evaluatedAt,
  expectedSession:expected,
  activeUniverse:active.length,
  currentBeforeFallback:active.length-gaps.length,
  fallbackTargets:gaps.length,
  fallbackTargetTickers:gaps.map((x)=>x.ticker),
});

runDynamicReviewedPreflight();

const reviewedPreflight = read('docs/astra/G11_CURRENT_REVIEWED_IMPORT_PREFLIGHT.json', { acceptedCurrentTickers:[] });
const reviewedHistoryDepthBefore = Object.fromEntries(
  (reviewedPreflight.acceptedCurrentTickers || []).map((tickerRaw) => {
    const ticker = safeTicker(tickerRaw);
    const doc = readHistory(ROOT, ticker);
    return [ticker, Array.isArray(doc?.sessions) ? doc.sessions.length : 0];
  })
);

try {
  identity.expectedSession = expected;
  identity.currentClosureSessionOverride = {
    session:expected,
    temporaryRuntimeOverride:true,
    reason:'Source-identity evidence is preserved; only the current source-closure session is aligned to the dynamically resolved expected session.',
  };
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2)+'\n', 'utf8');
  const result = cp.spawnSync(process.execPath, [R('astra/data-health/g11-approved-source-closure.cjs')], {
    cwd:ROOT,
    stdio:'inherit',
    env:{...process.env, EXPECTED_SESSION:expected},
  });
  if (result.status !== 0) process.exitCode = result.status || 1;
  else {
    for (const [ticker, beforeDepth] of Object.entries(reviewedHistoryDepthBefore)) {
      const afterDoc = readHistory(ROOT, ticker);
      const afterDepth = Array.isArray(afterDoc?.sessions) ? afterDoc.sessions.length : 0;
      if (afterDepth < beforeDepth) {
        throw new Error(`reviewed_import_history_depth_regression:${ticker}:${beforeDepth}->${afterDepth}`);
      }
    }
    normalizeResolvedReviewedRows();
  }
} finally {
  fs.writeFileSync(identityPath, identityBytes);
}
