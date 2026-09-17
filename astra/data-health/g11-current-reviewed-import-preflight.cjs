#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateSession } = require('../../scripts/history/history-validator.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p) => JSON.parse(fs.readFileSync(R(p), 'utf8'));
const fail = (m) => { throw new Error(m); };
const expected = String(process.env.EXPECTED_SESSION || '').slice(0, 10);
const evaluatedAt = process.env.G11_EVALUATED_AT || new Date().toISOString();
if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) fail(`EXPECTED_SESSION missing/invalid: ${expected}`);

const staged = read('data/history-fallback-import.json');
const symbolMap = read('data/symbol-map.json');
const allowedSources = new Set(['egx_official', 'mubasher', 'investing', 'approved_csv']);
const currentRecords = [];
const ignoredStaleRecords = [];
const seen = new Set();

for (const record of Array.isArray(staged.records) ? staged.records : []) {
  const ticker = String(record?.ticker || '').trim().toUpperCase();
  if (!ticker) fail('reviewed_import_missing_ticker');
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  const currentRows = sessions.filter((s) => String(s?.date || s?.sessionDate || '').slice(0, 10) === expected);
  if (!currentRows.length) {
    ignoredStaleRecords.push({ ticker, sessions: sessions.map((s) => String(s?.date || s?.sessionDate || '').slice(0, 10)).filter(Boolean) });
    continue;
  }
  if (currentRows.length !== 1) fail(`reviewed_import_duplicate_expected_session:${ticker}`);
  if (seen.has(ticker)) fail(`reviewed_import_duplicate_ticker:${ticker}`);
  seen.add(ticker);
  if (!symbolMap[ticker] || symbolMap[ticker].active === false) fail(`reviewed_import_ticker_missing_or_inactive:${ticker}`);
  if (record.approved !== true || record.symbolVerified !== true) fail(`reviewed_import_not_explicitly_approved:${ticker}`);
  const source = String(record.source || '').trim().toLowerCase();
  if (!allowedSources.has(source)) fail(`reviewed_import_unsupported_source:${ticker}:${source || 'missing'}`);
  if (!String(record.sourceUrl || '').startsWith('http')) fail(`reviewed_import_source_url_missing:${ticker}`);

  const evidence = record.reviewEvidence || {};
  if (evidence.humanApproved !== true) fail(`reviewed_import_human_approval_missing:${ticker}`);
  if (evidence.sessionFinalized !== true) fail(`reviewed_import_session_not_finalized:${ticker}`);
  if (String(evidence.expectedSession || '') !== expected) fail(`reviewed_import_evidence_session_mismatch:${ticker}`);
  if (evidence.noCarryForward !== true || evidence.syntheticValuesForbidden !== true) fail(`reviewed_import_safety_evidence_missing:${ticker}`);
  const verificationUrls = Array.isArray(record.verificationUrls) ? record.verificationUrls.filter((u) => String(u || '').startsWith('http')) : [];
  if (source === 'approved_csv' && verificationUrls.length < 2) fail(`reviewed_import_cross_verification_insufficient:${ticker}`);
  if (source === 'approved_csv' && evidence.crossVerified !== true) fail(`reviewed_import_cross_verification_flag_missing:${ticker}`);

  const row = currentRows[0];
  const validation = validateSession({ ticker, ...row });
  if (!validation.valid) fail(`reviewed_import_ohlcv_invalid:${ticker}:${validation.errors.join(',')}`);
  if (!Number.isFinite(Number(row.volume)) || Number(row.volume) < 0) fail(`reviewed_import_volume_invalid:${ticker}`);

  currentRecords.push({
    ticker,
    source,
    session: expected,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    sourceUrl: record.sourceUrl,
    verificationUrls,
    reviewEvidence: evidence,
  });
}

const out = {
  schemaVersion: 'astra-g11-current-reviewed-import-preflight-1',
  generatedAt: evaluatedAt,
  expectedSession: expected,
  acceptedCurrentRecords: currentRecords,
  acceptedCurrentTickers: currentRecords.map((x) => x.ticker),
  ignoredNonCurrentStagedRecords: ignoredStaleRecords,
  safety: {
    carryForward: false,
    syntheticMarketData: false,
    legacyDecisionOutputUsed: false,
    exactExpectedSessionRequired: true,
    explicitHumanApprovalRequired: true,
    crossVerificationRequiredForApprovedCsv: true,
  },
};
fs.mkdirSync(R('docs/astra'), { recursive: true });
fs.writeFileSync(R('docs/astra/G11_CURRENT_REVIEWED_IMPORT_PREFLIGHT.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('ASTRA_G11_CURRENT_REVIEWED_IMPORT_PREFLIGHT ' + JSON.stringify({ expectedSession: expected, accepted: out.acceptedCurrentTickers, ignoredStale: ignoredStaleRecords.map((x) => x.ticker) }));
