#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../contracts/data-health-primitives.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(R(p)), { recursive: true }); fs.writeFileSync(R(p), JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
const isoDate = (v) => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };

function currentHistoryState(ticker, expectedSession) {
  const doc = read(`data/history/${ticker}.json`, {});
  const parsed = H.parseHistory(doc || {});
  const current = parsed.validated.find((x) => x.date === expectedSession) || null;
  const latest = parsed.validated.at(-1) || null;
  const raw = current?.raw || null;
  return {
    symbolVerified: doc?.symbolVerified === true,
    currentValidCanonicalRow: Boolean(current),
    latestValidSession: latest?.date || null,
    validHistorySessions: parsed.validated.length,
    currentSource: raw?.primarySource || raw?.source || doc?.primarySource || null,
    currentVerificationSources: raw?.verificationSources || raw?.verifiedBy || doc?.verificationSources || [],
    currentValidationStatus: raw?.validationStatus || null,
    currentSourceUrls: raw?.sourceUrls || null,
  };
}

function invalidDefect(rootCause) {
  const text = String(rootCause || '');
  if (/identity_rejected|SOURCE_RECORD_INVALID|source-symbol|source identifier/i.test(text)) return 'SOURCE_IDENTITY_RECORD_INVALID';
  if (/no_validation_approved_rows|OHLC|flat_zero_volume|volume_missing/i.test(text)) return 'SOURCE_OHLC_OR_VOLUME_VALIDATION_REJECTED';
  if (/ohlc_response_not_array|parser|invalid_json/i.test(text)) return 'SOURCE_RESPONSE_OR_PARSER_INVALID';
  if (/session/i.test(text)) return 'SOURCE_SESSION_MISMATCH';
  return 'SOURCE_RECORD_INVALID_UNDER_EXACT_SOURCE_POLICY';
}

const identity = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', {});
const repair = read('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', {});
const expected = identity.expectedSession || repair.expectedSession;
if (!expected) throw new Error('G11 expected session missing from repair artifacts');

const recordByTicker = new Map();
const enrichedRepair = (repair.records || []).map((record) => {
  const ticker = norm(record.canonicalTicker);
  const state = currentHistoryState(ticker, expected);
  let disposition = 'UNCLASSIFIED';
  let productionRelevantBlocker = false;
  let dispositionReason = null;

  if (record.repairedMappingStatus === 'RESOLVED_EXACT_SOURCE_ID') {
    disposition = state.currentValidCanonicalRow ? 'REPAIRED_EXACT_SOURCE_ID_CURRENT_ROW_VALID' : 'EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE';
    productionRelevantBlocker = !state.currentValidCanonicalRow;
    dispositionReason = state.currentValidCanonicalRow ? 'Exact EGX-scoped source identity and expected-session canonical row are both present.' : 'Identity is exact, but the validation-approved source has no expected-session row.';
  } else if (record.repairedMappingStatus === 'SOURCE_DOES_NOT_COVER_SECURITY') {
    if (state.symbolVerified && state.currentValidCanonicalRow) {
      disposition = 'DOCUMENTED_SOURCE_NON_COVERAGE_WITH_APPROVED_ALTERNATIVE_CANONICAL_CURRENT_ROW';
      dispositionReason = 'The targeted Starta source does not cover the security, but the project canonical history already contains a symbol-verified validation-approved expected-session row from another configured source.';
    } else {
      disposition = 'PRODUCTION_RELEVANT_EXTERNAL_SOURCE_BLOCKER_NO_APPROVED_CURRENT_ROW';
      productionRelevantBlocker = true;
      dispositionReason = 'The targeted source does not cover the active security and no symbol-verified validation-approved expected-session canonical row exists in the project source set.';
    }
  } else if (record.repairedMappingStatus === 'SOURCE_RECORD_INVALID') {
    const defect = invalidDefect(record.rootCause);
    if (state.symbolVerified && state.currentValidCanonicalRow) {
      disposition = 'INVALID_TARGET_SOURCE_WITH_APPROVED_ALTERNATIVE_CANONICAL_CURRENT_ROW';
      dispositionReason = `Target source defect=${defect}; canonical current data remains available from an approved alternative source.`;
    } else {
      disposition = 'PRODUCTION_RELEVANT_INVALID_SOURCE_BLOCKER';
      productionRelevantBlocker = true;
      dispositionReason = `Target source defect=${defect}; no approved alternative expected-session canonical row is available.`;
    }
  } else if (record.repairedMappingStatus === 'SOURCE_SECURITY_INACTIVE') {
    disposition = 'SOURCE_MARKS_SECURITY_INACTIVE_REQUIRES_LISTING_STATUS_RECONCILIATION';
    productionRelevantBlocker = !state.currentValidCanonicalRow;
    dispositionReason = 'The targeted source marks the security inactive; G11 does not mutate SecurityMaster active status without authoritative listing-status evidence.';
  } else {
    disposition = 'AMBIGUOUS_SOURCE_IDENTITY_BLOCKER';
    productionRelevantBlocker = true;
    dispositionReason = 'The source identity could not be deterministically resolved under exact ticker/ISIN policy.';
  }

  const enriched = {
    ...record,
    afterCurrentRecordAvailable: state.currentValidCanonicalRow,
    afterLatestSession: state.latestValidSession,
    validHistorySessions: state.validHistorySessions,
    finalDisposition: disposition,
    finalDispositionReason: dispositionReason,
    productionRelevantBlocker,
    alternativeCanonicalCurrentEvidence: state.symbolVerified && state.currentValidCanonicalRow ? {
      source: state.currentSource,
      verificationSources: state.currentVerificationSources,
      validationStatus: state.currentValidationStatus,
      sourceUrls: state.currentSourceUrls,
      expectedSession: expected,
      precedenceBasis: 'Existing project canonical history accepted by G11 validation rules; no fuzzy substitution and no legacy recommendation output.',
    } : null,
  };
  recordByTicker.set(ticker, enriched);
  return enriched;
});

