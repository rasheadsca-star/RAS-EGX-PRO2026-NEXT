'use strict';

const fs = require('fs');
const path = require('path');

const DISPOSITION = 'LEGITIMATE_V16_MODEL_DOMAIN_EXCLUSION';
const REASON = 'ATR_PCT_OUTSIDE_V16_0_4_TO_14_RANGE';
const MIN_ATR_PCT = 0.4;
const MAX_ATR_PCT = 14;
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
const dateOnly = (v) => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function validCurrentRow(row, expected) {
  if (!row || dateOnly(row.date || row.sessionDate) !== expected) return false;
  const open=finite(row.open),high=finite(row.high),low=finite(row.low),close=finite(row.close),volume=finite(row.volume);
  return Boolean(
    open>0 && high>0 && low>0 && close>0 && volume!==null && volume>=0 &&
    high>=Math.max(open,close) && low<=Math.min(open,close) &&
    !/invalid|conflict|failed|unresolved|quarantined/i.test(String(row.validationStatus || ''))
  );
}

function loadV16DomainExceptions(repoRoot, expectedSession, options = {}) {
  const expected = dateOnly(expectedSession);
  if (!expected) throw new Error(`invalid_expected_session_for_v16_domain_exception:${expectedSession}`);

  const registryPath = path.join(repoRoot, 'data', 'g11-v16-domain-exceptions.json');
  const registry = readJson(registryPath, { expectedSession:null, records:[] });
  if (registry.expectedSession && dateOnly(registry.expectedSession) !== expected) {
    return { schemaVersion:registry.schemaVersion || null, expectedSession:expected, registrySession:dateOnly(registry.expectedSession), records:[], byTicker:new Map(), inactiveForSession:true };
  }

  const readiness = options.readiness || readJson(path.join(repoRoot, 'docs', 'astra', 'G11_V16_FEATURE_READINESS.json'), {});
  if (dateOnly(readiness.expectedSession) !== expected) {
    throw new Error(`v16_domain_exception_readiness_session_mismatch:${readiness.expectedSession || 'missing'}:${expected}`);
  }

  const sourcePath = path.join(repoRoot, 'scripts', 'research', 'v16-probabilistic-model-impact.py');
  const source = fs.readFileSync(sourcePath, 'utf8');
  if (!/\.4\s*<=\s*f\['atrpct'\]\s*<=\s*14/.test(source)) {
    throw new Error('v16_domain_exception_certified_atr_threshold_changed');
  }

  const symbolMap = options.symbolMap || readJson(path.join(repoRoot, 'data', 'symbol-map.json'), {});
  const readinessByTicker = new Map((readiness.records || []).map((x) => [norm(x.ticker), x]));
  const records = [];
  const seen = new Set();

  for (const raw of Array.isArray(registry.records) ? registry.records : []) {
    const ticker = norm(raw.ticker);
    const session = dateOnly(raw.session || raw.expectedSession);
    if (!ticker) throw new Error('v16_domain_exception_missing_ticker');
    if (session !== expected) continue;
    if (seen.has(ticker)) throw new Error(`duplicate_v16_domain_exception:${ticker}`);
    seen.add(ticker);

    if (raw.approved !== true) throw new Error(`v16_domain_exception_not_approved:${ticker}`);
    if (raw.disposition !== DISPOSITION) throw new Error(`v16_domain_exception_bad_disposition:${ticker}`);
    if (raw.reason !== REASON) throw new Error(`v16_domain_exception_bad_reason:${ticker}:${raw.reason}`);
    if (raw.identityVerified !== true || raw.currentSessionValidated !== true || raw.sameSessionRequirementMet !== true) {
      throw new Error(`v16_domain_exception_review_flags_incomplete:${ticker}`);
    }
    if (Number(raw.certifiedRange?.min) !== MIN_ATR_PCT || Number(raw.certifiedRange?.max) !== MAX_ATR_PCT) {
      throw new Error(`v16_domain_exception_range_changed:${ticker}`);
    }

    const mapEntry = symbolMap[ticker];
    if (!mapEntry || mapEntry.active === false) throw new Error(`v16_domain_exception_ticker_not_active:${ticker}`);

    const history = readJson(path.join(repoRoot, 'data', 'history', `${ticker}.json`), {});
    const sessions = Array.isArray(history.sessions) ? history.sessions : [];
    if (history.symbolVerified !== true) throw new Error(`v16_domain_exception_history_identity_unverified:${ticker}`);
    if (sessions.length < 56) throw new Error(`v16_domain_exception_history_too_short:${ticker}:${sessions.length}`);
    const current = sessions.find((x) => dateOnly(x.date || x.sessionDate) === expected);
    if (!validCurrentRow(current, expected)) throw new Error(`v16_domain_exception_current_row_invalid:${ticker}`);

    const statedIsin = String(raw.isin || '').trim().toUpperCase();
    const knownIsin = String(history.isin || mapEntry.isin || '').trim().toUpperCase();
    if (!statedIsin || !knownIsin || statedIsin !== knownIsin) throw new Error(`v16_domain_exception_isin_mismatch:${ticker}`);

    const vr = readinessByTicker.get(ticker);
    if (!vr) throw new Error(`v16_domain_exception_readiness_missing:${ticker}`);
    if (vr.ready !== false || vr.readyBeforeCrossSection !== false || vr.sameSessionRequirementMet !== true) {
      throw new Error(`v16_domain_exception_readiness_state_unexpected:${ticker}`);
    }
    if (dateOnly(vr.latestSession) !== expected) throw new Error(`v16_domain_exception_latest_session_mismatch:${ticker}`);
    if (Number(vr.validHistorySessions || 0) < 56) throw new Error(`v16_domain_exception_readiness_history_short:${ticker}`);
    const reasons = Array.isArray(vr.reasons) ? vr.reasons : [];
    if (reasons.length !== 1 || reasons[0] !== REASON) throw new Error(`v16_domain_exception_not_pure_domain_rejection:${ticker}:${reasons.join(',')}`);

    const atrPct = finite(vr.atrPct);
    const approvedAtrPct = finite(raw.observedAtrPct);
    if (atrPct === null || approvedAtrPct === null || Math.abs(atrPct - approvedAtrPct) > 1e-9) {
      throw new Error(`v16_domain_exception_atr_evidence_mismatch:${ticker}`);
    }
    if (MIN_ATR_PCT <= atrPct && atrPct <= MAX_ATR_PCT) throw new Error(`v16_domain_exception_atr_inside_certified_domain:${ticker}`);

    records.push({
      ticker,
      isin:knownIsin,
      session:expected,
      disposition:DISPOSITION,
      reason:REASON,
      approved:true,
      currentSessionValidated:true,
      validHistorySessions:Number(vr.validHistorySessions),
      atrPct,
      certifiedRange:{min:MIN_ATR_PCT,max:MAX_ATR_PCT},
      sameSessionRequirementMet:true,
      evidencePaths:Array.isArray(raw.evidencePaths) ? raw.evidencePaths : [],
      reviewedAt:raw.reviewedAt || null,
    });
  }

  return {
    schemaVersion:registry.schemaVersion || null,
    expectedSession:expected,
    records,
    byTicker:new Map(records.map((x) => [x.ticker, x])),
    inactiveForSession:false,
  };
}

module.exports = { DISPOSITION, REASON, MIN_ATR_PCT, MAX_ATR_PCT, loadV16DomainExceptions };
