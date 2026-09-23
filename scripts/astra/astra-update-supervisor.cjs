'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const readJson = (rel, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const dateOnly = value => (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const upper = value => String(value || '').trim().toUpperCase();
const sortedTickers = rows => (Array.isArray(rows) ? rows : []).map(row => upper(row?.ticker)).filter(Boolean).sort();
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function cairoParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      weekday: 'short'
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow: { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[parts.weekday]
  };
}

function shiftDate(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dowOf(date) {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}

function parseHolidays(raw) {
  return new Set(String(raw || '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)));
}

function latestExpectedTradingSession(now, holidays = new Set()) {
  let candidate = now.date;
  if (Number(now.dow) <= 4 && Number(now.hour) < 15) candidate = shiftDate(candidate, -1);
  for (let i = 0; i < 10; i++) {
    const dow = dowOf(candidate);
    if (dow !== 5 && dow !== 6 && !holidays.has(candidate)) return candidate;
    candidate = shiftDate(candidate, -1);
  }
  return null;
}

function evaluateState(input = {}) {
  const handoff = input.handoff || {};
  const app = input.app || {};
  const manifest = input.manifest || {};
  const audit = input.audit || {};
  const ledger = input.ledger || {};
  const perf = input.perf || {};
  const live = input.live || null;
  const now = input.now || cairoParts();
  const holidays = input.holidays instanceof Set ? input.holidays : parseHolidays(input.holidays);
  const expectedTradingSession = input.expectedTradingSession || latestExpectedTradingSession(now, holidays);

  const desired = dateOnly(handoff.sessionDate);
  const handoffExpected = dateOnly(handoff.expectedSession);
  const appSession = dateOnly(app?.sourceDecision?.session);
  const snapshotSession = dateOnly(app?.decisionSnapshot?.sessionDate);
  const snapshotAsOf = dateOnly(app?.decisionSnapshot?.asOfSessionDate);
  const manifestSession = dateOnly(manifest?.currentSession);
  const auditExpected = dateOnly(audit?.session?.expected);
  const auditDecision = dateOnly(audit?.session?.decision);
  const auditAvailable = dateOnly(audit?.session?.available);

  const handoffReasons = [];
  if (handoff.schemaVersion !== 'g22-main-app-final-handoff-1') handoffReasons.push('HANDOFF_SCHEMA_INVALID');
  if (!desired) handoffReasons.push('HANDOFF_SESSION_MISSING');
  if (!handoffExpected || handoffExpected !== desired) handoffReasons.push('HANDOFF_EXPECTED_SESSION_MISMATCH');
  if (handoff.final !== true) handoffReasons.push('HANDOFF_NOT_FINAL');
  if (handoff.sourceReady !== true) handoffReasons.push('SOURCE_NOT_READY');
  if (handoff.currentSessionReady !== true) handoffReasons.push('CURRENT_SESSION_NOT_READY');
  if (handoff.executionGrade !== true) handoffReasons.push('NOT_EXECUTION_GRADE');
  if (handoff.pagesPublished !== true) handoffReasons.push('MAIN_APP_NOT_PUBLISHED');
  if ((num(handoff.acceptedRows) || 0) < 200) handoffReasons.push('ACCEPTED_ROWS_BELOW_200');
  if ((num(handoff.sourceSessionEvidenceCoveragePct) || 0) < 90) handoffReasons.push('SOURCE_COVERAGE_BELOW_90');
  if (!/^[0-9a-f]{40}$/.test(String(handoff.canonicalDataHead || ''))) handoffReasons.push('CANONICAL_HEAD_INVALID');
  if (!/^[0-9a-f]{64}$/.test(String(handoff.materialFingerprint || ''))) handoffReasons.push('FINGERPRINT_INVALID');
  const handoffReady = handoffReasons.length === 0;

  const recs = Array.isArray(app?.decisionSnapshot?.top5) ? app.decisionSnapshot.top5 : [];
  const currentLedger = (Array.isArray(ledger.records) ? ledger.records : []).filter(row =>
    row?.decisionSnapshotId === app?.sourceDecision?.decisionSnapshotId &&
    dateOnly(row?.sessionDate) === desired
  );
  const recommendationIdentity = sameList(sortedTickers(currentLedger), sortedTickers(recs));

  const upstreamIdentity = Boolean(
    app?.sourceDecision?.upstream?.mainAppMaterialFingerprint === handoff.materialFingerprint &&
    app?.sourceDecision?.upstream?.canonicalDataHead === handoff.canonicalDataHead &&
    String(app?.sourceDecision?.upstream?.producerRunId || '') === String(handoff.producerRunId || '') &&
    app?.sourceDecision?.upstream?.sourceSessionDataHash === handoff.sourceSessionDataHash
  );

  const perfCurrent = Boolean(
    dateOnly(perf?.sessionRange?.last) === desired &&
    perf?.sourceSnapshot?.decisionSnapshotId === app?.sourceDecision?.decisionSnapshotId &&
    perf?.sourceSnapshot?.canonicalDataHead === handoff.canonicalDataHead &&
    perf?.sourceSnapshot?.handoffFingerprint === handoff.materialFingerprint &&
    String(perf?.sourceSnapshot?.handoffProducerRunId || '') === String(handoff.producerRunId || '') &&
    Number(perf?.currentOpportunities) === recs.length
  );

  const recommendationSnapshotCurrent = Boolean(
    handoffReady &&
    appSession === desired &&
    snapshotSession === desired &&
    snapshotAsOf === desired &&
    manifestSession === desired &&
    auditExpected === desired &&
    auditDecision === desired &&
    auditAvailable === desired &&
    app?.sourceDecision?.decisionSnapshotId === app?.decisionSnapshot?.decisionSnapshotId &&
    app?.sourceDecision?.semanticDecisionHash === app?.decisionSnapshot?.semanticDecisionHash &&
    manifest?.currentDecisionSnapshotId === app?.sourceDecision?.decisionSnapshotId &&
    manifest?.currentSemanticDecisionHash === app?.sourceDecision?.semanticDecisionHash &&
    upstreamIdentity &&
    recommendationIdentity &&
    perfCurrent
  );

  const sourceBehind = Boolean(expectedTradingSession && (!desired || desired < expectedTradingSession));
  const sourceCurrentButUnhealthy = Boolean(expectedTradingSession && desired === expectedTradingSession && !handoffReady);

  let liveCurrent = null;
  if (live && Object.keys(live).length) {
    liveCurrent = Boolean(
      dateOnly(live?.sourceDecision?.session) === desired &&
      dateOnly(live?.decisionSnapshot?.sessionDate) === desired &&
      live?.sourceDecision?.decisionSnapshotId === app?.sourceDecision?.decisionSnapshotId &&
      live?.sourceDecision?.semanticDecisionHash === app?.sourceDecision?.semanticDecisionHash &&
      live?.sourceDecision?.upstream?.canonicalDataHead === handoff.canonicalDataHead &&
      live?.sourceDecision?.upstream?.mainAppMaterialFingerprint === handoff.materialFingerprint
    );
  }

  let action = 'READY';
  let reason = 'DATA_RECOMMENDATIONS_AND_LIVE_CURRENT';

  if (sourceBehind || sourceCurrentButUnhealthy) {
    action = 'RECOVER_MAIN_APP';
    reason = sourceBehind ? 'LATEST_TRADING_SESSION_NOT_FINALIZED' : (handoffReasons[0] || 'MAIN_APP_HANDOFF_NOT_READY');
  } else if (handoffReady && !recommendationSnapshotCurrent) {
    action = 'REFRESH_ASTRA';
    reason = appSession !== desired ? 'ASTRA_SESSION_STALE' :
      !upstreamIdentity ? 'ASTRA_UPSTREAM_IDENTITY_STALE' :
      !recommendationIdentity ? 'ASTRA_RECOMMENDATION_LEDGER_STALE' :
      !perfCurrent ? 'ASTRA_INTELLIGENCE_STALE' :
      'ASTRA_RECOMMENDATION_SNAPSHOT_STALE';
  } else if (recommendationSnapshotCurrent && liveCurrent !== true) {
    action = 'DEPLOY_VERCEL';
    reason = liveCurrent === false ? 'VERCEL_LIVE_STALE' : 'VERCEL_LIVE_UNVERIFIED';
  } else if (!handoffReady) {
    action = 'WAIT_FOR_FINAL_HANDOFF';
    reason = handoffReasons[0] || 'HANDOFF_NOT_READY';
  }

  return {
    schemaVersion: 'astra-self-healing-supervisor-1',
    checkedAt: new Date().toISOString(),
    cairo: now,
    expectedTradingSession,
    desiredSession: desired,
    appSession,
    handoffReady,
    handoffReasons,
    dataCurrent: handoffReady && desired === expectedTradingSession,
    recommendationsCurrent: recommendationSnapshotCurrent,
    recommendationCount: recs.length,
    recommendationTickers: sortedTickers(recs),
    recommendationIdentity,
    intelligenceCurrent: perfCurrent,
    upstreamIdentity,
    liveCurrent,
    action,
    reason,
    ready: action === 'READY'
  };
}

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + String(value) + '\n');
}

function main() {
  const livePath = process.env.ASTRA_LIVE_DATA_PATH;
  let live = null;
  if (livePath && fs.existsSync(livePath)) {
    try { live = JSON.parse(fs.readFileSync(livePath, 'utf8')); } catch {}
  }
  const result = evaluateState({
    handoff: readJson('data/ops/g22-main-app-handoff.json'),
    app: readJson('astra-prod/app/data.json'),
    manifest: readJson('astra-prod/G22_FULL_APP_MANIFEST.json'),
    audit: readJson('astra-prod/G22_SESSION_REFRESH.json'),
    ledger: readJson('astra-prod/app/intelligence/recommendation-ledger.json'),
    perf: readJson('astra-prod/app/intelligence/performance-summary.json'),
    live,
    holidays: process.env.EGX_MARKET_HOLIDAYS || ''
  });
  console.log('ASTRA_SELF_HEALING_STATE ' + JSON.stringify(result));
  appendOutput('action', result.action);
  appendOutput('reason', result.reason);
  appendOutput('expected_session', result.expectedTradingSession || '');
  appendOutput('desired_session', result.desiredSession || '');
  appendOutput('app_session', result.appSession || '');
  appendOutput('handoff_ready', result.handoffReady ? 'true' : 'false');
  appendOutput('recommendations_current', result.recommendationsCurrent ? 'true' : 'false');
  appendOutput('live_current', result.liveCurrent === true ? 'true' : result.liveCurrent === false ? 'false' : 'unknown');
  appendOutput('ready', result.ready ? 'true' : 'false');
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Astra Self-Healing Update\n\n' +
      '- Expected trading session: **' + (result.expectedTradingSession || 'unknown') + '**\n' +
      '- MAIN APP handoff: **' + (result.handoffReady ? 'READY' : 'NOT READY') + '**\n' +
      '- Astra recommendations: **' + (result.recommendationsCurrent ? 'CURRENT' : 'STALE') + '**\n' +
      '- Vercel live: **' + (result.liveCurrent === true ? 'CURRENT' : result.liveCurrent === false ? 'STALE' : 'UNVERIFIED') + '**\n' +
      '- Action: **' + result.action + '**\n' +
      '- Reason: `' + result.reason + '`\n'
    );
  }
}

if (require.main === module) main();
module.exports = { evaluateState, cairoParts, latestExpectedTradingSession, parseHolidays };
