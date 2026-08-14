#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const write = (rel, value) => fs.writeFileSync(P(rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const decisionPolicy = read('data/v20/decision-intelligence-policy.json');
const profiles = read('data/v20/stock-profiles.json');
const archive = read('data/v20/signal-archive/index.json');
const forward = read('data/v20/forward-evaluation.json');
const performance = read('data/v20/performance-evidence-registry.json');
const operations = read('data/v20/release-operations.json');
const current = read('data/v20/current.json');

const archiveEntries = Array.isArray(archive.entries) ? archive.entries : [];
const distinctSignalDates = [...new Set(archiveEntries.map(x => x.sessionDate).filter(Boolean))];
const forwardEvaluations = Array.isArray(forward.evaluations) ? forward.evaluations : [];
const resolvedForward = forwardEvaluations.filter(x => x.status === 'RESOLVED');
const v19Development = (performance.entries || []).find(x => x.evidenceId === 'V19_V6_DEVELOPMENT_OOS') || null;
const v19Reused = (performance.entries || []).find(x => x.evidenceId === 'V19_V6_REUSED_BENCHMARK') || null;
const v18Accepted = performance.policy?.v18PerformanceAccepted === true || operations.v18Reference?.performanceEvidenceAccepted === true;

const pointInTimeHistoricalV20ScoreSnapshots = false;
const historicalV20ScoreOutcomeSeries = false;
const independentHoldoutForV20Score = false;
const freshForwardSampleAvailable = resolvedForward.length > 0;
const enoughDistinctSignalDatesForCalibration = distinctSignalDates.length >= 20;
const readyForIndependentBacktest = pointInTimeHistoricalV20ScoreSnapshots
  && historicalV20ScoreOutcomeSeries
  && independentHoldoutForV20Score;
const readyForFreshForwardCalibration = freshForwardSampleAvailable && enoughDistinctSignalDatesForCalibration;

const report = {
  schemaVersion: '20.0.0-backtest-readiness-1',
  generatedAt: new Date().toISOString(),
  sessionDate: current.sessionDate,
  status: readyForIndependentBacktest
    ? 'READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST'
    : readyForFreshForwardCalibration
      ? 'READY_FOR_FRESH_FORWARD_CALIBRATION_NOT_HISTORICAL_BACKTEST'
      : 'NOT_READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST',
  decisionScore: {
    policySchemaVersion: decisionPolicy.schemaVersion,
    status: decisionPolicy.status,
    calibrationStatus: decisionPolicy.calibrationStatus,
    scoreIsConfidence: decisionPolicy.scoreIsConfidence === true,
    productionUseAllowed: decisionPolicy.scoreCanDriveProductionAllocation === true || decisionPolicy.scoreCanOpenExecutionGate === true,
  },
  availableEvidence: {
    immutableArchiveEntryCount: archiveEntries.length,
    distinctSignalDateCount: distinctSignalDates.length,
    distinctSignalDates,
    forwardEvaluationCount: forwardEvaluations.length,
    resolvedForwardCount: resolvedForward.length,
    pendingForwardCount: forwardEvaluations.filter(x => x.status === 'PENDING').length,
    v19DevelopmentEvidencePresent: Boolean(v19Development),
    v19DevelopmentEvidenceClass: v19Development?.evidenceClass || null,
    v19DevelopmentFreshIndependentForV20Score: false,
    v19ReusedBenchmarkPresent: Boolean(v19Reused),
    v19ReusedBenchmarkFreshIndependent: v19Reused?.independence?.freshIndependentEvidence === true,
    v19ReusedBenchmarkPromotionEligible: v19Reused?.promotionEligible === true,
    v18PerformanceAccepted: v18Accepted,
  },
  missingEvidence: {
    pointInTimeHistoricalV20ScoreSnapshots: !pointInTimeHistoricalV20ScoreSnapshots,
    historicalV20DecisionScoreOutcomeSeries: !historicalV20ScoreOutcomeSeries,
    independentHoldoutForV20Score: !independentHoldoutForV20Score,
    sufficientResolvedFreshForwardSample: !readyForFreshForwardCalibration,
  },
  requiredMethodologyBeforeCalibration: {
    frozenScoreVersionPerSignal: true,
    pointInTimeFeatureSnapshotBeforeOutcome: true,
    noFutureRowsOrLookAhead: true,
    nextAcceptedSessionOpenEntrySemantics: true,
    conservativeSameCandleTargetStopAmbiguity: true,
    centralRoundTripTransactionCosts: true,
    developmentWalkForwardHoldoutSeparation: true,
    freshIndependentHoldoutRequiredForProductionClaim: true,
    researchAndAppliedPortfolioReturnsSeparated: true,
    immutableSignalHashPreserved: true,
  },
  claimPolicy: {
    v20ScoreBacktestClaimAllowed: readyForIndependentBacktest,
    v20ScoreCalibratedAlphaClaimAllowed: false,
    v20ScoreTargetProbabilityClaimAllowed: false,
    v20ScoreProfitabilityClaimAllowed: false,
    v19ReusedBenchmarkMayValidateV20Score: false,
    v19DevelopmentMayBeRelabeledV20ScoreBacktest: false,
    v18MayValidateV20ScoreWithoutAudit: false,
    pendingForwardReturnMayCountAsZero: false,
  },
  interpretation: {
    currentDecisionScoreIsResearchHeuristic: true,
    currentEvidenceCanValidatePipelineIntegrity: true,
    currentEvidenceCannotValidateV20ScorePredictivePerformance: true,
    note: 'V20 Decision Intelligence was introduced after the historical V19 evidence. Existing V19 development/reused benchmark results do not constitute a point-in-time historical backtest of the V20 score architecture. Fresh immutable V20 signals and resolved forward outcomes must accumulate, or historical point-in-time V20 feature snapshots must be reconstructed without leakage before calibration claims are allowed.'
  }
};

write('data/v20/backtest-readiness.json', report);
console.log(JSON.stringify({
  status: report.status,
  archiveEntries: report.availableEvidence.immutableArchiveEntryCount,
  distinctSignalDates: report.availableEvidence.distinctSignalDateCount,
  resolvedForward: report.availableEvidence.resolvedForwardCount,
  backtestClaimAllowed: report.claimPolicy.v20ScoreBacktestClaimAllowed,
  calibratedAlphaClaimAllowed: report.claimPolicy.v20ScoreCalibratedAlphaClaimAllowed,
}, null, 2));