repair.records = enrichedRepair;
const baselineStale = (repair.baselineStaleTickers || []).map(norm);
const staleFinal = baselineStale.map((ticker) => {
  const state = currentHistoryState(ticker, expected);
  const record = recordByTicker.get(ticker) || null;
  return {
    ticker,
    securityId: `EGX:${ticker}`,
    expectedSession: expected,
    currentValidCanonicalRow: state.currentValidCanonicalRow,
    latestValidSession: state.latestValidSession,
    validHistorySessions: state.validHistorySessions,
    sourceIdentityStatus: record?.repairedMappingStatus || null,
    sourceDisposition: record?.finalDisposition || null,
    status: state.currentValidCanonicalRow ? 'REPAIRED_OR_ALREADY_CURRENT_WITH_VALIDATION_APPROVED_EVIDENCE' : 'UNRESOLVED_BROKEN_FRESHNESS',
    source: state.currentSource,
    verificationSources: state.currentVerificationSources,
    productionRelevantBlocker: !state.currentValidCanonicalRow,
  };
});
const staleRepaired = staleFinal.filter((x) => x.currentValidCanonicalRow).length;
repair.staleCurrentRowsRepaired = `${staleRepaired}/${staleFinal.length}`;
repair.finalStaleDisposition = {
  baselineTotal: staleFinal.length,
  repaired: staleRepaired,
  remaining: staleFinal.length - staleRepaired,
  records: staleFinal,
};

const identityEnriched = (identity.records || []).map((row) => recordByTicker.get(norm(row.canonicalTicker)) || row);
identity.records = identityEnriched;
identity.resolved = identityEnriched.filter((x) => x.repairedMappingStatus === 'RESOLVED_EXACT_SOURCE_ID').length;
identity.unresolved = Number(identity.reviewed || identityEnriched.length) - identity.resolved;
identity.finalDispositionCounts = {};
for (const row of identityEnriched) identity.finalDispositionCounts[row.finalDisposition || 'UNCLASSIFIED'] = (identity.finalDispositionCounts[row.finalDisposition || 'UNCLASSIFIED'] || 0) + 1;
identity.productionRelevantBlockers = identityEnriched.filter((x) => x.productionRelevantBlocker).length;
identity.finalDispositionAccountingCloses = identityEnriched.length === Number(identity.reviewed || identityEnriched.length);

write('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json', identity);
write('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json', repair);

let md = `# G11 Current Data Repair Report\n\n`;
md += `- Expected session: **${expected}**.\n`;
md += `- Exact targeted-source identities repaired: **${identity.resolved}/${identity.reviewed || identityEnriched.length}**.\n`;
md += `- Remaining identity cases: **${identity.unresolved}**; production-relevant blockers after alternative-canonical-source check: **${identity.productionRelevantBlockers}**.\n`;
md += `- Original stale set current after repair/recheck: **${staleRepaired}/${staleFinal.length}**; remaining=${staleFinal.length - staleRepaired}.\n\n`;
md += `## Identity disposition counts\n\n`;
for (const [key, value] of Object.entries(identity.finalDispositionCounts).sort()) md += `- ${key}: ${value}\n`;
md += `\n## Remaining stale cases\n\n`;
const remainingStale = staleFinal.filter((x) => !x.currentValidCanonicalRow);
if (!remainingStale.length) md += `- None.\n`;
else for (const row of remainingStale) md += `- ${row.ticker}: latest=${row.latestValidSession || 'none'}; sourceIdentity=${row.sourceIdentityStatus || 'unknown'}; disposition=${row.sourceDisposition || 'unknown'}.\n`;
md += `\nNo legacy recommendation output, fuzzy symbol substitution, or synthesized carry-forward row is accepted as repair evidence.\n`;
fs.writeFileSync(R('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.md'), md, 'utf8');

console.log('ASTRA_G11_SOURCE_DISPOSITIONS ' + JSON.stringify({ identityResolved: identity.resolved, identityTotal: identity.reviewed || identityEnriched.length, productionRelevantIdentityBlockers: identity.productionRelevantBlockers, staleRepaired, staleTotal: staleFinal.length, staleRemaining: staleFinal.length - staleRepaired, dispositionCounts: identity.finalDispositionCounts }));
