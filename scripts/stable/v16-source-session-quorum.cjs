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
  // Normalize non-breaking spaces because some rendered "Last update" labels use them.
  const normalized = String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const m = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s+market\s+time$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]); const ap = m[3].toUpperCase();
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (ap === 'AM' && h === 12) h = 0;
  if (ap === 'PM' && h !== 12) h += 12;
  return h * 60 + min;
}
function isMubasherEgxStockRow(row) {
  if (String(row?.source || '').trim() !== 'mubasher_symbol_pages') return false;
  try {
    const u = new URL(String(row?.sourceUrl || ''));
    const host = u.hostname.toLowerCase();
    const hostOk = host === 'english.mubasher.info' || host === 'www.mubasher.info' || host === 'mubasher.info';
    const pathOk = /^\/markets\/EGX\/stocks\/[^/]+\/?$/i.test(u.pathname);
    return hostOk && pathOk;
  } catch { return false; }
}

const market = readJson(MARKET_PATH, null);
if (!market || !Array.isArray(market.rows)) throw new Error('data/market.json rows are required');
const now = new Date();
const expectedSession = expectedLatestCompletedSessionCairo(now);
const p = cairoParts(now);
const cairoDate = `${p.year}-${p.month}-${p.day}`;
const cairoMinutes = Number(p.hour) * 60 + Number(p.minute);
const sameDayAfterClose = cairoDate === expectedSession && cairoMinutes >= 15 * 60;
const marketFetchDate = dateOnly(market.generatedAt) || dateOnly(market.updatedAt);

function classifyTimeOnlyRow(row) {
  const explicit = dateOnly(row?.sourceSessionDate);
  if (explicit) return { eligible:false, reason:'HAS_EXPLICIT_SOURCE_DATE', explicit };
  if (!isMubasherEgxStockRow(row)) return { eligible:false, reason:'NOT_MUBASHER_EGX_STOCK_ROW', source:row?.source || null, sourceUrl:row?.sourceUrl || null };
  const mins = marketMinutes(row?.sourceMarketTime);
  if (mins === null) return { eligible:false, reason:'INVALID_SOURCE_MARKET_TIME', sourceMarketTime:row?.sourceMarketTime || null };
  if (mins < 9 * 60 || mins > 16 * 60) return { eligible:false, reason:'SOURCE_MARKET_TIME_OUTSIDE_SESSION', sourceMarketTime:row?.sourceMarketTime || null, minutes:mins };
  const rowFetchDate = dateOnly(row?.updatedAt);
  const fetchedDate = rowFetchDate || marketFetchDate;
  if (!fetchedDate) return { eligible:false, reason:'FETCH_DATE_MISSING' };
  if (fetchedDate !== expectedSession) return { eligible:false, reason:'FETCH_DATE_MISMATCH', fetchedDate, expectedSession };
  return { eligible:true, reason:'ELIGIBLE_TIME_ONLY_MUBASHER_ROW', minutes:mins, fetchedDate };
}

const classifications = market.rows.map(row => ({ row, result: classifyTimeOnlyRow(row) }));
const reasonCounts = {};
for (const { result } of classifications) reasonCounts[result.reason] = (reasonCounts[result.reason] || 0) + 1;
const diagnosticSamples = classifications.slice(0, 5).map(({ row, result }) => ({
  symbol: row?.symbol || null,
  source: row?.source || null,
  sourceUrl: row?.sourceUrl || null,
  sourceMarketTime: row?.sourceMarketTime || null,
  sourceSessionDate: row?.sourceSessionDate || null,
  updatedAt: row?.updatedAt || null,
  classification: result
}));

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
const candidates = classifications.filter(x => x.result.eligible).map(x => x.row);
const candidateCoveragePct = market.rows.length ? candidates.length / market.rows.length * 100 : 0;
const inferenceQuorumPassed = Boolean(
  !explicitQuorumPassed &&
  sameDayAfterClose &&
  market.ok === true &&
  /mubasher_symbol_pages_precise/i.test(String(market.source || '')) &&
  marketFetchDate === expectedSession &&
  candidates.length >= MIN_QUORUM &&
  candidateCoveragePct >= MIN_COVERAGE_PCT &&
  explicitMismatches === 0
);
const quorumPassed = explicitQuorumPassed || inferenceQuorumPassed;

let promoted = 0;
if (inferenceQuorumPassed) {
  const checkedAt = new Date().toISOString();
  market.rows = market.rows.map(row => {
    if (!classifyTimeOnlyRow(row).eligible) return row;
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
  schemaVersion: '16.3.7-source-session-quorum-3',
  checkedAt: new Date().toISOString(),
  expectedSession,
  cairoDate,
  sameDayAfterClose,
  marketFetchDate,
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
  candidateDiagnostics: { reasonCounts, samples: diagnosticSamples },
  policy: {
    explicitEvidencePreferredOverInference: true,
    workflowTimestampAloneNeverDefinesSession: true,
    sourceMarketTimeRequiredForInferenceOnly: true,
    exactMubasherEgxSourceIdentityRequiredForInference: true,
    regularCompletedTradingDayRequiredForInference: true,
    sameDayMarketFetchContextRequiredForInference: true,
    crossSymbolQuorumRequired: true,
    explicitDateConflictFailsClosed: true,
    downstreamPriceJumpAndChangeConsistencyGuardsRemainRequired: true
  }
};
writeJson(MARKET_PATH, market);
console.log(JSON.stringify(market.sourceSessionQuorumInference, null, 2));
if (!quorumPassed) process.exitCode = 2;
