#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/sr-history-gap-diagnostics.json';

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function text(rel) {
  try { return fs.readFileSync(P(rel), 'utf8'); } catch { return ''; }
}
function write(rel, value) {
  const file = P(rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, file);
}
function n(value) {
  if (value === null || value === undefined || value === '') return null;
  const x = Number(value); return Number.isFinite(x) ? x : null;
}
function sym(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
function validOhlc(row) {
  const h=n(row?.high), l=n(row?.low), c=n(row?.close ?? row?.price ?? row?.last);
  return h!==null && l!==null && c!==null && h>0 && l>0 && c>0 && h>=l;
}
function validRange(row) { return validOhlc(row) && n(row.high) > n(row.low); }
function datedRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || '')))
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
function latest(rows, predicate=()=>true) { return datedRows(rows).filter(predicate).at(-1) || null; }
function onDate(rows, date) { return datedRows(rows).find(row => String(row.date) === date) || null; }
function sourceQuality(row) { return String(row?.sourceQuality || row?.source || row?.primarySource || '').trim() || null; }
function classifyQuality(row, origin) {
  if (!row) return { origin, class: 'NONE', executionSafe: false };
  const q = sourceQuality(row) || '';
  const official = row.officialVerified === true || row?.confidence?.officialVerified === true;
  if (official) return { origin, class: 'OFFICIALLY_VERIFIED', executionSafe: true, sourceQuality: q || null };
  if (/workflow-market-snapshot/i.test(q)) return { origin, class: 'WORKFLOW_MARKET_SNAPSHOT', executionSafe: true, sourceQuality: q };
  // V11.3 parses/validates real public or licensed historical OHLCV and explicitly never fabricates missing sessions.
  if (/public_automated_historical_backfill/i.test(q)) return { origin, class: 'PUBLIC_VALIDATED_HISTORICAL_BACKFILL', executionSafe: true, sourceQuality: q };
  if (/optional_licensed|licensed.*histor/i.test(q)) return { origin, class: 'LICENSED_VALIDATED_HISTORICAL_BACKFILL', executionSafe: true, sourceQuality: q };
  if (/mubasher-historical-best-effort/i.test(q)) return { origin, class: 'EXTERNAL_BEST_EFFORT_UNVERIFIED', executionSafe: false, sourceQuality: q };
  if (/snapshot_ohlc_derived|derived_from_public_market_data/i.test(q)) return { origin, class: 'DERIVED_OHLC_NOT_EXECUTION_SAFE', executionSafe: false, sourceQuality: q };
  if (/recovered_from_repository_snapshot|git_commit_date/i.test(q)) return { origin, class: 'RECOVERED_DATE_NOT_EXECUTION_SAFE', executionSafe: false, sourceQuality: q };
  if (/kaggle|seed|single_source|legacy/i.test(q)) return { origin, class: 'LEGACY_OR_SEED_NOT_EXECUTION_SAFE', executionSafe: false, sourceQuality: q };
  return { origin, class: 'UNCLASSIFIED_NOT_EXECUTION_SAFE', executionSafe: false, sourceQuality: q || null };
}
function summarizePoint(row, origin) {
  if (!row) return null;
  return {
    date: row.date || null,
    open: n(row.open), high: n(row.high), low: n(row.low), close: n(row.close ?? row.price ?? row.last),
    validOhlc: validOhlc(row), validRange: validRange(row),
    quality: classifyQuality(row, origin),
  };
}
function perSymbolHistory(symbol) { return read(`data/history/${symbol}.json`, null); }

const internal = read('data/v17/internal-ohlc-support-resistance.json');
const history50 = read('data/history-50.json', { symbols: {} });
const legacyHistory = read('data/history.json', { sessionsBySymbol: {} });
const market = read('data/market.json', { rows: [] });
const ranking = read('data/final-opportunity-ranking.json', { rows: [] });
const v56Source = text('scripts/build-v56-history-50.js');
const v113Source = text('scripts/build-v113-historical-backfill-engine.js');

const candidateSymbols = Array.isArray(internal.candidateSymbols) && internal.candidateSymbols.length
  ? internal.candidateSymbols.map(sym).filter(Boolean)
  : [...new Set(rowsOf(ranking).map(row => sym(row.symbol)).filter(Boolean))].slice(0,80);
const levelSessionDate = internal.levelSessionDate || null;
const referenceSessionDate = internal.referenceSessionDate || null;
const internalMap = new Map(rowsOf(internal).map(row => [sym(row.symbol), row]));
const marketMap = new Map(rowsOf(market).map(row => [sym(row.symbol), row]));

