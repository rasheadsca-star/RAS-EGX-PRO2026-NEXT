#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const H = require('./g11-data-health.cjs');
const { fetchExactEgxHistory } = require('../../scripts/history/adapters/starta-exact-egx-adapter.cjs');
const { mergeAndValidate } = require('../../scripts/history/history-validator.cjs');
const { readHistory, writeHistory } = require('../../scripts/history/history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('../../scripts/history/history-summary-builder.cjs');
const { readJson, safeTicker, sleep, writeJsonAtomic } = require('../../scripts/history/lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => readJson(R(p), d);
const write = (p, v) => writeJsonAtomic(R(p), v);
const head = () => { try { return cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return process.env.GITHUB_SHA || 'UNKNOWN'; } };
const now = () => new Date().toISOString();

function mapRows(raw) {
  return Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
}
function isoDate(v) { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
function distinct(values) { return [...new Set(values.filter(Boolean))]; }
function baselineIdentityTickers() {
  const prior = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', null);
  if (Array.isArray(prior?.baselineTickers) && prior.baselineTickers.length) return prior.baselineTickers.map(safeTicker);
  const health = read('docs/astra/G11_SYMBOL_HEALTH.json', {});
  if (Array.isArray(health?.mappingReview?.records) && health.mappingReview.records.length) {
    return health.mappingReview.records.map((x) => safeTicker(x.canonicalTickerCandidate || x.ticker)).filter(Boolean);
  }
  return (health.records || []).filter((x) => x.active && x.symbolVerified !== true).map((x) => safeTicker(x.ticker)).filter(Boolean);
}
function baselineStaleTickers() {
  const prior = read('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', null);
  if (Array.isArray(prior?.baselineStaleTickers) && prior.baselineStaleTickers.length) return prior.baselineStaleTickers.map(safeTicker);
  return (read('docs/astra/G11_STALE_RECORDS.json', {})?.records || []).map((x) => safeTicker(x.ticker)).filter(Boolean);
}
function expectedSessionNow() {
  const policy = read('data/v13-3-daily-production-policy.json', {});
  return H.expectedSession(now(), policy);
}
function previousIdentityEvidence(mapEntry, existing) {
  return distinct([
    mapEntry?.yahooSymbol,
    mapEntry?.reutersCode,
    mapEntry?.yahooAlternative,
    existing?.yahooSymbol,
  ]).map((identifier) => ({
    sourceDataset: 'legacy_yahoo_history_configuration',
    sourceIdentifier: identifier,
    effectiveFrom: null,
    effectiveTo: null,
    status: 'HISTORICAL_CONFIG_ONLY_NOT_REUSED_AS_CURRENT_IDENTITY_PROOF',
  }));
}
function sourceFailureStatus(error) {
  const text = String(error?.message || error || '');
  if (/HTTP 404/.test(text)) return 'SOURCE_DOES_NOT_COVER_SECURITY';
  if (/identity_rejected|SOURCE_RECORD_INVALID|AMBIGUOUS_BLOCKED/.test(text)) return error?.identity?.resolutionType || 'SOURCE_RECORD_INVALID';
  if (/no_validation_approved_rows|ohlc_response_not_array|invalid_json/.test(text)) return 'SOURCE_RECORD_INVALID';
  return 'AMBIGUOUS_BLOCKED';
}
function activeMapEntries() {
  return mapRows(read('data/symbol-map.json', {})).map((x) => ({ ...x, ticker: safeTicker(x.ticker) })).filter((x) => x.ticker && x.active !== false);
}
function documentFromExactSource(entry, fetched, existing, expected) {
  const incoming = fetched.sessions.filter((row) => row.date <= expected);
  const merged = mergeAndValidate(existing?.sessions || [], incoming, 250);
  if (!merged.sessions.length) throw new Error('no_valid_sessions_after_exact_source_merge');
  const last = merged.sessions.at(-1);
  const sourceRows = incoming.sort((a, b) => a.date.localeCompare(b.date));
  const sourceFirst = sourceRows[0]?.date || null;
  const sourceLast = sourceRows.at(-1)?.date || null;
  const currentAvailable = merged.sessions.some((row) => row.date === expected);
  const verificationSources = distinct([...(existing?.verificationSources || []), 'starta_egx_exact_symbol']);
  return {
    schemaVersion: existing?.schemaVersion || '12.5.0',
    ticker: entry.ticker,
    companyNameAr: entry.companyNameAr || existing?.companyNameAr || null,
    companyNameEn: entry.companyNameEn || existing?.companyNameEn || null,
    isin: entry.isin || fetched.identity.sourceIsin || existing?.isin || null,
    reutersCode: entry.reutersCode || existing?.reutersCode || null,
    yahooSymbol: entry.yahooSymbol || existing?.yahooSymbol || null,
    currency: entry.currency || 'EGP',
    exchange: 'EGX',
    generatedAt: now(),
    availableSessions: merged.sessions.length,
    firstSession: merged.sessions[0].date,
    lastSession: last.date,
    historyStatus: historyStatus(merged.sessions.length),
    primarySource: 'starta_ohlc_api',
    verificationSources,
    officiallyVerifiedLatestSession: false,
    symbolVerified: true,
    symbolVerification: {
      method: 'EXACT_SOURCE_ID_EGX_SCOPED_ENDPOINT',
      resolutionType: 'RESOLVED_EXACT_SOURCE_ID',
      sourceIdentifier: fetched.identity.sourceIdentifier,
      canonicalTicker: entry.ticker,
      sourceIsin: fetched.identity.sourceIsin || null,
      canonicalIsin: fetched.identity.canonicalIsin || null,
      exactIsin: fetched.identity.exactIsin,
      endpointScope: 'EGX',
      nameMatchingUsedForResolution: false,
      sourceUrl: fetched.sourceUrl,
    },
    sourceIdentityRouting: [
      ...previousIdentityEvidence(entry, existing),
      {
        sourceDataset: 'starta_egx_database',
        sourceIdentifier: fetched.identity.sourceIdentifier,
        effectiveFrom: sourceFirst,
        effectiveTo: null,
        status: 'CURRENT_EXACT_SOURCE_ID',
        evidence: fetched.sourceUrl,
      },
    ],
    averageConfidence: Number(fetched.sessions[0]?.confidence?.overall || 75),
    staleData: !currentAvailable,
    updateFailed: false,
    lastUpdateError: currentAvailable ? null : `Exact source identity resolved, but validation-approved source row for expected session ${expected} is unavailable; latest=${sourceLast || 'none'}`,
    warnings: distinct([
      ...(existing?.warnings || []),
      'g11_exact_source_identity_repair',
      'company_name_not_used_for_identity_resolution',
      !currentAvailable ? `expected_session_row_unavailable:${expected}` : null,
      ...merged.corporateActions.map(() => 'corporate_action_review_required'),
    ]),
    sessions: merged.sessions,
    g11RepairEvidence: {
      expectedSession: expected,
      sourceFirstSession: sourceFirst,
      sourceLatestSession: sourceLast,
      sourceCurrentRecordAvailable: sourceRows.some((row) => row.date === expected),
      canonicalCurrentRecordAvailable: currentAvailable,
      rejectedSourceRows: fetched.rejected || [],
      repairedAt: now(),
    },
  };
}

async function main() {
  const startedAt = now();
  const sourceHead = head();
  const expected = expectedSessionNow();
  const mapEntries = activeMapEntries();
  const mapBy = new Map(mapEntries.map((x) => [x.ticker, x]));
  const identityBaseline = distinct(baselineIdentityTickers());
  const staleBaseline = distinct(baselineStaleTickers());
  const featureBaseline = ['AMES', 'GRCA', 'LUTS', 'PHGC'];
  const targets = distinct([...identityBaseline, ...staleBaseline, ...featureBaseline]).sort();
  const identitySet = new Set(identityBaseline);
  const staleSet = new Set(staleBaseline);
  const featureSet = new Set(featureBaseline);
  const records = [];
  let repairedCurrentRows = 0;

  console.log(`G11 targeted repair: expected=${expected}, identities=${identityBaseline.length}, stale=${staleBaseline.length}, feature=${featureBaseline.length}, union=${targets.length}`);

  for (const ticker of targets) {
    const entry = mapBy.get(ticker);
    const existing = readHistory(ROOT, ticker);
    const beforeLatest = isoDate(existing?.lastSession || existing?.sessions?.at(-1)?.date);
    const beforeCurrent = Boolean((existing?.sessions || []).some((row) => isoDate(row.date) === expected));
    const baseRecord = {
      securityId: `EGX:${ticker}`,
      canonicalTicker: ticker,
      securityMasterIdentity: entry ? {
        ticker: entry.ticker,
        isin: entry.isin || null,
        exchange: entry.exchange || 'EGX',
        active: entry.active !== false,
        companyNameAr: entry.companyNameAr || null,
        companyNameEn: entry.companyNameEn || null,
      } : null,
      currentConfiguredSourceIdentifier: entry?.yahooSymbol || entry?.reutersCode || null,
      historicalSourceIdentifiers: previousIdentityEvidence(entry || { ticker }, existing),
      sourceDataset: 'starta_egx_database',
      aliases: distinct([ticker, entry?.reutersCode, entry?.yahooSymbol, entry?.yahooAlternative, entry?.mubasherTicker, entry?.isin]),
      renameHistory: [],
      expectedSession: expected,
      beforeLatestSession: beforeLatest,
      beforeCurrentRecordAvailable: beforeCurrent,
      baselineIdentityCase: identitySet.has(ticker),
      baselineStaleCase: staleSet.has(ticker),
      baselineFeatureReadinessCase: featureSet.has(ticker),
    };

    if (!entry) {
      records.push({ ...baseRecord, repairedMappingStatus: 'AMBIGUOUS_BLOCKED', rootCause: 'CANONICAL_SECURITY_NOT_FOUND_IN_ACTIVE_SECURITY_MASTER', evidence: ['data/symbol-map.json'] });
      continue;
    }

    try {
      const fetched = await fetchExactEgxHistory(entry);
      if (fetched.identity.sourceActive === false) {
        records.push({
          ...baseRecord,
          repairedMappingStatus: 'SOURCE_SECURITY_INACTIVE',
          rootCause: 'EXACT_EGX_SCOPED_SOURCE_EXPLICITLY_MARKS_SECURITY_INACTIVE',
          sourceIdentity: fetched.identity,
          evidence: [fetched.sourceUrl],
          note: 'Active-universe membership is not changed automatically; authoritative listing-status reconciliation is still required.',
        });
        continue;
      }

      const document = documentFromExactSource(entry, fetched, existing, expected);
      writeHistory(ROOT, ticker, document);
      const afterCurrent = document.sessions.some((row) => row.date === expected);
      if (!beforeCurrent && afterCurrent) repairedCurrentRows += 1;
      const sourceLatest = document.g11RepairEvidence.sourceLatestSession;
      const sourceCurrent = document.g11RepairEvidence.sourceCurrentRecordAvailable;
      records.push({
        ...baseRecord,
        repairedMappingStatus: 'RESOLVED_EXACT_SOURCE_ID',
        sourceIdentity: fetched.identity,
        currentSourceIdentifier: fetched.identity.sourceIdentifier,
        effectiveDateRouting: document.sourceIdentityRouting,
        sourceLatestSession: sourceLatest,
        sourceCurrentRecordAvailable: sourceCurrent,
        canonicalizationStatus: afterCurrent ? 'CURRENT_SESSION_CANONICALIZED' : 'HISTORY_CANONICALIZED_CURRENT_SESSION_UNAVAILABLE',
        afterLatestSession: document.lastSession,
        afterCurrentRecordAvailable: afterCurrent,
        validHistorySessions: document.sessions.length,
        rootCause: identitySet.has(ticker) ? 'LEGACY_YAHOO_SOURCE_IDENTIFIER_NOT_COVERED_OR_REJECTED; EXACT_EGX_SCOPED_SOURCE_AVAILABLE' : (staleSet.has(ticker) ? 'LEGACY_PRIMARY_SOURCE_LAGGED; EXACT_EGX_SCOPED_SOURCE_REFRESH_ATTEMPTED' : 'FEATURE_HISTORY_DEPTH_REPAIR_FROM_EXACT_EGX_SCOPED_SOURCE'),
        evidence: [fetched.sourceUrl, `data/history/${ticker}.json`],
        nameMatchingUsedForResolution: false,
      });
    } catch (error) {
      records.push({
        ...baseRecord,
        repairedMappingStatus: sourceFailureStatus(error),
        rootCause: String(error.message || error),
        sourceIdentity: error.identity || null,
        evidence: ['scripts/history/adapters/starta-exact-egx-adapter.cjs'],
        nameMatchingUsedForResolution: false,
      });
    }
    await sleep(Number(process.env.G11_REPAIR_DELAY_MS || 150));
  }

  const summary = buildSummary(ROOT, mapEntries, {
    yahoo: { status: 'configured_legacy_primary', role: 'historical backfill where validation-approved' },
    starta: { status: 'g11_targeted_exact_source', role: 'exact EGX-scoped source repair; no name-based identity resolution' },
  });
  const calendar = buildSessionCalendar(ROOT, summary);

  const identityRecords = records.filter((x) => x.baselineIdentityCase);
  const resolvedIdentity = identityRecords.filter((x) => x.repairedMappingStatus === 'RESOLVED_EXACT_SOURCE_ID').length;
  const statusCounts = {};
  for (const r of identityRecords) statusCounts[r.repairedMappingStatus] = (statusCounts[r.repairedMappingStatus] || 0) + 1;
  const staleRecords = records.filter((x) => x.baselineStaleCase);
  const staleRepaired = staleRecords.filter((x) => x.afterCurrentRecordAvailable === true).length;

  const identityArtifact = {
    schemaVersion: 'astra-g11-source-identity-repair-1',
    generatedAt: now(),
    sourceHead,
    expectedSession: expected,
    sourcePolicy: {
      authoritativeResolutionBasis: 'exact source identifier on EGX-scoped endpoint; exact ISIN enforced when both canonical and source ISIN exist',
      fuzzyCompanyNameAuthoritative: false,
      historicalEffectiveDateRoutingRequired: true,
      carryForwardForbidden: true,
    },
    baselineTickers: identityBaseline,
    reviewed: identityRecords.length,
    resolved: resolvedIdentity,
    unresolved: identityRecords.length - resolvedIdentity,
    statusCounts,
    records: identityRecords,
  };
  write('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', identityArtifact);

  const featureRecords = records.filter((x) => x.baselineFeatureReadinessCase).map((x) => ({
    ticker: x.canonicalTicker,
    sourceIdentityStatus: x.repairedMappingStatus,
    currentRecordAvailable: x.afterCurrentRecordAvailable === true,
    validHistorySessions: Number(x.validHistorySessions || 0),
    preliminaryReadiness: x.afterCurrentRecordAvailable === true && Number(x.validHistorySessions || 0) >= 60 ? 'SOURCE_HISTORY_READY_FOR_V16_RECHECK' : 'REQUIRES_G11_RECHECK_OR_LEGITIMATE_INSUFFICIENT_HISTORY_CLASSIFICATION',
  }));
  const repairArtifact = {
    schemaVersion: 'astra-g11-current-data-repair-1',
    generatedAt: now(),
    sourceHead,
    expectedSession: expected,
    baselineIdentityTickers: identityBaseline,
    baselineStaleTickers: staleBaseline,
    baselineFeatureTickers: featureBaseline,
    unionTargets: targets.length,
    exactIdentityResolved: `${resolvedIdentity}/${identityRecords.length}`,
    staleCurrentRowsRepaired: `${staleRepaired}/${staleRecords.length}`,
    newlyRepairedCurrentRows: repairedCurrentRows,
    latestAvailableSourceSessionAfterRepair: summary.latestMarketSession,
    latestCanonicalSessionAfterRepair: calendar.latestMarketSession,
    featureRecords,
    records,
  };
  write('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', repairArtifact);

  const md = `# G11 Current Data Repair Report\n\n- Source HEAD: \`${sourceHead}\`\n- Repair started: ${startedAt}\n- Expected EGX session: **${expected}**\n- Identity baseline: **${resolvedIdentity}/${identityRecords.length} exact-source resolutions**; unresolved=${identityRecords.length - resolvedIdentity}.\n- Stale baseline: **${staleRepaired}/${staleRecords.length} current rows restored**.\n- Current rows newly restored across all targeted cases: **${repairedCurrentRows}**.\n- Latest validation-approved source/canonical session after targeted repair: **${summary.latestMarketSession || 'none'} / ${calendar.latestMarketSession || 'none'}**.\n- No fuzzy company-name resolution, no carry-forward, no synthetic OHLC/volume, no legacy recommendation output, and no G07 quarantine data were used.\n\n## Identity disposition counts\n\n${Object.entries(statusCounts).sort().map(([k,v]) => `- ${k}: ${v}`).join('\n') || '- none'}\n\n## Four additional readiness cases\n\n${featureRecords.map((x) => `- ${x.ticker}: ${x.preliminaryReadiness}; current=${x.currentRecordAvailable}; validSessions=${x.validHistorySessions}; sourceIdentity=${x.sourceIdentityStatus}.`).join('\n')}\n\nFinal readiness, S/R, regime, and gate status are decided only by the subsequent full G11 certification.\n`;
  fs.writeFileSync(R('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.md'), md, 'utf8');

  console.log('ASTRA_G11_REPAIR ' + JSON.stringify({
    sourceHead,
    expectedSession: expected,
    identityResolved: resolvedIdentity,
    identityTotal: identityRecords.length,
    staleRepaired,
    staleTotal: staleRecords.length,
    newlyRepairedCurrentRows: repairedCurrentRows,
    latestCanonical: calendar.latestMarketSession,
    statusCounts,
    featureRecords,
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
