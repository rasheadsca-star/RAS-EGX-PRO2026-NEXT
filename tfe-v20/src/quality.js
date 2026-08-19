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

export function assessDataQuality({ bars, warnings = [], updateFailed = false, staleData = false, expectedSessionDate = null }) {
  const reasons = [];
  const lastDate = bars.at(-1)?.date ?? null;
  if (updateFailed) reasons.push('UPDATE_FAILED');
  if (staleData) reasons.push('STALE_DATA_FLAG');
  if (bars.length < POLICY.minBars) reasons.push('INSUFFICIENT_HISTORY');
  if (expectedSessionDate && lastDate && lastDate < expectedSessionDate) reasons.push('SESSION_BEHIND_REFERENCE');
  const warningText = warnings.map(String);
  const hardWarning = POLICY.quality.hardBlockWarnings.find((needle) => warningText.some((w) => w.includes(needle)));
  if (hardWarning) reasons.push(`HARD_WARNING:${hardWarning}`);
  const conflictPct = parseLatestConflictPct(warningText);
  if (conflictPct !== null && conflictPct >= POLICY.quality.conflictBlockPct) reasons.push('SOURCE_CONFLICT_BLOCK');

  let state = reasons.length ? 'BLOCKED' : 'TRUSTED';
  if (state !== 'BLOCKED' && conflictPct !== null && conflictPct >= POLICY.quality.conflictReviewPct) state = 'REVIEW';
  if (state !== 'BLOCKED' && warningText.length > 0 && state === 'TRUSTED') state = 'REVIEW';

  let score = 100;
  score -= Math.min(25, warningText.length * 4);
  if (conflictPct !== null) score -= Math.min(35, conflictPct * 1.2);
  if (state === 'REVIEW') score = Math.min(score, 78);
  if (state === 'BLOCKED') score = Math.min(score, 30);

  return { state, score: round(clamp(score), 1), reasons, warnings: warningText, conflictPct, lastDate };
}
