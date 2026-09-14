import fs from 'node:fs';
import path from 'node:path';
import {
  CORRELATION_CONCENTRATION_POLICY,
  assessCorrelationConcentration,
} from '../src/correlationConcentrationExpert.js';
import {
  classifyRiskAlphaMember,
  evaluateRiskAlphaSession,
  aggregateRiskAlphaReturns,
} from '../src/v169RiskAlphaChallenger.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const historyDir = path.join(repoRoot, 'data/history');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v169-correlation-concentration-audit.json');

const EXPECTED_SESSIONS = 45;
const EXPECTED_RISKALPHA_RESIDUAL_STOPS = 32;
const ACCEPTANCE = Object.freeze({
  minimumFlaggedSessions: 8,
  minimumFlaggedSessionsPerEligibleFold: 2,
  minimumEligibleFolds: 2,
  minimumSupportingFolds: 2,
  minimumResidualStopRateSeparationPp: 10,
  minimumRiskAlphaReturnSeparationPp: 1.0,
  minimumCombinedDrawdownImprovementPp: 1.0,
  minimumCombinedProfitFactorDelta: 0.0,
  minimumCombinedAverageReturnDeltaPp: -0.10,
  minimumCombinedWinRateDeltaPp: -5.0,
});

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function rate(n, d) { return d ? n / d * 100 : 0; }

function adjustedCloseBars(doc) {
  return (doc?.sessions || []).map((x) => ({
    date: String(x.date || x.sessionDate || '').slice(0, 10),
    close: Number(x.adjustedClose ?? x.close),
  })).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function returnSeriesThrough(bars, signalDate) {
  const eligible = bars.filter((x) => x.date <= signalDate);
  const returns = [];
  for (let i = 1; i < eligible.length; i += 1) {
    const prev = eligible[i - 1];
    const cur = eligible[i];
    if (!(prev.close > 0) || !(cur.close > 0)) continue;
    returns.push({
      date: cur.date,
      returnPct: (cur.close / prev.close - 1) * 100,
    });
  }
  return returns.slice(-CORRELATION_CONCENTRATION_POLICY.lookbackReturns);
}

function outcome(member) {
  if (!member.executableByOpenRule) return 'NO_ENTRY';
  if (member.stopTouched) return 'STOP';
  if (member.conservativeTargetHit) return 'TARGET';
  return 'OTHER';
}

function summarizeMembers(rows) {
  const executable = rows.filter((r) => r.executable);
  const stops = executable.filter((r) => r.outcome === 'STOP').length;
  const targets = executable.filter((r) => r.outcome === 'TARGET').length;
  return Object.freeze({
    members: rows.length,
    executable: executable.length,
    stops,
    targets,
    stopRatePct: round(rate(stops, executable.length), 2),
    targetRatePct: round(rate(targets, executable.length), 2),
  });
}

function summarizeSessionGroup(sessionRows) {
  const memberRows = sessionRows.flatMap((s) => s.riskAlphaKeptMembers);
  const memberSummary = summarizeMembers(memberRows);
  const returns = sessionRows.map((s) => s.riskAlphaNetReturnPct).filter(Number.isFinite);
  return Object.freeze({
    sessions: sessionRows.length,
    averageRiskAlphaNetReturnPct: round(mean(returns), 4),
    ...memberSummary,
  });
}

function splitDates(dates) {
  return [0, 1, 2].map((i) => {
    const start = Math.floor(i * dates.length / 3);
    const end = Math.floor((i + 1) * dates.length / 3);
    return dates.slice(start, end);
  });
}

function buildArm(name, sessionRows, returnSelector, memberSelector) {
  const returns = sessionRows.map(returnSelector).filter(Number.isFinite);
  const members = sessionRows.flatMap(memberSelector);
  return Object.freeze({
    name,
    metrics: aggregateRiskAlphaReturns(returns),
    outcomes: summarizeMembers(members),
  });
}

const audit = readJson(auditPath);
const sessions = Array.isArray(audit.sessions) ? audit.sessions : [];
if (sessions.length !== EXPECTED_SESSIONS) {
  throw new Error(`EVIDENCE_WINDOW_MISMATCH expected=${EXPECTED_SESSIONS} actual=${sessions.length}`);
}

const histories = new Map();
for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
  const doc = readJson(path.join(historyDir, file));
  const ticker = String(doc.ticker || file.replace(/\.json$/i, '')).toUpperCase();
  histories.set(ticker, adjustedCloseBars(doc));
}

