import { POLICY } from './policy.js';
import { clamp, round, toNum } from './math.js';

export function normalizeBars(rows = []) {
  const byDate = new Map();
  let rejected = 0;
  for (const row of rows) {
    const date = String(row.date ?? row.sessionDate ?? '').slice(0, 10);
    const open = toNum(row.open), high = toNum(row.high), low = toNum(row.low), close = toNum(row.close);
    const volume = Math.max(0, toNum(row.volume) ?? 0);
    const valueTraded = toNum(row.valueTraded ?? row.turnover);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const validOhlc = [open, high, low, close].every((x) => Number.isFinite(x) && x > 0)
      && high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low;
    if (!validDate || !validOhlc) { rejected += 1; continue; }
    byDate.set(date, { date, open, high, low, close, volume, valueTraded });
  }
  return { bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), rejected };
}

export function parseLatestConflictPct(warnings = []) {
  for (const w of warnings) {
    const m = String(w).match(/latest_close_conflict:([0-9.]+)%/i);
    if (m) return Number(m[1]);
  }
  return null;
}

export function validateLatestPriceTruth({ bars = [], priceTruthLatest = null } = {}) {
  const last = bars.at(-1) ?? null;
  const truth = priceTruthLatest && typeof priceTruthLatest === 'object' ? priceTruthLatest : null;
  const lastDate = last?.date ?? null;
  const truthDate = String(truth?.sourceSessionDate ?? truth?.date ?? '').slice(0, 10) || null;
  const lastClose = toNum(last?.close);
  const truthClose = toNum(truth?.close);
  const confidence = toNum(truth?.confidence) ?? 0;
  const validationStatus = String(truth?.validationStatus ?? '');
  const source = String(truth?.source ?? '');
  const closeDiffPct = lastClose && truthClose
    ? Math.abs(lastClose - truthClose) / lastClose * 100
    : null;
  const sessionConfirmed = /(?:session_confirmed|officially_verified_latest_close|cross_verified_latest_close)/i.test(validationStatus);
  const independentSource = /(mubasher|egx|investing)/i.test(source);
  const resolved = Boolean(
    lastDate &&
    truthDate === lastDate &&
    lastClose > 0 &&
    truthClose > 0 &&
    closeDiffPct !== null &&
    closeDiffPct <= 0.25 &&
    confidence >= 80 &&
    sessionConfirmed &&
    independentSource
  );
  return {
    resolved,
    lastDate,
    truthDate,
    lastClose,
    truthClose,
    closeDiffPct: closeDiffPct === null ? null : round(closeDiffPct, 4),
    confidence,
    validationStatus: validationStatus || null,
    source: source || null,
  };
}

export function assessDataQuality({
  bars,
  warnings = [],
  updateFailed = false,
  staleData = false,
  expectedSessionDate = null,
  symbolVerified = null,
  symbolVerification = null,
  officiallyVerifiedLatestSession = null,
  priceTruthLatest = null,
} = {}) {
  const reasons = [];
  const reviewFlags = [];
  const lastDate = bars.at(-1)?.date ?? null;
  if (updateFailed) reasons.push('UPDATE_FAILED');
  if (staleData) reasons.push('STALE_DATA_FLAG');
  if (bars.length < POLICY.minBars) reasons.push('INSUFFICIENT_HISTORY');
  if (expectedSessionDate && lastDate && lastDate < expectedSessionDate) reasons.push('SESSION_BEHIND_REFERENCE');
  if (symbolVerified === false || symbolVerification?.verified === false) reasons.push('SYMBOL_IDENTITY_UNVERIFIED');

  const identityDiffPct = toNum(symbolVerification?.evidence?.localDifferencePct);
  const identityMaxDiffPct = toNum(symbolVerification?.evidence?.guardedMaxDifferencePct) ?? 8;
  const identityReferenceDivergence = identityDiffPct !== null && identityDiffPct > identityMaxDiffPct;
  if (identityReferenceDivergence) reviewFlags.push('LOCAL_REFERENCE_DIVERGENCE_REVIEW');
  if (symbolVerification?.guardedVerified === true) reviewFlags.push('GUARDED_IDENTITY_REVIEW');
  if (officiallyVerifiedLatestSession === false) reviewFlags.push('LATEST_SESSION_NOT_OFFICIALLY_VERIFIED');

  const warningText = warnings.map(String);
  const hardWarning = POLICY.quality.hardBlockWarnings.find((needle) => warningText.some((w) => w.includes(needle)));
  if (hardWarning) reasons.push(`HARD_WARNING:${hardWarning}`);
  const reportedConflictPct = parseLatestConflictPct(warningText);
  const latestPriceTruth = validateLatestPriceTruth({ bars, priceTruthLatest });
  const priceReconciliationResolved = reportedConflictPct !== null
    && reportedConflictPct >= POLICY.quality.conflictBlockPct
    && officiallyVerifiedLatestSession !== true
    && latestPriceTruth.resolved;
  const conflictPct = priceReconciliationResolved ? null : reportedConflictPct;
  if (priceReconciliationResolved) reviewFlags.push('PRICE_TRUTH_RECONCILIATION_RESOLVED');
  if (conflictPct !== null && conflictPct >= POLICY.quality.conflictReviewPct) reviewFlags.push('LOCAL_REFERENCE_CLOSE_CONFLICT_REVIEW');
  const publicationHold = conflictPct !== null && conflictPct >= POLICY.quality.conflictBlockPct;
  if (publicationHold) reviewFlags.push('HIGH_LOCAL_REFERENCE_CONFLICT_REVIEW');
  if (warningText.length > 0) reviewFlags.push('SOURCE_WARNING_PRESENT');

  const state = reasons.length ? 'BLOCKED' : (reviewFlags.length ? 'REVIEW' : 'TRUSTED');
  let score = 100;
  score -= Math.min(16, warningText.length * 4);
  if (conflictPct !== null) score -= Math.min(18, conflictPct * 0.45);
  if (identityReferenceDivergence) score -= Math.min(10, identityDiffPct * 0.10);
  if (officiallyVerifiedLatestSession === false) score = Math.min(score, 85);
  if (state === 'REVIEW') score = Math.min(score, 78);
  if (state === 'BLOCKED') score = Math.min(score, 30);

  return {
    state,
    score: round(clamp(score), 1),
    reasons,
    reviewFlags: [...new Set(reviewFlags)],
    publicationHold,
    publicationHoldReason: publicationHold ? 'PRICE_RECONCILIATION_REQUIRED' : null,
    warnings: warningText,
    conflictPct,
    reportedConflictPct,
    priceReconciliationResolved,
    latestPriceTruth,
    identityDiffPct,
    identityMaxDiffPct,
    identityReferenceDivergence,
    latestOfficiallyVerified: officiallyVerifiedLatestSession,
    lastDate,
  };
}
