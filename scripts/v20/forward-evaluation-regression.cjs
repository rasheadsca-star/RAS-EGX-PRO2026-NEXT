#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => {
  const file = P(rel);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
};
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const forward = read('data/v20/forward-evaluation.json');
const status = forward.resolutionStatus || {};
const index = read('data/v20/signal-archive/index.json');
const current = read('data/v20/current.json');
const policy = read('data/v20/policy-registry.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(forward.schemaVersion === '20.0.0-forward-evaluation-3', 'FORWARD_SCHEMA_NOT_V3');
check(forward.asOfSessionDate === current.sessionDate, 'FORWARD_AS_OF_NOT_CURRENT_SESSION');
check(forward.authoritativeEvidence?.file === 'data/v20/forward-evaluation.json', 'AUTHORITATIVE_FILE_CONTRACT_MISSING');
check(forward.authoritativeEvidence?.selfContainedStatus === true, 'SELF_CONTAINED_STATUS_MISSING');
check(forward.authoritativeEvidence?.selfContainedRegression === true, 'SELF_CONTAINED_REGRESSION_MISSING');
check(forward.authoritativeEvidence?.derivedSidecarsAreAuthoritative === false, 'DERIVED_SIDECAR_MARKED_AUTHORITATIVE');
check(status.schemaVersion === '20.0.0-forward-resolution-status-2', 'EMBEDDED_STATUS_SCHEMA_DRIFT');
check(status.asOfSessionDate === forward.asOfSessionDate, 'EMBEDDED_STATUS_ASOF_MISMATCH');
check(forward.resolutionPolicy?.immutableSignalArchiveMutationAllowed === false, 'ARCHIVE_MUTATION_POLICY_DRIFT');
check(forward.resolutionPolicy?.appliedPortfolioAndResearchSeparated === true, 'APPLIED_RESEARCH_SEPARATION_MISSING');
check(forward.resolutionPolicy?.legacyPortfolioReturnFieldsMeaning === 'APPLIED_PORTFOLIO_ONLY', 'LEGACY_RETURN_MEANING_DRIFT');
check(forward.resolutionPolicy?.pendingReturnMustRemainNull === true, 'PENDING_NULL_POLICY_DRIFT');
check(forward.resolutionPolicy?.entryPolicy === 'FIRST_CONSENSUS_MARKET_SESSION_OPEN_ONLY_WITHIN_ISSUED_ENTRY_RANGE', 'ENTRY_POLICY_DRIFT');
check(forward.resolutionPolicy?.delayedEntryAfterFirstSessionAllowed === false, 'DELAYED_ENTRY_POLICY_DRIFT');
check(forward.resolutionPolicy?.sameSessionTargetStopAmbiguity === 'TREAT_AS_STOP', 'AMBIGUITY_POLICY_DRIFT');
check(forward.resolutionPolicy?.futureRowsAllowed === false, 'FUTURE_ROWS_POLICY_DRIFT');
check(forward.resolutionPolicy?.syntheticOhlcAllowed === false, 'SYNTHETIC_OHLC_POLICY_DRIFT');
check(Number(forward.resolutionPolicy?.roundTripTransactionCostPct) === Number(policy.transactionCosts?.roundTripPct), 'TRANSACTION_COST_POLICY_MISMATCH');
check(Number(forward.resolutionPolicy?.calendarConsensusPct) === 50, 'CALENDAR_CONSENSUS_POLICY_DRIFT');
check(Number(forward.resolutionPolicy?.calendarMinimumVotes) === 5, 'CALENDAR_MINIMUM_VOTES_POLICY_DRIFT');

for (const cal of forward.calendarEvidence || []) {
  check((cal.acceptedSessions || []).every(date => date > cal.signalDate), `CALENDAR_NON_FUTURE_SESSION_${cal.signalDate}`);
  check((cal.acceptedSessions || []).every(date => date <= forward.asOfSessionDate), `CALENDAR_FUTURE_LEAK_${cal.signalDate}`);
  check((cal.acceptedSessions || []).every((date, i, a) => i === 0 || a[i-1] < date), `CALENDAR_ORDER_DRIFT_${cal.signalDate}`);
}

const archiveByHash = new Map();
for (const entry of index.entries || []) {
  const archive = read(entry.file);
  archiveByHash.set(entry.immutableSignalHash, archive);
  check(archive.immutableSignalHash === entry.immutableSignalHash, `ARCHIVE_INDEX_HASH_MISMATCH_${entry.immutableSignalHash.slice(0,8)}`);
  check(sha(archive.immutableCore) === entry.immutableSignalHash, `IMMUTABLE_CORE_HASH_CHANGED_${entry.immutableSignalHash.slice(0,8)}`);
}

for (const ev of forward.evaluations || []) {
  const archive = archiveByHash.get(ev.immutableSignalHash);
  check(Boolean(archive), `FORWARD_ARCHIVE_MISSING_${String(ev.immutableSignalHash).slice(0,8)}`);
  if (!archive) continue;
  check([1,3,5,10,20].includes(Number(ev.horizonSessions)), `UNEXPECTED_HORIZON_${ev.horizonSessions}`);
  if (ev.status === 'PENDING') {
    check(ev.evaluationSessionDate === null, `PENDING_EVALUATION_DATE_POPULATED_${ev.horizonSessions}`);
    check(ev.portfolioReturnGrossPct === null && ev.portfolioReturnNetPct === null, `PENDING_APPLIED_RETURN_POPULATED_${ev.horizonSessions}`);
    check(ev.appliedPortfolio?.grossReturnPct === null && ev.appliedPortfolio?.netReturnPct === null, `PENDING_APPLIED_DETAIL_RETURN_POPULATED_${ev.horizonSessions}`);
    check(ev.researchEvaluation?.equalWeightIssuedGrossReturnPct === null && ev.researchEvaluation?.equalWeightIssuedNetReturnPct === null, `PENDING_RESEARCH_RETURN_POPULATED_${ev.horizonSessions}`);
  } else if (ev.status === 'RESOLVED') {
    check(typeof ev.evaluationSessionDate === 'string' && ev.evaluationSessionDate > ev.sessionDate && ev.evaluationSessionDate <= forward.asOfSessionDate, `RESOLVED_DATE_INVALID_${ev.horizonSessions}`);
    check(ev.appliedPortfolio?.resolved === true, `RESOLVED_APPLIED_NOT_RESOLVED_${ev.horizonSessions}`);
    check(ev.researchEvaluation?.resolved === true, `RESOLVED_RESEARCH_NOT_RESOLVED_${ev.horizonSessions}`);
    check(ev.portfolioReturnGrossPct === ev.appliedPortfolio?.grossReturnPct && ev.portfolioReturnNetPct === ev.appliedPortfolio?.netReturnPct, `LEGACY_APPLIED_RETURN_MISMATCH_${ev.horizonSessions}`);
    check(ev.researchEvaluation?.appliedToProduction === false, `RESEARCH_APPLIED_TO_PRODUCTION_${ev.horizonSessions}`);
    if ((archive.immutableCore?.portfolio?.recommendedExposurePct || 0) === 0) {
      check(ev.appliedPortfolio?.status === 'CASH_NO_APPLIED_EXPOSURE', `ZERO_EXPOSURE_NOT_CASH_${ev.horizonSessions}`);
      check(ev.portfolioReturnGrossPct === 0 && ev.portfolioReturnNetPct === 0, `ZERO_EXPOSURE_NONZERO_RETURN_${ev.horizonSessions}`);
    }
    for (const member of ev.researchEvaluation?.members || []) {
      if (member.outcome?.ambiguous === true) check(member.outcome?.state === 'AMBIGUOUS_TARGET_STOP_TREATED_AS_STOP', `AMBIGUITY_NOT_CONSERVATIVE_${member.ticker}`);
      if (member.outcome?.entered === false && member.outcome?.state === 'NOT_ENTERED_FIRST_SESSION_OPEN_OUTSIDE_RANGE') {
        check(member.outcome?.netReturnPct === 0 && member.outcome?.transactionCostPctApplied === 0, `NOT_ENTERED_CHARGED_OR_RETURNED_${member.ticker}`);
      }
    }
  } else check(false, `UNKNOWN_FORWARD_STATUS_${ev.status}`);
}

for (const ev of forward.evaluations || []) {
  if (ev.sessionDate === forward.asOfSessionDate) check(ev.status === 'PENDING', `SAME_SESSION_FORWARD_FABRICATED_${ev.horizonSessions}`);
}
const evaluations = forward.evaluations || [];
check(status.evaluationCount === evaluations.length, 'STATUS_EVALUATION_COUNT_MISMATCH');
check(status.signalCount === new Set(evaluations.map(x => x.immutableSignalHash)).size, 'STATUS_SIGNAL_COUNT_MISMATCH');
check(status.resolvedCount === evaluations.filter(x => x.status === 'RESOLVED').length, 'STATUS_RESOLVED_COUNT_MISMATCH');
check(status.pendingCount === evaluations.filter(x => x.status === 'PENDING').length, 'STATUS_PENDING_COUNT_MISMATCH');
check(status.researchAmbiguousCount === evaluations.reduce((sum,row) => sum + Number(row.researchEvaluation?.ambiguousCount || 0), 0), 'STATUS_AMBIGUOUS_COUNT_MISMATCH');

const report = {
  schemaVersion: '20.0.0-forward-evaluation-regression-2',
  generatedAt: new Date().toISOString(),
  asOfSessionDate: forward.asOfSessionDate,
  authoritativeFile: 'data/v20/forward-evaluation.json',
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  evidence: {
    signalCount: new Set(evaluations.map(x => x.immutableSignalHash)).size,
    evaluationCount: evaluations.length,
    resolvedCount: evaluations.filter(x => x.status === 'RESOLVED').length,
    pendingCount: evaluations.filter(x => x.status === 'PENDING').length,
    immutableArchiveCount: (index.entries || []).length,
    fabricatedSameSessionResolutionCount: evaluations.filter(x => x.sessionDate === forward.asOfSessionDate && x.status !== 'PENDING').length,
    embeddedStatusMatchesEvaluations: failures.every(x => !String(x).startsWith('STATUS_')),
  },
};
forward.evaluationRegression = report;
forward.updatedAt = new Date().toISOString();
write('data/v20/forward-evaluation.json', forward);
write('data/v20/forward-evaluation-regression.json', { ...report, derivedSidecar: true, authoritativeSource: 'data/v20/forward-evaluation.json#evaluationRegression' });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
