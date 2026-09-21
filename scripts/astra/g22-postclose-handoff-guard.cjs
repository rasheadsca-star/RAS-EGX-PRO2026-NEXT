'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const readJson = (rel, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;

function readJsonAtCommit(sha, rel) {
  const raw = cp.execFileSync('git', ['show', sha + ':' + rel], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  return JSON.parse(raw);
}

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
  const marker = input.marker || {};
  const canonicalStatus = input.canonicalStatus || {};
  const price = input.price || {};
  const primary = input.primary || {};
  const audit = input.audit || {};
  const intelligence = input.intelligence || {};
  const now = input.now || cairoParts();

  const reasons = [];
  const session = dateOnly(marker.sessionDate);
  const expected = dateOnly(marker.expectedSession);
  const priceExpected = dateOnly(price.expectedSession);
  const primarySession = dateOnly(primary.sessionDate);
  const statusSession = dateOnly(canonicalStatus.sessionDate);
  const fingerprint = String(marker.materialFingerprint || '').trim().toLowerCase();
  const canonicalHead = String(marker.canonicalDataHead || '').trim().toLowerCase();
  const priorFingerprint = String(audit?.upstream?.mainAppMaterialFingerprint || '').trim().toLowerCase();
  const priorCanonicalHead = String(audit?.upstream?.canonicalDataHead || '').trim().toLowerCase();
  const priorSession = dateOnly(audit?.session?.decision);
  const intelligenceSource = intelligence?.sourceSnapshot || {};
  const intelligenceCurrent = Boolean(
    dateOnly(intelligence?.sessionRange?.last) === session &&
    String(intelligenceSource.canonicalDataHead || '').trim().toLowerCase() === canonicalHead &&
    String(intelligenceSource.handoffFingerprint || '').trim().toLowerCase() === fingerprint &&
    String(intelligenceSource.handoffProducerRunId || '') === String(marker.producerRunId || '')
  );

  const automatic = eventName === 'workflow_run' || eventName === 'schedule' || eventName === 'push';
  const duplicate = Boolean(
    automatic &&
    session &&
    priorSession === session &&
    /^[0-9a-f]{64}$/.test(fingerprint) &&
    priorFingerprint === fingerprint &&
    /^[0-9a-f]{40}$/.test(canonicalHead) &&
    priorCanonicalHead === canonicalHead &&
    intelligenceCurrent
  );

  if (eventName === 'workflow_run') {
    if (String(upstream.conclusion || '') !== 'success') reasons.push('UPSTREAM_WORKFLOW_NOT_SUCCESS');
    if (String(upstream.headBranch || '') !== 'main') reasons.push('UPSTREAM_HEAD_NOT_MAIN');
    if (upstream.headRepo && upstream.repository && String(upstream.headRepo) !== String(upstream.repository)) reasons.push('UPSTREAM_REPOSITORY_MISMATCH');
    if (!duplicate && String(marker.producerRunId || '') !== String(upstream.runId || '')) reasons.push('HANDOFF_PRODUCER_RUN_MISMATCH');
  }

  if (eventName === 'schedule') {
    if (!(Number(now.dow) >= 0 && Number(now.dow) <= 4)) reasons.push('OUTSIDE_EGX_TRADING_DAYS');
    if (!(Number(now.hour) >= 15 && Number(now.hour) <= 21)) reasons.push('OUTSIDE_POST_CLOSE_FALLBACK_WINDOW');
  }

  if (marker.schemaVersion !== 'g22-main-app-final-handoff-1') reasons.push('HANDOFF_MARKER_SCHEMA_INVALID');
  if (!/^[0-9a-f]{40}$/.test(canonicalHead)) reasons.push('CANONICAL_DATA_HEAD_INVALID');
  if (!session) reasons.push('HANDOFF_SESSION_MISSING');
  if (!expected || expected !== session) reasons.push('HANDOFF_EXPECTED_SESSION_MISMATCH');
  if (eventName === 'schedule' && session && session !== now.date) reasons.push('SESSION_NOT_CAIRO_TODAY');

  if (marker.final !== true) reasons.push('HANDOFF_NOT_FINAL');
  if (marker.sourceReady !== true) reasons.push('HANDOFF_SOURCE_NOT_READY');
  if (marker.currentSessionReady !== true) reasons.push('HANDOFF_CURRENT_SESSION_NOT_READY');
  if (marker.executionGrade !== true) reasons.push('HANDOFF_NOT_EXECUTION_GRADE');
  if (marker.pagesPublished !== true) reasons.push('HANDOFF_PAGES_NOT_PUBLISHED');
  if (!marker.pagesPublishedAt) reasons.push('HANDOFF_PAGES_PUBLISHED_AT_MISSING');
  if ((finite(marker.acceptedRows) || 0) < 200) reasons.push('HANDOFF_ACCEPTED_ROWS_BELOW_200');
  if ((finite(marker.sourceSessionEvidenceCoveragePct) || 0) < 90) reasons.push('HANDOFF_SOURCE_EVIDENCE_BELOW_90');
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) reasons.push('HANDOFF_FINGERPRINT_INVALID');

  if (input.canonicalAvailable !== true) reasons.push('CANONICAL_SNAPSHOT_UNAVAILABLE');
  if (canonicalStatus.final !== true) reasons.push('CANONICAL_MAIN_APP_NOT_FINAL');
  if (canonicalStatus.sourceReady !== true) reasons.push('CANONICAL_MAIN_APP_SOURCE_NOT_READY');
  if (canonicalStatus.currentSessionReady !== true) reasons.push('CANONICAL_MAIN_APP_SESSION_NOT_READY');
  if (canonicalStatus.executionGrade !== true) reasons.push('CANONICAL_MAIN_APP_NOT_EXECUTION_GRADE');
  if (statusSession !== session) reasons.push('CANONICAL_STATUS_SESSION_MISMATCH');
  if (String(canonicalStatus.materialFingerprint || '').toLowerCase() !== fingerprint) reasons.push('CANONICAL_STATUS_FINGERPRINT_MISMATCH');

  if (priceExpected !== session) reasons.push('CANONICAL_PRICE_TRUTH_SESSION_MISMATCH');
  if (price.ready !== true) reasons.push('CANONICAL_PRICE_TRUTH_NOT_READY');
  if (price.executionGrade !== true) reasons.push('CANONICAL_PRICE_TRUTH_NOT_EXECUTION_GRADE');
  if ((finite(price.acceptedRows) || 0) < 200) reasons.push('CANONICAL_PRICE_TRUTH_ACCEPTED_ROWS_BELOW_200');
  if ((finite(price?.source?.sourceSessionEvidenceCoveragePct) || 0) < 90) reasons.push('CANONICAL_SOURCE_SESSION_EVIDENCE_BELOW_90');

  if (primarySession !== session) reasons.push('CANONICAL_PRIMARY_SESSION_MISMATCH');
  if (primary.currentSessionReady !== true) reasons.push('CANONICAL_PRIMARY_CURRENT_SESSION_NOT_READY');
  if (primary?.basketPlan?.sourceSessionReady !== true) reasons.push('CANONICAL_PRIMARY_SOURCE_SESSION_NOT_READY');

  if (duplicate) reasons.push('ALREADY_PROCESSED_MAIN_APP_FINGERPRINT');

  const run = reasons.length === 0;
  return {
    run,
    reason: run ? 'FINAL_MAIN_APP_HANDOFF_READY' : reasons[0],
    reasons,
    eventName,
    cairo: now,
    session,
    fingerprint: fingerprint || null,
    canonicalHead: canonicalHead || null,
    duplicate,
    intelligenceCurrent
  };
}

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function main() {
  const marker = readJson('data/ops/g22-main-app-handoff.json');
  const head = String(marker.canonicalDataHead || '').trim();
  let canonicalAvailable = false;
  let canonicalStatus = {}, price = {}, primary = {};
  try {
    if (/^[0-9a-f]{40}$/.test(head)) {
      canonicalStatus = readJsonAtCommit(head, 'data/stable/v16-immediate-scan-status.json');
      price = readJsonAtCommit(head, 'data/stable/v15-price-truth.json');
      primary = readJsonAtCommit(head, 'data/stable/v16-v169-primary-decision.json');
      canonicalAvailable = true;
    }
  } catch (error) {
    console.error('G22_HANDOFF_CANONICAL_READ_ERROR ' + String(error?.message || error));
  }

  const result = evaluateHandoff({
    eventName: process.env.G22_TRIGGER_EVENT || process.env.GITHUB_EVENT_NAME,
    upstream: {
      conclusion: process.env.G22_UPSTREAM_CONCLUSION || '',
      headBranch: process.env.G22_UPSTREAM_HEAD_BRANCH || '',
      headRepo: process.env.G22_UPSTREAM_HEAD_REPO || '',
      repository: process.env.G22_REPOSITORY || process.env.GITHUB_REPOSITORY || '',
      runId: process.env.G22_UPSTREAM_RUN_ID || ''
    },
    marker,
    canonicalStatus,
    price,
    primary,
    canonicalAvailable,
    audit: readJson('astra-prod/G22_SESSION_REFRESH.json'),
    intelligence: readJson('astra-prod/app/intelligence/performance-summary.json'),
    now: cairoParts()
  });

  console.log('G22_HANDOFF_GUARD ' + JSON.stringify(result));
  appendOutput('run', result.run ? 'true' : 'false');
  appendOutput('reason', result.reason);
  appendOutput('session', result.session || '');
  appendOutput('fingerprint', result.fingerprint || '');
  appendOutput('canonical_head', result.canonicalHead || '');
}

if (require.main === module) main();
module.exports = { evaluateHandoff, cairoParts };