const sessionRows = [];
for (const session of sessions) {
  const signalDate = String(session.signalDate || '');
  const originalMembers = (session.members || []).map((member) => {
    const guard = classifyRiskAlphaMember(member);
    return Object.freeze({
      ticker: String(member.ticker || '').toUpperCase(),
      executable: Boolean(member.executableByOpenRule),
      outcome: outcome(member),
      nextCloseReturnPct: Number.isFinite(Number(member.nextCloseReturnPct)) ? Number(member.nextCloseReturnPct) : null,
      riskAlphaVeto: guard.veto,
      riskAlphaDecision: guard.decision,
    });
  });
  const seriesByTicker = {};
  for (const member of originalMembers) {
    const bars = histories.get(member.ticker) || [];
    seriesByTicker[member.ticker] = returnSeriesThrough(bars, signalDate);
  }
  const correlation = assessCorrelationConcentration({ returnSeriesByTicker: seriesByTicker });
  if (correlation.latestUsedDate && correlation.latestUsedDate > signalDate) {
    throw new Error(`LOOKAHEAD_DETECTED:${signalDate}:${correlation.latestUsedDate}`);
  }
  for (const series of Object.values(seriesByTicker)) {
    for (const point of series) {
      if (String(point.date) > signalDate) throw new Error(`RETURN_LOOKAHEAD:${signalDate}:${point.date}`);
    }
  }

  const riskAlpha = evaluateRiskAlphaSession(session);
  const riskAlphaKeptMembers = originalMembers.filter((m) => !m.riskAlphaVeto);
  sessionRows.push(Object.freeze({
    signalDate,
    outcomeDate: String(session.outcomeDate || ''),
    baselineNetReturnPct: Number(session.netReturnPct),
    riskAlphaNetReturnPct: Number(riskAlpha.challengerNetReturnPct),
    originalMembers,
    riskAlphaKeptMembers,
    correlationDecision: correlation.decision,
    medianPairwiseCorrelation: Number.isFinite(correlation.medianPairwiseCorrelation)
      ? correlation.medianPairwiseCorrelation : null,
    eligiblePairs: correlation.eligiblePairs,
    latestCorrelationDate: correlation.latestUsedDate,
  }));
}

const residualStops = sessionRows.flatMap((s) => s.riskAlphaKeptMembers)
  .filter((m) => m.executable && m.outcome === 'STOP').length;
if (residualStops !== EXPECTED_RISKALPHA_RESIDUAL_STOPS) {
  throw new Error(`RESIDUAL_STOP_BASIS_CHANGED expected=${EXPECTED_RISKALPHA_RESIDUAL_STOPS} actual=${residualStops}`);
}

