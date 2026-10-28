#!/usr/bin/env node
'use strict';

// Replay already approved, same-session second-source evidence before the
// canonical V16.9 basket is built. A new session never inherits old prices.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {filterApproved, verify, observed} = require('./v16-verified-incremental-recovery.cjs');
const root = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const at = p => path.join(root, p);
const read = p => JSON.parse(fs.readFileSync(at(p), 'utf8'));
const write = (p, x) => fs.writeFileSync(at(p), JSON.stringify(x, null, 2) + '\n');
const day = x => String(x || '').slice(0, 10);
const ticker = x => String(x || '').toUpperCase().replace(/\.CA$/, '');
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

function plan(before, evidence) {
  const session = day(before.expectedSession);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) throw Error('INVALID_PRICE_SESSION');
  if (day(evidence.expectedSession) !== session) return {skip:'SECOND_SOURCE_NOT_SAME_SESSION', session};
  if (before.ready !== true || before.executionGrade !== true) return {skip:'PRIMARY_NOT_EXECUTION_GRADE', session};
  const rejected = new Set((before.sampleRejected || []).map(r => ticker(r.ticker)));
  const candidates = Object.entries(evidence.records || {})
    .filter(([t, r]) => rejected.has(ticker(t)) && r.approved === true)
    .map(([t]) => ticker(t));
  return {session, candidates};
}

function validateStatus(before, after, status, evidence, histories) {
  const session = day(after.expectedSession);
  if (session !== day(before.expectedSession) || day(status.expectedSession) !== session) throw Error('REPLAY_SESSION_IDENTITY_MISMATCH');
  const accepted = Number(after.acceptedRows), rejected = Number(after.rejectedRows);
  const input = Number(after.source?.inputRows), dropped = Number(after.droppedRows || 0);
  if (!Number.isInteger(input) || input <= 0 || !Number.isInteger(accepted) || !Number.isInteger(rejected)
    || !Number.isInteger(dropped) || accepted + rejected + dropped !== input)
    throw Error('REPLAY_PRICE_COUNTS_INCONSISTENT');
  if (Number(status.inputRows) !== input || Number(status.marketRows) !== accepted
    || Number(status.currentSessionRows) !== accepted
    || Number(status.rejectedCurrentSessionRows) !== rejected
    || Math.abs(Number(status.coveragePct) - round2(100 * accepted / input)) > 0.011)
    throw Error('REPLAY_FETCH_STATUS_INCONSISTENT');
  if (Math.abs(Number(status.sourceSessionEvidenceCoveragePct) - Number(after.source?.sourceSessionEvidenceCoveragePct)) > 0.011)
    throw Error('REPLAY_SOURCE_SESSION_COVERAGE_INCONSISTENT');
  const recovered = after.secondSourceReconciliation?.recoveredTickersThisRun || [];
  if (new Set(recovered).size !== recovered.length) throw Error('REPLAY_DUPLICATE_RECOVERY');
  for (const t of recovered) {
    const h = histories[t], e = evidence.records?.[t]?.approvedEvidence;
    const bar = h?.sessions?.find(s => day(s.date || s.sessionDate) === session);
    if (!h?.symbolVerified || !/^EG[A-Z0-9]{9,}$/i.test(String(h.isin || ''))
      || !bar?.secondSourceConfirmed || !observed(bar)
      || day(bar.sourceSessionDate) !== session || bar.secondSourceProvider !== e?.provider)
      throw Error('REPLAY_RECOVERED_HISTORY_NOT_VERIFIED_' + t);
  }
  return {session, accepted, rejected, input, sourceEvidencePct:Number(after.source?.sourceSessionEvidenceCoveragePct),
    acceptedOverInputPct:Number(status.coveragePct), recovered};
}

function main() {
  const before = read('data/stable/v15-price-truth.json');
  const evidence = read('data/stable/v16-market-second-source-evidence.json');
  const planResult = plan(before, evidence);
  if (planResult.skip || !planResult.candidates?.length) {
    console.log('SAME_SESSION_RECOVERY_REPLAY_SKIPPED ' + JSON.stringify(planResult));
    return;
  }
  const histories = {};
  for (const t of planResult.candidates) {
    try { histories[t] = read('data/history/' + t + '.json'); } catch { /* quarantine below */ }
  }
  // Filter only currently rejected candidates. Unrelated previously approved
  // records must not be quarantined simply because they are not rejected now.
  const candidateEvidence = {...evidence, records:Object.fromEntries(planResult.candidates.map(t => [t, evidence.records[t]]))};
  const filteredCandidates = filterApproved(candidateEvidence, before, read('data/market.json'), read('data/symbol-map.json'), histories);
  const filtered = {...evidence, records:{...evidence.records, ...filteredCandidates.records},
    incrementalIdentityAndOhlcvGuard:filteredCandidates.incrementalIdentityAndOhlcvGuard};
  filtered.approvedTickers = Object.entries(filtered.records).filter(([,r]) => r.approved === true).map(([t]) => t);
  filtered.approvedCount = filtered.approvedTickers.length;
  filtered.unresolvedTickers = Object.entries(filtered.records).filter(([,r]) => r.approved !== true).map(([t]) => t);
  filtered.unresolvedCount = filtered.unresolvedTickers.length;
  const approved = planResult.candidates.filter(t => filtered.records?.[t]?.approved === true);
  if (!approved.length) {
    console.log('SAME_SESSION_RECOVERY_REPLAY_QUARANTINED ' + JSON.stringify({session:planResult.session,
      quarantined:filtered.incrementalIdentityAndOhlcvGuard?.quarantined || []}));
    return;
  }
  // This is an existing same-session approval, not a new market-data fetch.
  write('data/stable/v16-market-second-source-evidence.json', filtered);
  const result = cp.spawnSync(process.execPath, ['scripts/stable/v16-market-coverage-reconciler.cjs'],
    {cwd:root, encoding:'utf8'});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw Error('REPLAY_RECONCILER_FAILED_' + (result.status ?? result.error));
  const after = read('data/stable/v15-price-truth.json');
  const updatedHistory = {};
  for (const t of after.secondSourceReconciliation?.recoveredTickersThisRun || [])
    updatedHistory[t] = read('data/history/' + t + '.json');
  verify(before, after, filtered, updatedHistory);
  const summary = validateStatus(before, after, read('data/fetch-status.json'), filtered, updatedHistory);
  if (summary.recovered.length !== approved.length || summary.recovered.some(t => !approved.includes(t)))
    throw Error('REPLAY_APPROVED_RECOVERED_SET_MISMATCH');
  console.log('SAME_SESSION_RECOVERY_REPLAY_VERIFIED ' + JSON.stringify(summary));
}

if (require.main === module) main();
module.exports = {plan, validateStatus};
