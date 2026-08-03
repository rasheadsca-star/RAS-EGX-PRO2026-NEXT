#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const REPORT_PATH = path.join(ROOT, 'data/stable/v16-fundamental-analysis.json');

function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function num(value, fallback = null) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function ageDays(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86400000) : null;
}

const report = readJson(REPORT_PATH, null);
if (!report || !Array.isArray(report.records)) throw new Error('Missing or malformed fundamental analysis report');
const freshDays = num(report.methodology?.statementFreshDays, 240);
const severeDays = num(report.methodology?.severeStaleDays, 365);
let staleTagged = 0;
let valuationsSuppressed = 0;
let severeStaleSuppressed = 0;

function applyQualityGate(row) {
  if (!row || typeof row !== 'object') return row;
  row.dataQuality = row.dataQuality && typeof row.dataQuality === 'object' ? row.dataQuality : {};
  const statementAge = num(row.statementAgeDays, ageDays(row.financialPeriodEnd || row.source?.officialPeriodEnd || row.sourceAsOf));
  const stale = statementAge === null || statementAge > freshDays;
  const severelyStale = statementAge === null || statementAge > severeDays;
  row.statementAgeDays = statementAge === null ? null : Math.round(statementAge);
  row.dataQuality.stale = stale;
  row.dataQuality.staleLevel = severelyStale ? 'SEVERE' : stale ? 'STALE' : 'FRESH';
  row.dataQuality.statementFreshDays = freshDays;
  row.dataQuality.severeStaleDays = severeDays;
  if (stale) staleTagged += 1;

  const peerCount = num(row.relativeFairValue?.peerCount, num(row.peerComparison?.peerCount, 0));
  if (row.relativeFairValue && typeof row.relativeFairValue === 'object') {
    row.relativeFairValue.peerCount = peerCount;
    row.relativeFairValue.minimumPeerCount = 3;
    if (row.relativeFairValue.fairValue != null && peerCount < 3) {
      row.relativeFairValue.fairValue = null;
      row.relativeFairValue.low = null;
      row.relativeFairValue.high = null;
      row.relativeFairValue.marginOfSafetyPct = null;
      row.relativeFairValue.confidence = 'NONE';
      row.relativeFairValue.suppressedReason = 'INSUFFICIENT_PEERS';
      valuationsSuppressed += 1;
    }
  }

  if (severelyStale && row.score != null) {
    row.score = null;
    row.grade = null;
    row.verdict = 'DATA_INSUFFICIENT';
    row.verdictAr = 'البيانات المالية قديمة بشدة؛ لا يتم نشر درجة استثمارية';
    row.dataQuality.scoreEligible = false;
    row.dataQuality.suppressedReason = 'SEVERELY_STALE_STATEMENTS';
    if (row.recommendationContext) row.recommendationContext.tradeCompatibility = 'TECHNICAL_ONLY_FINANCIAL_DATA_STALE';
    severeStaleSuppressed += 1;
  }
  return row;
}

report.records = report.records.map(applyQualityGate);
const byTicker = new Map(report.records.map(row => [String(row.ticker || '').toUpperCase(), row]));
report.recommendationAnalysis = (Array.isArray(report.recommendationAnalysis) ? report.recommendationAnalysis : []).map(row => {
  const ticker = String(row.ticker || '').toUpperCase();
  return byTicker.get(ticker) || applyQualityGate(row);
});
const currentRecommendationTickers = new Set(report.recommendationAnalysis.map(row => String(row.ticker || '').toUpperCase()));
report.summary = report.summary || {};
report.summary.scoredCompanies = report.records.filter(row => row.score != null).length;
report.summary.freshStatements = report.records.filter(row => row.dataQuality?.stale === false).length;
report.summary.staleStatements = report.records.filter(row => row.dataQuality?.stale === true).length;
report.summary.currentRecommendationFinancialCoverage = report.records.filter(row => currentRecommendationTickers.has(String(row.ticker || '').toUpperCase()) && row.score != null).length;
report.qualityGate = {
  version: 'V16_FUNDAMENTAL_QUALITY_GATE_1.0',
  appliedAt: new Date().toISOString(),
  minimumPeerCount: 3,
  statementFreshDays: freshDays,
  severeStaleDays: severeDays,
  staleTagged,
  valuationsSuppressed,
  severeStaleSuppressed,
};
report.generatedAt = new Date().toISOString();
writeJson(REPORT_PATH, report);
console.log(JSON.stringify({ records: report.records.length, staleTagged, valuationsSuppressed, severeStaleSuppressed, scored: report.summary.scoredCompanies }, null, 2));