const diagnostics = [];
for (const symbol of candidateSymbols) {
  const sr = internalMap.get(symbol) || null;
  const h50 = Array.isArray(history50?.symbols?.[symbol]) ? history50.symbols[symbol] : [];
  const legacy = Array.isArray(legacyHistory?.sessionsBySymbol?.[symbol]) ? legacyHistory.sessionsBySymbol[symbol] : [];
  const long = perSymbolHistory(symbol);
  const longRows = Array.isArray(long?.sessions) ? long.sessions : [];
  const marketRow = marketMap.get(symbol) || null;

  const h50OnLevel = onDate(h50, levelSessionDate);
  const legacyOnLevel = onDate(legacy, levelSessionDate);
  const longOnLevel = onDate(longRows, levelSessionDate);
  const latestH50Range = latest(h50, validRange);
  const latestLegacyRange = latest(legacy, validRange);
  const latestLongRange = latest(longRows, validRange);
  const fresh = Boolean(sr && levelSessionDate && sr.sessionDate === levelSessionDate);
  const missing = !sr;

  const recoveryPoints = [
    { row: h50OnLevel, origin: 'history-50' },
    { row: legacyOnLevel, origin: 'history.json:sessionsBySymbol' },
    { row: longOnLevel, origin: `data/history/${symbol}.json` },
  ].filter(item => validRange(item.row));
  const trustedRecovery = recoveryPoints.find(item => classifyQuality(item.row, item.origin).executionSafe === true) || null;
  const researchRecovery = recoveryPoints.find(item => item !== trustedRecovery) || null;

  let diagnosis = 'FRESH_INTERNAL_SR';
  if (missing) {
    if (trustedRecovery) diagnosis = 'MISSING_INTERNAL_SR_TRUSTED_COMPLETED_OHLC_AVAILABLE_ELSEWHERE';
    else if (researchRecovery) diagnosis = 'MISSING_INTERNAL_SR_ONLY_UNVERIFIED_OR_DERIVED_COMPLETED_OHLC_AVAILABLE';
    else if (latestH50Range || latestLegacyRange || latestLongRange) diagnosis = 'MISSING_INTERNAL_SR_ONLY_OLDER_VALID_RANGE_AVAILABLE';
    else diagnosis = 'MISSING_INTERNAL_SR_NO_VALID_OHLC_RANGE_ANYWHERE';
  } else if (!fresh) {
    if (trustedRecovery) diagnosis = 'STALE_INTERNAL_SR_TRUSTED_COMPLETED_OHLC_AVAILABLE_ELSEWHERE';
    else if (researchRecovery) diagnosis = 'STALE_INTERNAL_SR_ONLY_UNVERIFIED_OR_DERIVED_COMPLETED_OHLC_AVAILABLE';
    else diagnosis = 'STALE_INTERNAL_SR_NO_LEVEL_SESSION_VALID_RANGE';
  }

  diagnostics.push({
    symbol,
    diagnosis,
    internal: sr ? {
      sessionDate: sr.sessionDate || null,
      freshness: sr.freshness || null,
      confidence: n(sr.confidence),
      source: sr.source || null,
      executionEligible: sr.executionEligible === true,
    } : null,
    marketCurrent: marketRow ? { validOhlc: validOhlc(marketRow), validRange: validRange(marketRow), source: marketRow.source || market.source || null } : null,
    levelSessionEvidence: {
      history50: summarizePoint(h50OnLevel, 'history-50'),
      legacyHistory: summarizePoint(legacyOnLevel, 'history.json:sessionsBySymbol'),
      longHistory: summarizePoint(longOnLevel, `data/history/${symbol}.json`),
    },
    latestValidRange: {
      history50: summarizePoint(latestH50Range, 'history-50'),
      legacyHistory: summarizePoint(latestLegacyRange, 'history.json:sessionsBySymbol'),
      longHistory: summarizePoint(latestLongRange, `data/history/${symbol}.json`),
    },
    trustedRecoveryAvailable: Boolean(trustedRecovery),
    trustedRecoveryOrigin: trustedRecovery?.origin || null,
    trustedRecoveryPoint: trustedRecovery ? summarizePoint(trustedRecovery.row, trustedRecovery.origin) : null,
    researchOnlyRecoveryAvailable: Boolean(researchRecovery),
    researchOnlyRecoveryOrigin: researchRecovery?.origin || null,
    researchOnlyRecoveryPoint: researchRecovery ? summarizePoint(researchRecovery.row, researchRecovery.origin) : null,
  });
}

