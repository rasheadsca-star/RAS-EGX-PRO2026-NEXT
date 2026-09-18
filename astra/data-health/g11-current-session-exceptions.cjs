'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED = new Set(['LEGITIMATE_NO_TRADE','LEGITIMATE_SUSPENSION']);
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
const dateOnly = (v) => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const isHttp = (v) => /^https?:\/\//i.test(String(v || '').trim());

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadCurrentSessionExceptions(repoRoot, expectedSession, options = {}) {
  const expected = dateOnly(expectedSession);
  if (!expected) throw new Error(`invalid_expected_session_for_exception_registry:${expectedSession}`);
  const file = path.join(repoRoot, 'data', 'g11-current-session-exceptions.json');
  const doc = readJson(file, { schemaVersion:'astra-g11-current-session-exceptions-1', expectedSession:null, records:[] });
  if (doc.expectedSession && dateOnly(doc.expectedSession) !== expected) {
    return { schemaVersion:doc.schemaVersion || null, expectedSession:expected, registrySession:dateOnly(doc.expectedSession), records:[], byTicker:new Map(), inactiveForSession:true };
  }

  const symbolMap = options.symbolMap || readJson(path.join(repoRoot, 'data', 'symbol-map.json'), {});
  const records = [];
  const seen = new Set();

  for (const raw of Array.isArray(doc.records) ? doc.records : []) {
    const ticker = norm(raw.ticker);
    const session = dateOnly(raw.session || raw.expectedSession);
    if (!ticker) throw new Error('session_exception_missing_ticker');
    if (session !== expected) continue;
    if (seen.has(ticker)) throw new Error(`duplicate_session_exception:${ticker}`);
    seen.add(ticker);
    if (raw.approved !== true) throw new Error(`session_exception_not_approved:${ticker}`);
    if (!ALLOWED.has(raw.disposition)) throw new Error(`session_exception_bad_disposition:${ticker}:${raw.disposition}`);
    const mapEntry = symbolMap[ticker];
    if (!mapEntry || mapEntry.active === false) throw new Error(`session_exception_ticker_not_active:${ticker}`);
    if (raw.identityVerified !== true) throw new Error(`session_exception_identity_not_verified:${ticker}`);

    const evidenceUrls = Array.isArray(raw.evidenceUrls) ? raw.evidenceUrls.filter(isHttp) : [];
    if (evidenceUrls.length < 2) throw new Error(`session_exception_evidence_insufficient:${ticker}`);
    if (!String(raw.evidenceSummary || '').trim()) throw new Error(`session_exception_summary_missing:${ticker}`);

    const history = readJson(path.join(repoRoot, 'data', 'history', `${ticker}.json`), {});
    const statedIsin = String(raw.isin || '').trim().toUpperCase();
    const knownIsin = String(mapEntry.isin || history.isin || '').trim().toUpperCase();
    if (statedIsin && knownIsin && statedIsin !== knownIsin) throw new Error(`session_exception_isin_conflict:${ticker}`);
    if (statedIsin && !knownIsin) throw new Error(`session_exception_isin_unanchored:${ticker}`);

    let effectiveFrom = null;
    let effectiveThrough = null;
    if (raw.disposition === 'LEGITIMATE_SUSPENSION') {
      effectiveFrom = dateOnly(raw.effectiveFrom);
      effectiveThrough = dateOnly(raw.effectiveThrough);
      if (!effectiveFrom || !effectiveThrough || !(effectiveFrom <= expected && expected <= effectiveThrough)) {
        throw new Error(`session_exception_suspension_window_mismatch:${ticker}`);
      }
      if (String(raw.authorityClass || '') !== 'REGULATOR_OR_EXCHANGE') {
        throw new Error(`session_exception_suspension_authority_insufficient:${ticker}`);
      }
    }
    if (raw.disposition === 'LEGITIMATE_NO_TRADE') {
      if (raw.sessionClosed !== true || raw.noTradesConfirmed !== true) {
        throw new Error(`session_exception_no_trade_not_explicit:${ticker}`);
      }
    }

    records.push({
      ticker,
      session:expected,
      disposition:raw.disposition,
      approved:true,
      identityVerified:true,
      isin:statedIsin || knownIsin || null,
      effectiveFrom,
      effectiveThrough,
      authorityClass:raw.authorityClass || null,
      evidenceUrls,
      evidenceSummary:String(raw.evidenceSummary),
      reviewedAt:raw.reviewedAt || null,
    });
  }
  const byTicker = new Map(records.map((x) => [x.ticker, x]));
  return { schemaVersion:doc.schemaVersion || null, expectedSession:expected, registrySession:dateOnly(doc.expectedSession), records, byTicker, inactiveForSession:false };
}

module.exports = { ALLOWED, loadCurrentSessionExceptions };
