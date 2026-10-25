'use strict';

// Pure reconciliation policy. No filesystem writes occur in this module.
// Transactional publication and crash recovery are separate required gates.
const crypto = require('node:crypto');
const SOURCE = 'v16_session_aware_price_truth';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function hash(row) { return crypto.createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex'); }
function dateOf(row) { return String(row?.date || row?.sessionDate || '').slice(0, 10); }
function acceptedManifest(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.ticker || !dateOf(row)) throw new Error('INVALID_ACCEPTED_ROW');
    if (map.has(row.ticker)) throw new Error('DUPLICATE_ACCEPTED_TICKER');
    map.set(row.ticker, { ticker: row.ticker, date: dateOf(row), rowSha256: hash(row) });
  }
  return [...map.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
}
function reconcile({ document, ticker, expectedSession, manifest, rejectionReason = 'NOT_ACCEPTED_IN_LATEST_PRICE_TRUTH' }) {
  if (!expectedSession || !ticker || !Array.isArray(document?.sessions)) throw new Error('INVALID_RECONCILIATION_INPUT');
  const accepted = new Map(manifest.map(x => [x.ticker, x]));
  if (accepted.size !== manifest.length) throw new Error('DUPLICATE_MANIFEST_TICKER');
  const current = document.sessions;
  const quarantined = [];
  const sessions = current.filter(row => {
    const affected = row?.source === SOURCE && dateOf(row) === expectedSession && !accepted.has(ticker);
    if (affected) quarantined.push({ ticker, session: expectedSession, rowSha256: hash(row), row, rejectionReason });
    return !affected;
  });
  const latest = sessions.at(-1) || null;
  const result = { ...document, sessions, availableSessions: sessions.length,
    firstSession: sessions.length ? dateOf(sessions[0]) : null,
    lastSession: latest ? dateOf(latest) : null,
    staleData: !latest || dateOf(latest) !== expectedSession,
    priceTruthLatest: latest ? { date: dateOf(latest), close: latest.close, source: latest.primarySource || latest.source || null,
      validationStatus: latest.validationStatus || null, confidence: latest.confidence?.overall ?? null,
      sourceSessionDate: latest.sourceSessionDate || null } : null };
  return { document: quarantined.length ? result : document, quarantined };
}
function verifyManifest(manifest, historyByTicker) {
  for (const entry of manifest) {
    const matches = (historyByTicker[entry.ticker]?.sessions || []).filter(row => dateOf(row) === entry.date && hash(row) === entry.rowSha256);
    if (matches.length !== 1) throw new Error('MANIFEST_HISTORY_HASH_MISMATCH:' + entry.ticker);
  }
  return true;
}
module.exports = { SOURCE, hash, acceptedManifest, reconcile, verifyManifest };