const counts = key => diagnostics.filter(row => row[key] === true).length;
const byDiagnosis = diagnostics.reduce((acc,row)=>{acc[row.diagnosis]=(acc[row.diagnosis]||0)+1;return acc;},{});
const missingRows = diagnostics.filter(row => !row.internal);
const staleRows = diagnostics.filter(row => row.internal && row.internal.sessionDate !== levelSessionDate);
const freshRows = diagnostics.filter(row => row.internal && row.internal.sessionDate === levelSessionDate);
const compactRecovery = row => ({
  symbol: row.symbol,
  diagnosis: row.diagnosis,
  currentInternalSession: row.internal?.sessionDate || null,
  trustedRecoveryOrigin: row.trustedRecoveryOrigin,
  trustedRecoveryPoint: row.trustedRecoveryPoint,
  researchOnlyRecoveryOrigin: row.researchOnlyRecoveryOrigin,
  researchOnlyRecoveryPoint: row.researchOnlyRecoveryPoint,
});
const trustedMissingRecoveries = missingRows.filter(row => row.trustedRecoveryAvailable).map(compactRecovery);
const trustedStaleRecoveries = staleRows.filter(row => row.trustedRecoveryAvailable).map(compactRecovery);
const researchOnlyMissingRecoveries = missingRows.filter(row => !row.trustedRecoveryAvailable && row.researchOnlyRecoveryAvailable).map(compactRecovery);
const researchOnlyStaleRecoveries = staleRows.filter(row => !row.trustedRecoveryAvailable && row.researchOnlyRecoveryAvailable).map(compactRecovery);

const output = {
  schemaVersion: '17.0.0-sr-history-gap-diagnostics-2',
  generatedAt: new Date().toISOString(),
  referenceSessionDate,
  levelSessionDate,
  candidateUniverseCount: candidateSymbols.length,
  summary: {
    freshInternalCount: freshRows.length,
    staleInternalCount: staleRows.length,
    missingInternalCount: missingRows.length,
    trustedMissingRecoveryCount: trustedMissingRecoveries.length,
    trustedStaleRecoveryCount: trustedStaleRecoveries.length,
    researchOnlyMissingRecoveryCount: researchOnlyMissingRecoveries.length,
    researchOnlyStaleRecoveryCount: researchOnlyStaleRecoveries.length,
    trustedRecoveryAvailableCount: counts('trustedRecoveryAvailable'),
    researchOnlyRecoveryAvailableCount: counts('researchOnlyRecoveryAvailable'),
    byDiagnosis,
  },
  schemaAudit: {
    legacyHistorySchema: legacyHistory?.sessionsBySymbol ? 'sessionsBySymbol' : legacyHistory?.symbols ? 'symbols' : 'other',
    v56ImportsSessionsBySymbol: /legacyHistory\.sessionsBySymbol/.test(v56Source),
    v56CurrentImportExpressionDetected: /legacyHistory\.symbols\s*\|\|\s*legacyHistory/.test(v56Source),
    finding: legacyHistory?.sessionsBySymbol && !/legacyHistory\.sessionsBySymbol/.test(v56Source)
      ? 'V56_HISTORY_50_DOES_NOT_IMPORT_SESSIONS_BY_SYMBOL_SCHEMA'
      : 'NO_SCHEMA_IMPORT_MISMATCH_DETECTED',
  },
  sourceContractAudit: {
    publicAutomatedHistoricalBackfillTrusted: /Never fabricates missing sessions/i.test(v113Source) && /public_automated_historical_backfill/.test(v113Source) && /validSession/.test(v113Source),
    source: 'scripts/build-v113-historical-backfill-engine.js',
    acceptedTrustedQualityClasses: ['OFFICIALLY_VERIFIED','WORKFLOW_MARKET_SNAPSHOT','PUBLIC_VALIDATED_HISTORICAL_BACKFILL','LICENSED_VALIDATED_HISTORICAL_BACKFILL'],
  },
  policy: {
    diagnosticOnly: true,
    doesNotChangeExecutionEligibility: true,
    derivedOhlcCannotRepairExecutionFreshness: true,
    recoveredCommitDateRowsCannotRepairExecutionFreshness: true,
    seedOrSingleSourceRowsCannotRepairExecutionFreshness: true,
    publicValidatedBackfillMayRepairOnlyExactCompletedSession: true,
    officiallyVerifiedOrValidatedRealPublicOhlcRequiredForTrustedRecovery: true,
    gateThresholdsUnchanged: true,
  },
  missingSymbols: missingRows.map(row => row.symbol),
  staleSymbols: staleRows.map(row => row.symbol),
  trustedMissingRecoveries,
  trustedStaleRecoveries,
  researchOnlyMissingRecoveries,
  researchOnlyStaleRecoveries,
  rows: diagnostics,
};

write(OUT, output);
console.log(JSON.stringify({
  referenceSessionDate,
  levelSessionDate,
  candidateUniverse: candidateSymbols.length,
  ...output.summary,
  trustedMissingRecoveries,
  trustedStaleRecoveries,
  schemaAudit: output.schemaAudit,
  sourceContractAudit: output.sourceContractAudit,
}, null, 2));