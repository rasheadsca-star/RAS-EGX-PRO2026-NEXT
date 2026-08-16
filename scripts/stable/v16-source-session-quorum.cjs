#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const MIN_QUORUM = Number(process.env.EGX_SESSION_TIME_QUORUM_MIN || 80);
const MIN_COVERAGE_PCT = Number(process.env.EGX_SESSION_TIME_QUORUM_COVERAGE_PCT || 80);

function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function dateOnly(value) { return (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null; }
function cairoParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
function expectedLatestCompletedSessionCairo(now = new Date()) {
  const p = cairoParts(now);
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const hour = Number(p.hour) + Number(p.minute) / 60;
  const trading = () => [0,1,2,3,4].includes(d.getUTCDay());
  if (trading() && hour < 15) d.setUTCDate(d.getUTCDate() - 1);
  while (!trading()) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function marketMinutes(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s+market time$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]); const ap = m[3].toUpperCase();
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (ap === 'AM' && h === 12) h = 0;
  if (ap === 'PM' && h !== 12) h += 12;
  return h * 60 + min;
}
function eligibleTimeOnlyRow(row, expectedSession) {
  if (dateOnly(row?.sourceSessionDate)) return false;
  if (!/^https:\/\/(?:english\.|www\.)?mubasher\.info\/markets\/EGX\/stocks\//i.test(String(row?.sourceUrl || ''))) return false;
  const mins = marketMinutes(row?.sourceMarketTime);
  if (mins === null || mins < 9 * 60 || mins > 16 * 60) return false;
  const fetchedDate = dateOnly(row?.updatedAt) || dateOnly(market?.generatedAt) || dateOnly(market?.updatedAt);
  return fetchedDate === expectedSession;
}

const market = readJson(MARKET_PATH, null);
if (!market || !Array.isArray(market.rows)) throw new Error('data/market.json rows are required');
const now = new Date();
const expectedSession = expectedLatestCompletedSessionCairo(now);
const p = cairoParts(now);
const cairoDate = `${p.year}-${p.month}-${p.day}`;
const cairoMinutes = Number(p.hour) * 60 + Number(p.minute);
const sameDayAfterClose = cairoDate === expectedSession && cairoMinutes >= 15 * 60;
const explicitExpectedRows = market.rows.filter(r => dateOnly(r?.sourceSessionDate) === expectedSession);
const explicitDates = market.rows.map(r => dateOnly(r?.sourceSessionDate)).filter(Boolean);
const explicitMismatches = explicitDates.filter(d => d !== expectedSession).length;
const explicitCoveragePct = market.rows.length ? explicitExpectedRows.length / market.rows.length * 100 : 0;
const explicitQuorumPassed = Boolean(
  market.ok === true &&
  /mubasher_symbol_pages_precise/i.test(String(market.source || '')) &&
  explicitExpectedRows.length >= MIN_QUORUM &&
  explicitCoveragePct >= MIN_COVERAGE_PCT &&
  explicitMismatches === 0
);
const candidates = market.rows.filter(r => eligibleTimeOnlyRow(r, expectedSession));
const candidateCoveragePct = market.rows.length ? candidates.length / market.rows.length * 100 : 0;
const inferenceQuorumPassed = Boolean(
  !explicitQuorumPassed &&
  sameDayAfterClose &&
  market.ok === true &&
  /mubasher_symbol_pages_precise/i.test(String(market.source || '')) &&
  candidates.length >= MIN_QUORUM &&
  candidateCoveragePct >= MIN_COVERAGE_PCT &&
  explicitMismatches === 0
);
const quorumPassed = explicitQuorumPassed || inferenceQuorumPassed;

let promoted = 0;
if (inferenceQuorumPassed) {
  const checkedAt = new Date().toISOString();
  market.rows = market.rows.map(row => {
    if (!eligibleTimeOnlyRow(row, expectedSession)) return row;
    promoted += 1;
    return {
      ...row,
      sourceSessionDate: expectedSession,
      marketSessionDate: row.marketSessionDate || expectedSession,
      sourceSessionEvidence: 'mubasher_time_only_same_day_cross_symbol_quorum',
      sourceSessionCheckedAt: checkedAt,
    };
  });
}
market.sourceSessionQuorumInference = {
  schemaVersion: '16.3.6-source-session-quorum-2',
  checkedAt: new Date().toISOString(),
  expectedSession,
  cairoDate,
  sameDayAfterClose,
  marketSource: market.source || null,
  totalRows: market.rows.length,
  explicitExpectedRows: explicitExpectedRows.length,
  explicitCoveragePct: Number(explicitCoveragePct.toFixed(2)),
  explicitQuorumPassed,
  timeOnlyCandidates: candidates.length,
  candidateCoveragePct: Number(candidateCoveragePct.toFixed(2)),
  inferenceQuorumPassed,
  minimumQuorum: MIN_QUORUM,
  minimumCoveragePct: MIN_COVERAGE_PCT,
  explicitMismatches,
  quorumPassed,
  mode: explicitQuorumPassed ? 'EXPLICIT_SOURCE_SESSION_EVIDENCE' : inferenceQuorumPassed ? 'TIME_ONLY_CROSS_SYMBOL_INFERENCE' : 'FAIL_CLOSED',
  promotedRows: promoted,
  policy: {
    explicitEvidencePreferredOverInference: true,
    workflowTimestampAloneNeverDefinesSession: true,
    sourceMarketTimeRequiredForInferenceOnly: true,
    exactMubasherEgxSourceUrlRequiredForInference: true,
    regularCompletedTradingDayRequiredForInference: true,
    crossSymbolQuorumRequired: true,
    explicitDateConflictFailsClosed: true,
    downstreamPriceJumpAndChangeConsistencyGuardsRemainRequired: true
  }
};
writeJson(MARKET_PATH, market);
console.log(JSON.stringify(market.sourceSessionQuorumInference, null, 2));
if (!quorumPassed) process.exitCode = 2;
