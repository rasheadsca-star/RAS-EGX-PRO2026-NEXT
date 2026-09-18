#!/usr/bin/env node
// Trigger marker: prefer freshest validated Starta OHLC base across configured mirrors.
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchExactEgxHistory } = require('../../scripts/history/adapters/starta-exact-egx-adapter.cjs');
const { validateCurrentRow } = require('../../scripts/history/adapters/g11-approved-current-source-adapter.cjs');
const { mergeAndValidate } = require('../../scripts/history/history-validator.cjs');
const { readHistory, writeHistory } = require('../../scripts/history/history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('../../scripts/history/history-summary-builder.cjs');
const { readJson, safeTicker, sleep, unique, writeJsonAtomic } = require('../../scripts/history/lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => readJson(R(p), d);
const write = (p, v) => writeJsonAtomic(R(p), v);
const now = () => process.env.G11_EVALUATED_AT || new Date().toISOString();
const expected = String(process.env.EXPECTED_SESSION || '').slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error(`EXPECTED_SESSION missing/invalid: ${expected}`);

function mapRows(raw) {
  return Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
}
function dateOnly(v) { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
function allEntries() {
  return mapRows(read('data/symbol-map.json', {}))
    .map((x) => ({ ...x, ticker: safeTicker(x.ticker) }))
    .filter((x) => x.ticker)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}
function activeEntries() {
  return allEntries().filter((x) => x.active !== false);
}
function currentRow(doc) {
  return (doc?.sessions || []).find((s) => dateOnly(s.date || s.sessionDate) === expected) || null;
}
function currentRowValid(doc) {
  const row = currentRow(doc);
  if (!row) return false;
  return validateCurrentRow({
    sessionDate: expected,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    volume: row.volume === null || row.volume === undefined ? null : Number(row.volume),
  }, expected).ok;
}
function buildDocument(entry, existing, fetched, sourceRow) {
  const existingSessions = Array.isArray(existing?.sessions) ? existing.sessions : [];
  const exactSourceSessions = (Array.isArray(fetched?.sessions) ? fetched.sessions : []).map((row) => ({ ...row, ticker: entry.ticker }));
  const incoming = { ...sourceRow, ticker: entry.ticker };
  // For a newly discovered/current canonical ticker, seed its history only from the
  // same exact EGX-scoped source that supplied the verified current row. Do not
  // copy a predecessor ticker and do not promote any prior value into a new date.
  const sourceRows = existingSessions.length ? [incoming] : exactSourceSessions;
  const retentionLimit = Math.max(250, existingSessions.length + sourceRows.length);
  const merged = mergeAndValidate(existingSessions, sourceRows, retentionLimit);
  const persisted = merged.sessions.find((s) => dateOnly(s.date) === expected);
  if (!persisted) throw new Error('expected_session_not_persisted_after_validation');
  const parity = ['open','high','low','close','volume'].every((f) => Number(persisted[f]) === Number(sourceRow[f]));
  if (!parity) throw new Error('expected_session_values_changed_during_merge');
  return {
    ...(existing || {}),
    schemaVersion: existing?.schemaVersion || '12.5.0',
    ticker: entry.ticker,
    companyNameAr: entry.companyNameAr || existing?.companyNameAr || null,
    companyNameEn: entry.companyNameEn || existing?.companyNameEn || null,
    isin: entry.isin || fetched.identity?.sourceIsin || existing?.isin || null,
    reutersCode: entry.reutersCode || existing?.reutersCode || null,
    yahooSymbol: entry.yahooSymbol || existing?.yahooSymbol || null,
    currency: entry.currency || existing?.currency || 'EGP',
    exchange: 'EGX',
    generatedAt: now(),
    availableSessions: merged.sessions.length,
    firstSession: merged.sessions[0]?.date || null,
    lastSession: merged.sessions.at(-1)?.date || null,
    historyStatus: historyStatus(merged.sessions.length),
    primarySource: 'starta_ohlc_api',
    verificationSources: unique([...(existing?.verificationSources || []), 'starta_egx_exact_symbol']),
    officiallyVerifiedLatestSession: false,
    symbolVerified: true,
    symbolVerification: {
      verified: true,
      method: 'EXACT_SOURCE_ID_EGX_SCOPED_ENDPOINT',
      resolutionType: 'RESOLVED_EXACT_SOURCE_ID',
      sourceIdentifier: fetched.identity?.sourceIdentifier || entry.ticker,
      canonicalTicker: entry.ticker,
      sourceIsin: fetched.identity?.sourceIsin || null,
      canonicalIsin: fetched.identity?.canonicalIsin || entry.isin || null,
      exactIsin: fetched.identity?.exactIsin ?? null,
      endpointScope: 'EGX',
      nameMatchingUsedForResolution: false,
      sourceUrl: fetched.sourceUrl,
      verifiedAt: now(),
    },
    staleData: false,
    updateFailed: false,
    lastUpdateError: null,
    warnings: unique([...(existing?.warnings || []).filter((w) => !String(w).startsWith('expected_session_row_unavailable:')), 'g11_full_market_current_session_refresh', 'no_carry_forward', ...(existingSessions.length ? [] : ['history_seeded_from_same_exact_current_source']), ...merged.corporateActions.map(() => 'corporate_action_review_required')]),
    sessions: merged.sessions,
    g11CurrentSessionRefresh: {
      expectedSession: expected,
      sourceUrl: fetched.sourceUrl,
      sourceIdentifier: fetched.identity?.sourceIdentifier || entry.ticker,
      validationStatus: sourceRow.validationStatus || null,
      refreshedAt: now(),
      noCarryForward: true,
      syntheticValues: false,
    },
  };
}

async function main() {
  const all = allEntries();
  const entries = all.filter((x) => x.active !== false);
  const retiredAliasExclusions = all
    .filter((x) => x.active === false && x.inactiveReason === 'LEGACY_DUPLICATE_ALIAS_SUPERSEDED_BY_ACTIVE_CANONICAL')
    .map((x) => ({
      ticker:x.ticker,
      supersededBy:safeTicker(x.supersededBy),
      reason:x.inactiveReason,
      evidence:Array.isArray(x.identityEvidence)?x.identityEvidence:[],
    }));
  const records = [];
  let alreadyCurrent = 0, refreshed = 0, unavailable = 0, failed = 0;
  const delayMs = Math.max(0, Number(process.env.G11_CURRENT_REFRESH_DELAY_MS || 100));

  console.log(`G11 full-market current refresh: expected=${expected}, active=${entries.length}`);
  for (const entry of entries) {
    const existing = readHistory(ROOT, entry.ticker);
    if (currentRowValid(existing) && existing?.symbolVerified === true) {
      alreadyCurrent += 1;
      records.push({ ticker: entry.ticker, status: 'ALREADY_CURRENT_VALID', latestSession: expected });
      continue;
    }
    try {
      const fetched = await fetchExactEgxHistory(entry, { periodCandidates:['3mo','1y'], maximumRowsPerRequest:500, requestTimeoutMs:12000, retryCount:1 });
      if (!fetched.identity?.verified) throw new Error('exact_source_identity_not_verified');
      if (fetched.identity?.sourceActive === false) {
        unavailable += 1;
        records.push({ ticker: entry.ticker, status:'SOURCE_SECURITY_INACTIVE_REQUIRES_STATUS_REVIEW', sourceUrl:fetched.sourceUrl });
        continue;
      }
      const sourceRow = (fetched.sessions || []).find((s) => dateOnly(s.date) === expected);
      if (!sourceRow) {
        unavailable += 1;
        records.push({ ticker: entry.ticker, status:'APPROVED_PRIMARY_EXPECTED_SESSION_UNAVAILABLE', latestSourceSession:(fetched.sessions || []).at(-1)?.date || null, sourceUrl:fetched.sourceUrl });
        continue;
      }
      const validation = validateCurrentRow({
        sessionDate: expected,
        open:Number(sourceRow.open), high:Number(sourceRow.high), low:Number(sourceRow.low), close:Number(sourceRow.close),
        volume:sourceRow.volume === null || sourceRow.volume === undefined ? null : Number(sourceRow.volume),
      }, expected);
      if (!validation.ok) {
        unavailable += 1;
        records.push({ ticker: entry.ticker, status:'APPROVED_PRIMARY_CURRENT_ROW_REJECTED', errors:validation.errors, sourceUrl:fetched.sourceUrl });
        continue;
      }
      const document = buildDocument(entry, existing, fetched, sourceRow);
      writeHistory(ROOT, entry.ticker, document);
      refreshed += 1;
      records.push({ ticker: entry.ticker, status:'REFRESHED_APPROVED_PRIMARY', sourceUrl:fetched.sourceUrl, validationStatus:sourceRow.validationStatus || null });
    } catch (error) {
      failed += 1;
      records.push({ ticker: entry.ticker, status:'APPROVED_PRIMARY_REFRESH_FAILED', error:String(error.message || error) });
    }
    if (delayMs) await sleep(delayMs);
  }

  const summary = buildSummary(ROOT, entries, {
    starta: { status:'g11_approved_existing_current_refresh', role:'exact EGX-scoped primary current source' },
  });
  const calendar = buildSessionCalendar(ROOT, summary);
  let currentAfter = 0;
  const remaining = [];
  for (const entry of entries) {
    const doc = readHistory(ROOT, entry.ticker);
    if (currentRowValid(doc) && doc?.symbolVerified === true) currentAfter += 1;
    else remaining.push(entry.ticker);
  }

  const artifact = {
    schemaVersion:'astra-g11-current-session-refresh-1',
    generatedAt:now(),
    expectedSession:expected,
    approvedPrimarySource:'starta_egx_exact',
    activeUniverse:entries.length,
    retiredAliasExclusionCount:retiredAliasExclusions.length,
    retiredAliasExclusions,
    alreadyCurrentValid:alreadyCurrent,
    refreshedApprovedPrimary:refreshed,
    approvedPrimaryUnavailable:unavailable,
    approvedPrimaryFailures:failed,
    currentValidAfterPrimaryRefresh:currentAfter,
    remainingCurrentGaps:remaining.length,
    remainingGapTickers:remaining,
    latestMarketSessionAfterRefresh:summary.latestMarketSession || calendar.latestMarketSession || null,
    safety:{ carryForward:false, syntheticMarketData:false, legacyDecisionOutput:false, fuzzyIdentity:false },
    records,
  };
  write('docs/astra/G11_CURRENT_SESSION_REFRESH.json', artifact);
  console.log('ASTRA_G11_CURRENT_SESSION_REFRESH '+JSON.stringify({expectedSession:expected,active:entries.length,alreadyCurrent,refreshed,unavailable,failed,currentAfter,remaining:remaining.length,latest:artifact.latestMarketSessionAfterRefresh}));
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
