'use strict';

const dateOf = row => String(row?.date || row?.sessionDate || '').slice(0, 10);
const bad = row => /invalid|conflict|failed|unresolved|quarantined/i.test(String(row?.validationStatus || ''));
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

// Preserve certified history, then append ALL observed finalized sessions up to
// the handoff date. Never fabricate missing sessions or import future bars.
function mergeFinalizedHistory(baseline, source, expected) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error('Invalid expected session');
  const prior = baseline.sessions || [];
  const dates = prior.map(dateOf);
  if (!prior.length || dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d)) || new Set(dates).size !== dates.length) {
    throw new Error('Invalid certified history dates');
  }
  const last = [...dates].sort().at(-1);
  if (last >= expected) throw new Error('Expected session must follow certified history');
  const added = (source.sessions || []).filter(r => dateOf(r) > last && dateOf(r) <= expected);
  if (!added.some(r => dateOf(r) === expected)) return null;
  const seen = new Set();
  for (const row of added) {
    const date = dateOf(row);
    const prices = [row.open, row.high, row.low, row.close];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date) || bad(row) ||
        !prices.every(v => numeric(v) && Number(v) > 0) ||
        !numeric(row.volume) || Number(row.volume) < 0 ||
        Number(row.high) < Math.max(Number(row.open), Number(row.close), Number(row.low)) ||
        Number(row.low) > Math.min(Number(row.open), Number(row.close), Number(row.high))) {
      throw new Error('Invalid intervening history: ' + (source.ticker || '') + ' ' + date);
    }
    seen.add(date);
  }
  const sessions = [...prior, ...added].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  return {
    ...baseline, sessions, firstSession: dateOf(sessions[0]), lastSession: expected,
    availableSessions: sessions.length, staleData: false, updateFailed: false,
    historyOverlay: {policy: 'ALL_OBSERVED_SESSIONS_AFTER_CERTIFIED_BASELINE', baselineLastSession: last,
      expectedSession: expected, appendedSessions: added.length, appendedDates: [...seen].sort()}
  };
}

module.exports = {mergeFinalizedHistory};
