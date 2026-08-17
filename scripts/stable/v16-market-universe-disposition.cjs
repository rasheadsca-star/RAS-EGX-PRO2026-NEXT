#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const PRICE_PATH = P('data/stable/v15-price-truth.json');
const SECOND_PATH = P('data/stable/v16-market-second-source-evidence.json');
const OUT_PATH = P('data/stable/v16-market-universe-disposition.json');
const FETCH_STATUS_PATH = P('data/fetch-status.json');

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
const norm = v => String(v || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const round = (v, d = 1) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function independentNoExpectedSessionEvidence(record, expectedSession) {
  const attempts = Array.isArray(record?.attempts) ? record.attempts : [];
  const stock = attempts.find(a => a?.provider === 'STOCKANALYSIS_EGX_HISTORY');
  const stockAttempts = Array.isArray(stock?.attempts) ? stock.attempts : [];
  const datedAbsence = stockAttempts.filter(a => a?.status === 'NO_EXPECTED_SESSION' && dateOnly(a?.latestAvailableSession));
  if (!datedAbsence.length) return null;
  const allPrior = datedAbsence.every(a => dateOnly(a.latestAvailableSession) < expectedSession);
  if (!allPrior) return null;
  return {
    provider: 'STOCKANALYSIS_EGX_HISTORY',
    status: 'NO_EXPECTED_SESSION_CONFIRMED',
    checkedUrls: datedAbsence.map(a => a.url).filter(Boolean),
    latestAvailableSession: datedAbsence.map(a => dateOnly(a.latestAvailableSession)).sort().at(-1) || null,
    latestAvailableClose: datedAbsence.map(a => a.latestAvailableClose).find(v => Number.isFinite(Number(v))) ?? null,
  };
}

function classifyRejected(rejected, secondRecord, expectedSession) {
  const ticker = norm(rejected?.ticker);
  const primarySession = dateOnly(rejected?.sourceSessionDate);
  const reason = String(rejected?.reason || '');
  const primaryStale = ['SOURCE_SESSION_MISMATCH', 'SOURCE_SESSION_UNKNOWN'].includes(reason)
    && (!primarySession || primarySession !== expectedSession);
  const independentAbsence = independentNoExpectedSessionEvidence(secondRecord, expectedSession);
  if (!ticker || !primaryStale || secondRecord?.approved === true || !independentAbsence) {
    return {
      ticker,
      verified: false,
      executionEligible: false,
      disposition: 'UNRESOLVED_DATA_IDENTITY_OR_SESSION',
      originalReason: reason || null,
      primarySourceSessionDate: primarySession,
      independentEvidence: independentAbsence,
    };
  }
  return {
    ticker,
    verified: true,
    executionEligible: false,
    quarantined: true,
    disposition: 'NO_CURRENT_SESSION_PRICE_ROW_CONFIRMED',
    originalReason: reason,
    expectedSession,
    primarySourceSessionDate: primarySession,
    primaryEvidenceStatus: 'STALE_OR_NON_CURRENT_SESSION',
    independentEvidence: independentAbsence,
    executionPolicy: 'EXCLUDE_FROM_CURRENT_SESSION_EXECUTION_UNIVERSE',
    rationale: 'No exact expected-session price row is independently available. The row is documented and quarantined rather than assigned a synthetic current-session price.',
  };
}

function main() {
  const price = readJson(PRICE_PATH, {});
  const second = readJson(SECOND_PATH, {});
  const fetchStatus = readJson(FETCH_STATUS_PATH, {});
  const expectedSession = dateOnly(price.expectedSession || second.expectedSession);
  if (!expectedSession) throw new Error('Missing expected session');
  if (dateOnly(second.expectedSession) !== expectedSession) throw new Error('Second-source evidence session mismatch');

  const inputRows = Number(price?.source?.inputRows || 0);
  const acceptedRows = Number(price.acceptedRows || 0);
  const rejected = Array.isArray(price.sampleRejected) ? price.sampleRejected : [];
  if (!inputRows || acceptedRows + rejected.length !== inputRows) {
    throw new Error(`Universe accounting mismatch: accepted=${acceptedRows} rejected=${rejected.length} input=${inputRows}`);
  }

  const records = rejected.map(row => {
    const ticker = norm(row?.ticker);
    return classifyRejected(row, second?.records?.[ticker] || null, expectedSession);
  });
  const verifiedIneligible = records.filter(r => r.verified && r.executionEligible === false);
  const unresolved = records.filter(r => !r.verified);
  const executionEligibleUniverseRows = inputRows - verifiedIneligible.length;
  const executionEligibleAcceptedRows = acceptedRows;
  const executionEligibleCoveragePct = executionEligibleUniverseRows > 0
    ? round(executionEligibleAcceptedRows / executionEligibleUniverseRows * 100, 1)
    : 0;
  const verifiedDispositionRows = acceptedRows + verifiedIneligible.length;
  const universeDispositionCoveragePct = inputRows > 0
    ? round(verifiedDispositionRows / inputRows * 100, 1)
    : 0;
  const rawSessionEvidenceRows = Number(price?.source?.verifiedExpectedSessionRows || 0);
  const rawSessionEvidenceCoveragePct = Number(price?.source?.sourceSessionEvidenceCoveragePct || 0);
  const complete = unresolved.length === 0
    && executionEligibleAcceptedRows === executionEligibleUniverseRows
    && verifiedDispositionRows === inputRows
    && executionEligibleCoveragePct === 100
    && universeDispositionCoveragePct === 100;

  const out = {
    schemaVersion: '16.9.2-market-universe-disposition-v1',
    generatedAt: new Date().toISOString(),
    engine: 'V16_9_EQUAL_WEIGHT_BASKET',
    expectedSession,
    methodology: {
      failClosed: true,
      noSyntheticCurrentSessionPrices: true,
      noAlphaOrRankingChange: true,
      noEntryStopTargetAllocationChange: true,
      rule: 'Every raw market row must either have an accepted exact-session price or a verified non-executable disposition. Only accepted exact-session rows belong to the execution-eligible universe.',
    },
    summary: {
      rawUniverseRows: inputRows,
      acceptedCurrentSessionPriceRows: acceptedRows,
      rawSessionEvidenceRows,
      rawSessionEvidenceCoveragePct,
      verifiedIneligibleRows: verifiedIneligible.length,
      unresolvedRows: unresolved.length,
      executionEligibleUniverseRows,
      executionEligibleAcceptedRows,
      executionEligibleCoveragePct,
      verifiedDispositionRows,
      universeDispositionCoveragePct,
      professionalDataCoverageComplete: complete,
    },
    verifiedIneligible,
    unresolved,
  };
  out.dispositionHash = sha({ expectedSession, summary: out.summary, verifiedIneligible: out.verifiedIneligible, methodology: out.methodology });
  writeJson(OUT_PATH, out);

  price.professionalCoverage = {
    schemaVersion: '16.9.2-professional-market-coverage-v1',
    generatedAt: out.generatedAt,
    rawUniverseRows: inputRows,
    rawSessionEvidenceRows,
    rawSessionEvidenceCoveragePct,
    acceptedCurrentSessionPriceRows: acceptedRows,
    verifiedIneligibleRows: verifiedIneligible.length,
    verifiedIneligibleTickers: verifiedIneligible.map(r => r.ticker),
    executionEligibleUniverseRows,
    executionEligibleAcceptedRows,
    executionEligibleCoveragePct,
    verifiedDispositionRows,
    universeDispositionCoveragePct,
    unresolvedRows: unresolved.length,
    complete,
    failClosed: true,
    noSyntheticPrices: true,
    dispositionEvidencePath: 'data/stable/v16-market-universe-disposition.json',
  };
  writeJson(PRICE_PATH, price);

  fetchStatus.professionalCoverage = price.professionalCoverage;
  writeJson(FETCH_STATUS_PATH, fetchStatus);

  console.log(JSON.stringify({
    expectedSession,
    rawUniverseRows: inputRows,
    acceptedCurrentSessionPriceRows: acceptedRows,
    rawSessionEvidenceRows,
    rawSessionEvidenceCoveragePct,
    verifiedIneligibleRows: verifiedIneligible.length,
    verifiedIneligibleTickers: verifiedIneligible.map(r => r.ticker),
    executionEligibleUniverseRows,
    executionEligibleAcceptedRows,
    executionEligibleCoveragePct,
    verifiedDispositionRows,
    universeDispositionCoveragePct,
    unresolvedRows: unresolved.length,
    professionalDataCoverageComplete: complete,
  }, null, 2));

  if (!complete) process.exitCode = 2;
}

main();
