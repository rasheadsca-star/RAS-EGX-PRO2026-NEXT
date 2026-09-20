'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const readJson = (rel, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;

function cairoParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      weekday: 'short'
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );
  const dow = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[parts.weekday];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow
  };
}

function evaluateHandoff(input) {
  const eventName = String(input.eventName || '');
  const upstream = input.upstream || {};
  const scan = input.scan || {};
  const price = input.price || {};
  const primary = input.primary || {};
  const audit = input.audit || {};
  const now = input.now || cairoParts();

  const reasons = [];
  const session = dateOnly(scan.sessionDate);
  const expected = dateOnly(scan.expectedSession);
  const priceExpected = dateOnly(price.expectedSession);
  const primarySession = dateOnly(primary.sessionDate);
  const pagesSession = dateOnly(scan.pagesPublishedSession);
  const fingerprint = String(scan.materialFingerprint || '').trim().toLowerCase();
  const priorFingerprint = String(audit?.upstream?.mainAppMaterialFingerprint || '').trim().toLowerCase();
  const priorSession = dateOnly(audit?.session?.decision);

  if (eventName === 'workflow_run') {
    if (String(upstream.conclusion || '') !== 'success') reasons.push('UPSTREAM_WORKFLOW_NOT_SUCCESS');
    if (String(upstream.headBranch || '') !== 'main') reasons.push('UPSTREAM_HEAD_NOT_MAIN');
    if (upstream.headRepo && upstream.repository && String(upstream.headRepo) !== String(upstream.repository)) reasons.push('UPSTREAM_REPOSITORY_MISMATCH');
  }

  if (eventName === 'schedule') {
    if (!(Number(now.dow) >= 0 && Number(now.dow) <= 4)) reasons.push('OUTSIDE_EGX_TRADING_DAYS');
    if (!(Number(now.hour) >= 15 && Number(now.hour) <= 21)) reasons.push('OUTSIDE_POST_CLOSE_FALLBACK_WINDOW');
  }

  if (!session) reasons.push('MAIN_APP_SESSION_MISSING');
  if (!expected || expected !== session) reasons.push('MAIN_APP_EXPECTED_SESSION_MISMATCH');
  if (!priceExpected || priceExpected !== session) reasons.push('PRICE_TRUTH_SESSION_MISMATCH');
  if (!primarySession || primarySession !== session) reasons.push('PRIMARY_DECISION_SESSION_MISMATCH');
  if (!pagesSession || pagesSession !== session) reasons.push('PAGES_PUBLISHED_SESSION_MISMATCH');
  if (session && session !== now.date) reasons.push('SESSION_NOT_CAIRO_TODAY');

  if (scan.final !== true) reasons.push('MAIN_APP_NOT_FINAL');
  if (scan.sourceReady !== true) reasons.push('MAIN_APP_SOURCE_NOT_READY');
  if (scan.currentSessionReady !== true) reasons.push('MAIN_APP_CURRENT_SESSION_NOT_READY');
  if (scan.executionGrade !== true) reasons.push('MAIN_APP_NOT_EXECUTION_GRADE');
  if (scan.pagesPublished !== true) reasons.push('MAIN_APP_PAGES_NOT_PUBLISHED');

  if (price.ready !== true) reasons.push('PRICE_TRUTH_NOT_READY');
  if (price.executionGrade !== true) reasons.push('PRICE_TRUTH_NOT_EXECUTION_GRADE');
  if ((finite(price.acceptedRows) || 0) < 200) reasons.push('PRICE_TRUTH_ACCEPTED_ROWS_BELOW_200');
  if ((finite(price?.source?.sourceSessionEvidenceCoveragePct) || 0) < 90) reasons.push('SOURCE_SESSION_EVIDENCE_BELOW_90');

  if (primary.currentSessionReady !== true) reasons.push('PRIMARY_CURRENT_SESSION_NOT_READY');
  if (primary?.basketPlan?.sourceSessionReady !== true) reasons.push('PRIMARY_SOURCE_SESSION_NOT_READY');

  if (!/^[0-9a-f]{64}$/.test(fingerprint)) reasons.push('MAIN_APP_FINGERPRINT_INVALID');

  const automatic = eventName === 'workflow_run' || eventName === 'schedule';
  const duplicate = Boolean(
    automatic &&
    session &&
    priorSession === session &&
    /^[0-9a-f]{64}$/.test(fingerprint) &&
    priorFingerprint === fingerprint
  );
  if (duplicate) reasons.push('ALREADY_PROCESSED_MAIN_APP_FINGERPRINT');

  const run = reasons.length === 0;
  return {
    run,
    reason: run ? 'FINAL_MAIN_APP_SESSION_READY' : reasons[0],
    reasons,
    eventName,
    cairo: now,
    session,
    fingerprint: fingerprint || null,
    duplicate
  };
}

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function main() {
  const result = evaluateHandoff({
    eventName: process.env.G22_TRIGGER_EVENT || process.env.GITHUB_EVENT_NAME,
    upstream: {
      conclusion: process.env.G22_UPSTREAM_CONCLUSION || '',
      headBranch: process.env.G22_UPSTREAM_HEAD_BRANCH || '',
      headRepo: process.env.G22_UPSTREAM_HEAD_REPO || '',
      repository: process.env.G22_REPOSITORY || process.env.GITHUB_REPOSITORY || ''
    },
    scan: readJson('data/stable/v16-immediate-scan-status.json'),
    price: readJson('data/stable/v15-price-truth.json'),
    primary: readJson('data/stable/v16-v169-primary-decision.json'),
    audit: readJson('astra-prod/G22_SESSION_REFRESH.json'),
    now: cairoParts()
  });

  console.log('G22_HANDOFF_GUARD ' + JSON.stringify(result));
  appendOutput('run', result.run ? 'true' : 'false');
  appendOutput('reason', result.reason);
  appendOutput('session', result.session || '');
  appendOutput('fingerprint', result.fingerprint || '');
}

if (require.main === module) main();
module.exports = { evaluateHandoff, cairoParts };
