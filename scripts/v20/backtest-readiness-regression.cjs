#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => fs.writeFileSync(P(rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const readiness = read('data/v20/backtest-readiness.json');
const decisionPolicy = read('data/v20/decision-intelligence-policy.json');
const archive = read('data/v20/signal-archive/index.json');
const forward = read('data/v20/forward-evaluation.json');
const performance = read('data/v20/performance-evidence-registry.json');
const current = read('data/v20/current.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const archiveEntries = archive.entries || [];
const distinctDates = [...new Set(archiveEntries.map(x => x.sessionDate).filter(Boolean))];
const evaluations = forward.evaluations || [];
const resolved = evaluations.filter(x => x.status === 'RESOLVED');
const pending = evaluations.filter(x => x.status === 'PENDING');
const reused = (performance.entries || []).find(x => x.evidenceId === 'V19_V6_REUSED_BENCHMARK');
const dev = (performance.entries || []).find(x => x.evidenceId === 'V19_V6_DEVELOPMENT_OOS');

check(readiness.schemaVersion === '20.0.0-backtest-readiness-1', 'BACKTEST_READINESS_SCHEMA_DRIFT');
check(readiness.sessionDate === current.sessionDate, 'BACKTEST_READINESS_SESSION_MISMATCH');
check(readiness.decisionScore?.policySchemaVersion === decisionPolicy.schemaVersion, 'BACKTEST_DECISION_POLICY_SCHEMA_MISMATCH');
check(readiness.decisionScore?.status === 'SHADOW_RESEARCH_ONLY_UNCALIBRATED', 'BACKTEST_DECISION_SCORE_NOT_RESEARCH_ONLY');
check(readiness.decisionScore?.scoreIsConfidence === false, 'BACKTEST_SCORE_CONFIDENCE_MIX');
check(readiness.decisionScore?.productionUseAllowed === false, 'BACKTEST_UNCALIBRATED_SCORE_PRODUCTION_USE');
check(readiness.availableEvidence?.immutableArchiveEntryCount === archiveEntries.length, 'BACKTEST_ARCHIVE_COUNT_MISMATCH');
check(readiness.availableEvidence?.distinctSignalDateCount === distinctDates.length, 'BACKTEST_DISTINCT_SIGNAL_DATE_MISMATCH');
check(JSON.stringify(readiness.availableEvidence?.distinctSignalDates) === JSON.stringify(distinctDates), 'BACKTEST_SIGNAL_DATES_MISMATCH');
check(readiness.availableEvidence?.forwardEvaluationCount === evaluations.length, 'BACKTEST_FORWARD_COUNT_MISMATCH');
check(readiness.availableEvidence?.resolvedForwardCount === resolved.length, 'BACKTEST_RESOLVED_FORWARD_MISMATCH');
check(readiness.availableEvidence?.pendingForwardCount === pending.length, 'BACKTEST_PENDING_FORWARD_MISMATCH');
check(readiness.availableEvidence?.v19ReusedBenchmarkFreshIndependent === (reused?.independence?.freshIndependentEvidence === true), 'BACKTEST_REUSED_INDEPENDENCE_MISMATCH');
check(readiness.availableEvidence?.v19ReusedBenchmarkPromotionEligible === (reused?.promotionEligible === true), 'BACKTEST_REUSED_PROMOTION_MISMATCH');
check(readiness.availableEvidence?.v19DevelopmentEvidenceClass === (dev?.evidenceClass || null), 'BACKTEST_DEVELOPMENT_CLASS_MISMATCH');

check(readiness.claimPolicy?.v20ScoreCalibratedAlphaClaimAllowed === false, 'BACKTEST_CALIBRATED_ALPHA_CLAIM_ENABLED');
check(readiness.claimPolicy?.v20ScoreTargetProbabilityClaimAllowed === false, 'BACKTEST_TARGET_PROBABILITY_CLAIM_ENABLED');
check(readiness.claimPolicy?.v20ScoreProfitabilityClaimAllowed === false, 'BACKTEST_PROFITABILITY_CLAIM_ENABLED');
check(readiness.claimPolicy?.v19ReusedBenchmarkMayValidateV20Score === false, 'BACKTEST_REUSED_BENCHMARK_VALIDATES_V20_SCORE');
check(readiness.claimPolicy?.v19DevelopmentMayBeRelabeledV20ScoreBacktest === false, 'BACKTEST_V19_DEVELOPMENT_RELABELED');
check(readiness.claimPolicy?.v18MayValidateV20ScoreWithoutAudit === false, 'BACKTEST_V18_UNAUDITED_VALIDATION_ENABLED');
check(readiness.claimPolicy?.pendingForwardReturnMayCountAsZero === false, 'BACKTEST_PENDING_FORWARD_COUNTS_AS_ZERO');
check(readiness.interpretation?.currentEvidenceCannotValidateV20ScorePredictivePerformance === true, 'BACKTEST_PREDICTIVE_LIMITATION_MISSING');

if (resolved.length === 0 || distinctDates.length < 20) {
  check(readiness.claimPolicy?.v20ScoreBacktestClaimAllowed === false, 'BACKTEST_CLAIM_ALLOWED_WITHOUT_INDEPENDENT_SAMPLE');
  check(readiness.status === 'NOT_READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST', 'BACKTEST_STATUS_OVERSTATED_WITHOUT_SAMPLE');
}
if (reused) {
  check(reused.promotionEligible === false, 'BACKTEST_REUSED_BENCHMARK_PROMOTION_ELIGIBLE');
  check(reused.independence?.freshIndependentEvidence === false, 'BACKTEST_REUSED_BENCHMARK_MARKED_INDEPENDENT');
}
check(readiness.requiredMethodologyBeforeCalibration?.pointInTimeFeatureSnapshotBeforeOutcome === true, 'BACKTEST_POINT_IN_TIME_REQUIREMENT_MISSING');
check(readiness.requiredMethodologyBeforeCalibration?.noFutureRowsOrLookAhead === true, 'BACKTEST_NO_LOOKAHEAD_REQUIREMENT_MISSING');
check(readiness.requiredMethodologyBeforeCalibration?.nextAcceptedSessionOpenEntrySemantics === true, 'BACKTEST_NEXT_OPEN_REQUIREMENT_MISSING');
check(readiness.requiredMethodologyBeforeCalibration?.conservativeSameCandleTargetStopAmbiguity === true, 'BACKTEST_AMBIGUITY_REQUIREMENT_MISSING');
check(readiness.requiredMethodologyBeforeCalibration?.developmentWalkForwardHoldoutSeparation === true, 'BACKTEST_HOLDOUT_SEPARATION_REQUIREMENT_MISSING');
check(readiness.requiredMethodologyBeforeCalibration?.freshIndependentHoldoutRequiredForProductionClaim === true, 'BACKTEST_FRESH_HOLDOUT_REQUIREMENT_MISSING');

const report = {
  schemaVersion: '20.0.0-backtest-readiness-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    decisionScoreRemainsUncalibratedResearchOnly: true,
    historicalV19EvidenceNotRelabeledAsV20Backtest: true,
    reusedBenchmarkNotIndependent: true,
    forwardSampleReadFromImmutableEvidence: true,
    pendingForwardNotTreatedAsZero: true,
    pointInTimeAndNoLookaheadRequired: true,
    walkForwardAndIndependentHoldoutRequired: true,
    profitabilityAndProbabilityClaimsBlockedUntilValidation: true
  }
};
write('data/v20/backtest-readiness-regression.json', report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
