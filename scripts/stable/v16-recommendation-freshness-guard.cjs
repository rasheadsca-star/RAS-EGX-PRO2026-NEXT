#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildMainAppGovernance } = require('./v16-main-app-governance.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const PRICE_PATH = path.join(ROOT, 'data/stable/v15-price-truth.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-recommendation-freshness.json');
const CONSENSUS_SCRIPT = path.join(ROOT, 'scripts/stable/v16-main-app-consensus.cjs');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function cairoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}
function previousDate(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function weekday(dateText) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(`${dateText}T12:00:00Z`));
}
function isWeekend(dateText) {
  return ['Fri', 'Sat'].includes(weekday(dateText));
}
function holidaySet() {
  return new Set(String(process.env.EGX_MARKET_HOLIDAYS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
}
function previousTradingDate(dateText, holidays) {
  let cursor = dateText;
  while (isWeekend(cursor) || holidays.has(cursor)) cursor = previousDate(cursor);
  return cursor;
}
function expectedSession(now) {
  const holidays = holidaySet();
  let candidate = now.date;
  // EGX regular trading closes at 14:30 Cairo. Keep a 30-minute buffer for
  // delayed public-source finalisation, then accept the current session from 15:00.
  if (now.hour < 15) candidate = previousDate(candidate);
  return previousTradingDate(candidate, holidays);
}

const decision = readJson(DECISION_PATH);
const price = readJson(PRICE_PATH);
if (!decision.sessionDate) throw new Error('Decision sessionDate is missing');

const now = cairoParts();
const expected = expectedSession(now);
const priceSession = price.expectedSession || null;
const sourceSession = price.focusAudit?.find(row => row.historyLastSession)?.historyLastSession || priceSession;
const isFresh = decision.sessionDate === expected
  && priceSession === expected
  && price.executionGrade === true;
const reasonCodes = [];
if (decision.sessionDate !== expected) reasonCodes.push('DECISION_SESSION_BEHIND_EXPECTED');
if (priceSession !== expected) reasonCodes.push('PRICE_SESSION_BEHIND_EXPECTED');
if (price.executionGrade !== true) reasonCodes.push('PRICE_NOT_EXECUTION_GRADE');

const previousStatus = decision.status;
const previousStatusAr = decision.statusAr;
decision.freshness = {
  checkedAt: new Date().toISOString(),
  checkedAtCairo: `${now.date} ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`,
  expectedSession: expected,
  decisionSession: decision.sessionDate,
  priceSession,
  sourceSession,
  isFresh,
  currentSessionReady: isFresh,
  displayMode: isFresh ? 'CURRENT_SESSION' : 'PREVIOUS_SESSION_REFERENCE_ONLY',
  reasonCodes,
};
decision.recommendationsCurrent = isFresh;
decision.currentSessionReady = isFresh;
if (!isFresh) {
  decision.status = 'STALE_RECOMMENDATIONS_AWAITING_FRESH_PRICES';
  decision.statusAr = `المعروض توصيات آخر جلسة موثقة (${decision.sessionDate})، وليس توصيات جلسة ${expected}. لا تُستخدم للتنفيذ حتى اعتماد أسعار الجلسة الجديدة.`;
  decision.recommendations = Array.isArray(decision.recommendations)
    ? decision.recommendations.map(row => ({
        ...row,
        currentSessionEligible: false,
        referenceOnly: true,
        originalStatus: row.originalStatus || row.status,
        originalStatusAr: row.originalStatusAr || row.statusAr,
        status: 'PREVIOUS_SESSION_REFERENCE_ONLY',
        statusAr: `مرجع من جلسة ${decision.sessionDate} فقط؛ بانتظار اعتماد جلسة ${expected}.`,
      }))
    : [];
} else {
  decision.status = previousStatus === 'STALE_RECOMMENDATIONS_AWAITING_FRESH_PRICES'
    ? (decision.professionalEvidenceReady ? 'PROFESSIONAL_CANDIDATES_AVAILABLE' : 'PILOT_CANDIDATES_AVAILABLE')
    : previousStatus;
  decision.statusAr = previousStatusAr;
  decision.recommendations = Array.isArray(decision.recommendations)
    ? decision.recommendations.map(row => ({
        ...row,
        currentSessionEligible: true,
        referenceOnly: false,
        status: row.originalStatus || row.status,
        statusAr: row.originalStatusAr || row.statusAr,
      }))
    : [];
}

const report = {
  schemaVersion: '16.9.2-main-app-freshness-guard',
  generatedAt: new Date().toISOString(),
  cairoNow: now,
  expectedSession: expected,
  decisionSession: decision.sessionDate,
  priceSession,
  executionGrade: price.executionGrade === true,
  isFresh,
  displayMode: decision.freshness.displayMode,
  recommendationTickers: (decision.recommendations || []).map(row => row.ticker),
  reasonCodes,
  canonicalPostProcessing: true,
  actionAr: isFresh
    ? 'التوصيات تخص آخر جلسة مكتملة ومعتمدة.'
    : 'اعرض القائمة كمرجع للجلسة السابقة، ولا تقدمها كتوصيات اليوم أو كخطة تنفيذ.',
};

writeJson(DECISION_PATH, decision);
writeJson(OUT_PATH, report);
console.log(report);

// Every canonical MAIN APP scan ends by rebuilding the same governance snapshot,
// immutable signal ledger and session-bound engine comparison. This avoids a
// timing gap between a new V16.9 basket and its safety/consensus overlays.
try {
  const snapshot = buildMainAppGovernance();
  console.log({
    canonicalMainAppPostProcess: 'GOVERNANCE_COMPLETE',
    systemState: snapshot.systemState,
    executionAllowed: snapshot.executionAllowed,
    sessionDate: snapshot.sessionDate,
    snapshotHash: snapshot.snapshotHash,
  });
} catch (error) {
  console.error('MAIN APP canonical governance post-process failed:', error);
  process.exitCode = 2;
}

const consensus = spawnSync(process.execPath, [CONSENSUS_SCRIPT], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  timeout: 120000,
});
if (consensus.error) {
  console.error('MAIN APP consensus post-process failed:', consensus.error);
  process.exitCode = 2;
} else if (![0, 2].includes(consensus.status)) {
  console.error(`MAIN APP consensus post-process exit=${consensus.status}`);
  process.exitCode = 2;
}
