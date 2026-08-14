#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const filePath = path.join(root, 'data/v17/recommendation-track-record.json');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits = 4) {
  const n = finite(value);
  if (n === null) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
function mean(values) {
  const clean = values.map(finite).filter(value => value !== null);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}
function profitFactor(values) {
  const clean = values.map(finite).filter(value => value !== null);
  const gains = clean.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(clean.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  if (!losses) return gains > 0 ? null : null;
  return gains / losses;
}
function maxDrawdown(values) {
  const clean = values.map(finite).filter(value => value !== null);
  if (!clean.length) return null;
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of clean) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, (equity / peak - 1) * 100);
  }
  return worst;
}
function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}

const data = readJson(filePath, null);
if (!data || data.schemaVersion !== '17.0.0-recommendation-track-record-1') {
  throw new Error('Recommendation track record is missing or has an unexpected schema');
}
if (data?.policy?.backfillCountsAsNativeV17Evidence !== false || data?.policy?.researchCountsAsNativeV17Evidence !== false) {
  throw new Error('Backfill/research evidence separation contract failed');
}

const exactSessions = Array.isArray(data?.exactMethodRecordedSessions?.sessions)
  ? data.exactMethodRecordedSessions.sessions
  : [];
for (const row of exactSessions) {
  if (row.originalLiveResolved !== true && row.retroactiveStatus !== 'RETROACTIVELY_RESOLVED') {
    row.retroactiveNetReturnPct = null;
    if (!row.outcomeDate) row.outcomeDate = null;
  }
}
const exactOriginalResolved = exactSessions.filter(row => row.originalLiveResolved === true && finite(row.originalLiveNetReturnPct) !== null);
const exactRetroResolved = exactSessions.filter(row => row.originalLiveResolved !== true && row.retroactiveStatus === 'RETROACTIVELY_RESOLVED' && finite(row.retroactiveNetReturnPct) !== null);
const exactOriginalReturns = exactOriginalResolved.map(row => finite(row.originalLiveNetReturnPct));
data.exactMethodRecordedSessions.summary = {
  ...(data.exactMethodRecordedSessions.summary || {}),
  recordedSessions: exactSessions.length,
  originalLiveResolvedSessions: exactOriginalResolved.length,
  retroactivelyResolvedSessions: exactRetroResolved.length,
  originalLiveAverageNetReturnPct: round(mean(exactOriginalReturns)),
};
if (data?.confidence?.exactMethodLive) {
  data.confidence.exactMethodLive.resolvedSessions = exactOriginalResolved.length;
  data.confidence.exactMethodLive.averageNetReturnPct = round(mean(exactOriginalReturns));
  data.confidence.exactMethodLive.profitFactor = round(profitFactor(exactOriginalReturns));
  data.confidence.exactMethodLive.maximumDrawdownPct = round(maxDrawdown(exactOriginalReturns));
  data.confidence.exactMethodLive.retroactivelyResolvedSessionsShownSeparately = exactRetroResolved.length;
}

const nativeEntries = Array.isArray(data?.nativeV17?.entries) ? data.nativeV17.entries : [];
for (const row of nativeEntries) {
  if (row.resolved !== true) {
    row.basketSleeveReturnPct = null;
    row.totalPortfolioReturnPct = null;
  }
}
const nativeResolved = nativeEntries.filter(row => row.resolved === true && finite(row.basketSleeveReturnPct) !== null);
const nativeReturns = nativeResolved.map(row => finite(row.basketSleeveReturnPct));
data.nativeV17.summary = {
  ...(data.nativeV17.summary || {}),
  issuedSessions: nativeEntries.length,
  resolvedSessions: nativeResolved.length,
  wins: nativeReturns.filter(value => value > 0).length,
  losses: nativeReturns.filter(value => value < 0).length,
  averageBasketReturnPct: round(mean(nativeReturns)),
  profitFactor: round(profitFactor(nativeReturns)),
  maximumDrawdownPct: round(maxDrawdown(nativeReturns)),
};
if (data?.confidence?.nativeV17Live) {
  data.confidence.nativeV17Live.issuedSessions = nativeEntries.length;
  data.confidence.nativeV17Live.resolvedSessions = nativeResolved.length;
  data.confidence.nativeV17Live.averageBasketReturnPct = round(mean(nativeReturns));
}

const records = Array.isArray(data?.recordedRecommendationBackfill?.records)
  ? data.recordedRecommendationBackfill.records
  : [];
for (const row of records) {
  if (row.provenance === 'RECORDED_SIGNAL_PENDING_TRUSTED_HISTORY') row.netReturnPct = null;
}
const evaluatedRecords = records.filter(row =>
  row.provenance !== 'RECORDED_SIGNAL_PENDING_TRUSTED_HISTORY' && finite(row.netReturnPct) !== null
);
const evaluatedReturns = evaluatedRecords.map(row => finite(row.netReturnPct));
const finalResolvedRecords = records.filter(row => {
  const status = String(row.status || '').toUpperCase();
  return status.includes('TARGET') || status.includes('STOP') || status === 'TIME_EXIT' ||
    status.startsWith('NOT_ENTERED_') || status === 'AMBIGUOUS_TREATED_AS_STOP';
});
const sameTechnique = records.filter(row => row.strategyId === 'V16_9_EQUAL_WEIGHT_BASKET');
data.recordedRecommendationBackfill.summary = {
  ...(data.recordedRecommendationBackfill.summary || {}),
  recordedRecommendations: records.length,
  evaluatedWithStoredOrTrustedReturn: evaluatedRecords.length,
  finalResolvedRecommendations: finalResolvedRecords.length,
  pendingTrustedHistory: records.filter(row => row.provenance === 'RECORDED_SIGNAL_PENDING_TRUSTED_HISTORY').length,
  sameTechniqueRecordedRecommendations: sameTechnique.length,
  wins: evaluatedReturns.filter(value => value > 0).length,
  losses: evaluatedReturns.filter(value => value < 0).length,
  flatOrNoEntry: evaluatedReturns.filter(value => value === 0).length,
  averageNetReturnPct: round(mean(evaluatedReturns)),
  profitFactor: round(profitFactor(evaluatedReturns)),
};
delete data.recordedRecommendationBackfill.summary.resolvedWithStoredOrTrustedBackfill;

data.normalization = {
  ...(data.normalization || {}),
  version: 'NULL_SAFE_V1',
  normalizedAt: new Date().toISOString(),
  pendingReturnsRemainNull: true,
  pendingRowsNeverCountAsResolved: true,
};

writeJsonAtomic(filePath, data);
console.log(JSON.stringify({
  schemaVersion: data.schemaVersion,
  exactOriginalLiveResolved: exactOriginalResolved.length,
  exactRetroResolved: exactRetroResolved.length,
  nativeIssued: nativeEntries.length,
  nativeResolved: nativeResolved.length,
  recorded: records.length,
  evaluated: evaluatedRecords.length,
  finalResolved: finalResolvedRecords.length,
  pendingTrustedHistory: data.recordedRecommendationBackfill.summary.pendingTrustedHistory,
}, null, 2));
