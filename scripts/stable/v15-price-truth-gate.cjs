#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const FETCH_STATUS_PATH = path.join(ROOT, 'data/fetch-status.json');
const HISTORY_DIR = path.join(ROOT, 'data/history');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

function dateOnly(value) {
  return (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
}

function expectedLatestCompletedSessionCairo(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]),
  );
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const cairoHour = Number(parts.hour) + Number(parts.minute) / 60;
  const isTradingDay = () => [0, 1, 2, 3, 4].includes(date.getUTCDay());
  if (isTradingDay() && cairoHour < 15) date.setUTCDate(date.getUTCDate() - 1);
  while (!isTradingDay()) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function rowIsTrusted(row) {
  const warnings = Array.isArray(row?.warnings) ? row.warnings.map(String) : [];
  const confidence = Number(row?.confidence?.overall);
  if (String(row?.validationStatus || '') === 'source_conflict') return false;
  if (warnings.some(warning => /local_price_conflict|latest_close_conflict/i.test(warning))) return false;
  if (Number.isFinite(confidence) && confidence < 60) return false;
  return Number(row?.close) > 0;
}

function recommendationPriceIsTrusted(recommendation, sessionDate) {
  const ticker = String(recommendation?.ticker || '').toUpperCase();
  const file = path.join(HISTORY_DIR, `${ticker}.json`);
  const document = readJson(file, {});
  const rows = Array.isArray(document?.sessions) ? document.sessions : [];
  const row = rows.find(item => dateOnly(item?.date || item?.sessionDate) === sessionDate);
  if (!row || !rowIsTrusted(row)) return false;
  const reportPrice = Number(recommendation?.close);
  const sourcePrice = Number(row?.close);
  if (!(reportPrice > 0 && sourcePrice > 0)) return false;
  return Math.abs(reportPrice / sourcePrice - 1) <= 0.005;
}

const decision = readJson(DECISION_PATH, {});
const fetchStatus = readJson(FETCH_STATUS_PATH, {});
const expectedLatestSession = expectedLatestCompletedSessionCairo();
const sessionDate = dateOnly(decision?.sessionDate);
const fetchExecutionGrade = fetchStatus?.ok === true
  && fetchStatus?.realFetch === true
  && fetchStatus?.executionGrade === true;
const sessionCurrent = sessionDate === expectedLatestSession;
const originalRecommendations = Array.isArray(decision?.recommendations) ? decision.recommendations : [];
const trustedRecommendations = originalRecommendations.filter(item => recommendationPriceIsTrusted(item, sessionDate));
const allRecommendationPricesTrusted = trustedRecommendations.length === originalRecommendations.length;
const priceTruthReady = fetchExecutionGrade && sessionCurrent && allRecommendationPricesTrusted;

if (!priceTruthReady) {
  decision.practicalReady = false;
  decision.status = 'PRICE_DATA_NOT_EXECUTION_GRADE';
  decision.statusAr = `تم إيقاف التوصيات: أسعار التقرير من ${sessionDate || 'جلسة غير معروفة'} بينما آخر جلسة مكتملة متوقعة ${expectedLatestSession}. مصدر الأسعار الحالي غير صالح للتنفيذ أو توجد تعارضات سعرية.`;
  decision.recommendations = [];
  decision.extendedMomentumWatch = [];
}

decision.schemaVersion = '15.0.1';
decision.expectedLatestSession = expectedLatestSession;
decision.priceTruth = {
  ready: priceTruthReady,
  fetchOk: fetchStatus?.ok === true,
  realFetch: fetchStatus?.realFetch === true,
  executionGrade: fetchStatus?.executionGrade === true,
  fetchMode: fetchStatus?.mode || null,
  fetchGeneratedAt: fetchStatus?.generatedAt || null,
  sessionCurrent,
  recommendationPricesTrusted: allRecommendationPricesTrusted,
  originalRecommendationCount: originalRecommendations.length,
  trustedRecommendationCount: trustedRecommendations.length,
};
decision.guardrails = {
  ...(decision.guardrails || {}),
  realFetchRequired: true,
  executionGradeRequired: true,
  currentSessionRequired: true,
  sourceConflictsRejected: true,
};
decision.marketScan = {
  ...(decision.marketScan || {}),
  expectedLatestSession,
};

writeJsonAtomic(DECISION_PATH, decision);
console.log(JSON.stringify({
  sessionDate,
  expectedLatestSession,
  fetchExecutionGrade,
  allRecommendationPricesTrusted,
  priceTruthReady,
  publishedRecommendations: decision.recommendations.map(item => item.ticker),
}, null, 2));