const watch = sessionRows.filter((s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionWatch);
const pass = sessionRows.filter((s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionPass);
const unavailable = sessionRows.filter((s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionUnavailable);
const watchSummary = summarizeSessionGroup(watch);
const passSummary = summarizeSessionGroup(pass);
const separation = Object.freeze({
  residualStopRateWatchMinusPassPp: round((watchSummary.stopRatePct ?? 0) - (passSummary.stopRatePct ?? 0), 2),
  riskAlphaAverageReturnWatchMinusPassPp: round((watchSummary.averageRiskAlphaNetReturnPct ?? 0) - (passSummary.averageRiskAlphaNetReturnPct ?? 0), 4),
});
const materialAdverseSeparation = separation.residualStopRateWatchMinusPassPp >= ACCEPTANCE.minimumResidualStopRateSeparationPp
  || separation.riskAlphaAverageReturnWatchMinusPassPp <= -ACCEPTANCE.minimumRiskAlphaReturnSeparationPp;

const dates = sessionRows.map((s) => s.signalDate).sort();
const folds = splitDates(dates).map((foldDates, index) => {
  const set = new Set(foldDates);
  const foldRows = sessionRows.filter((s) => set.has(s.signalDate));
  const foldWatch = foldRows.filter((s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionWatch);
  const foldPass = foldRows.filter((s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionPass);
  const a = summarizeSessionGroup(foldWatch);
  const b = summarizeSessionGroup(foldPass);
  const stopDelta = round((a.stopRatePct ?? 0) - (b.stopRatePct ?? 0), 2);
  const returnDelta = round((a.averageRiskAlphaNetReturnPct ?? 0) - (b.averageRiskAlphaNetReturnPct ?? 0), 4);
  const sampleEligible = foldWatch.length >= ACCEPTANCE.minimumFlaggedSessionsPerEligibleFold;
  const adverseDirection = sampleEligible && (stopDelta > 0 || returnDelta < 0);
  return Object.freeze({
    fold: index + 1,
    from: foldDates[0] || null,
    to: foldDates.at(-1) || null,
    watch: a,
    pass: b,
    residualStopRateWatchMinusPassPp: stopDelta,
    riskAlphaAverageReturnWatchMinusPassPp: returnDelta,
    sampleEligible,
    adverseDirection,
  });
});
const eligibleFolds = folds.filter((f) => f.sampleEligible).length;
const supportingFolds = folds.filter((f) => f.adverseDirection).length;

const armA = buildArm(
  'A_V16_9_CHAMPION',
  sessionRows,
  (s) => s.baselineNetReturnPct,
  (s) => s.originalMembers,
);
const armB = buildArm(
  'B_RISKALPHA_STAGE_B',
  sessionRows,
  (s) => s.riskAlphaNetReturnPct,
  (s) => s.riskAlphaKeptMembers,
);
const armC = buildArm(
  'C_CORRELATION_CONCENTRATION',
  sessionRows,
  (s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionWatch ? 0 : s.baselineNetReturnPct,
  (s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionWatch ? [] : s.originalMembers,
);
const armD = buildArm(
  'D_CORRELATION_PLUS_RISKALPHA',
  sessionRows,
  (s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionWatch ? 0 : s.riskAlphaNetReturnPct,
  (s) => s.correlationDecision === CORRELATION_CONCENTRATION_POLICY.decisionWatch ? [] : s.riskAlphaKeptMembers,
);

const incremental = Object.freeze({
  averageReturnDeltaPp: round((armD.metrics.averageNetReturnPct ?? 0) - (armB.metrics.averageNetReturnPct ?? 0), 4),
  profitFactorDelta: round((armD.metrics.profitFactor ?? 0) - (armB.metrics.profitFactor ?? 0), 3),
  maxDrawdownImprovementPp: round((armD.metrics.maximumDrawdownPct ?? 0) - (armB.metrics.maximumDrawdownPct ?? 0), 3),
  winRateDeltaPp: round((armD.metrics.winningSessionPct ?? 0) - (armB.metrics.winningSessionPct ?? 0), 3),
  residualStopRateReductionPp: round((armB.outcomes.stopRatePct ?? 0) - (armD.outcomes.stopRatePct ?? 0), 2),
  targetRateChangePp: round((armD.outcomes.targetRatePct ?? 0) - (armB.outcomes.targetRatePct ?? 0), 2),
});

const checks = Object.freeze({
  enoughFlaggedSessions: watch.length >= ACCEPTANCE.minimumFlaggedSessions,
  materialAdverseSeparation,
  enoughEligibleFolds: eligibleFolds >= ACCEPTANCE.minimumEligibleFolds,
  enoughSupportingFolds: supportingFolds >= ACCEPTANCE.minimumSupportingFolds,
  drawdownImproves: incremental.maxDrawdownImprovementPp >= ACCEPTANCE.minimumCombinedDrawdownImprovementPp,
  profitFactorNotWorse: incremental.profitFactorDelta >= ACCEPTANCE.minimumCombinedProfitFactorDelta,
  averageReturnPreserved: incremental.averageReturnDeltaPp >= ACCEPTANCE.minimumCombinedAverageReturnDeltaPp,
  winRatePreserved: incremental.winRateDeltaPp >= ACCEPTANCE.minimumCombinedWinRateDeltaPp,
  noLookahead: true,
});
const allChecksPass = Object.values(checks).every(Boolean);

const report = {
  schemaVersion: 'egx.v169-correlation-concentration-audit.1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'PREREGISTERED_ONE_SHOT_RETROSPECTIVE_CORRELATION_CONCENTRATION_TEST',
  governance: {
    researchOnly: true,
    champion: 'V16.9',
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
    promotionEligible: false,
    correlationThresholdRetuned: false,
    riskAlphaRetuned: false,
    freshForwardLedgerChanged: false,
    mainBranchChanged: false,
  },
  source: {
    sessions: sessions.length,
    fromSignalDate: sessions[0]?.signalDate ?? null,
    toSignalDate: sessions.at(-1)?.signalDate ?? null,
    lastOutcomeDate: sessions.at(-1)?.outcomeDate ?? null,
    residualRiskAlphaStops: residualStops,
  },
  policy: CORRELATION_CONCENTRATION_POLICY,
  acceptance: ACCEPTANCE,
  diagnostic: {
    watch: watchSummary,
    pass: passSummary,
    unavailableSessions: unavailable.length,
    separation,
    folds,
    flaggedSessions: watch.map((s) => ({
      signalDate: s.signalDate,
      medianPairwiseCorrelation: round(s.medianPairwiseCorrelation, 4),
      eligiblePairs: s.eligiblePairs,
      riskAlphaNetReturnPct: s.riskAlphaNetReturnPct,
      residualStops: s.riskAlphaKeptMembers.filter((m) => m.executable && m.outcome === 'STOP').length,
      residualTargets: s.riskAlphaKeptMembers.filter((m) => m.executable && m.outcome === 'TARGET').length,
    })),
  },
  arms: [armA, armB, armC, armD],
  incrementalCombinedVsRiskAlpha: incremental,
  checks,
  retrospectiveStatus: allChecksPass ? 'PROMISING_RETROSPECTIVE_SHADOW_ONLY' : 'REJECTED_ONE_SHOT_NO_RETUNE',
  disposition: allChecksPass
    ? 'FREEZE_ZERO_WEIGHT_CORRELATION_EXPERT_FOR_SEPARATE_FRESH_FORWARD_CONFIRMATION_KEEP_V16_9_CHAMPION'
    : 'REJECT_CORRELATION_CONCENTRATION_V1_NO_RETUNE_KEEP_V16_9_CHAMPION',
  note: 'A retrospective pass cannot promote or authorize the expert. A failure is terminal for this frozen v1 threshold set; do not retune from these outcomes.',
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
