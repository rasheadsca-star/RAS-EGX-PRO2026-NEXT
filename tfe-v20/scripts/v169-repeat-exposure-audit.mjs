import fs from 'node:fs';
import path from 'node:path';
import {
  classifyRiskAlphaMember,
  aggregateRiskAlphaReturns,
} from '../src/v169RiskAlphaChallenger.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v169-repeat-exposure-audit.json');

const EXPECTED_SESSIONS = 45;
const EXPECTED_RESIDUAL_STOPS = 32;
const COST_PCT = 0.60;
const LOOKBACK_SIGNAL_SESSIONS = 5;
const REPEAT_THRESHOLD = 2;
const ACCEPTANCE = Object.freeze({
  minimumFlaggedResidualExecutable: 12,
  minimumFlaggedPerEligibleFold: 4,
  minimumEligibleFolds: 2,
  minimumWorseStopRatePp: 10,
  minimumWorseAverageReturnPp: 1.0,
  minimumDrawdownImprovementPp: 1.0,
  minimumProfitFactorDelta: 0.0,
  minimumAverageReturnDeltaPp: -0.10,
  minimumResidualStopRateReductionPp: 3.0,
  minimumTargetRateChangePp: -5.0,
});

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function finite(v) { return Number.isFinite(Number(v)); }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function rate(n, d) { return d ? n / d * 100 : 0; }
function round(v, d = 4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }

function outcome(member) {
  if (!member.executableByOpenRule) return 'NO_ENTRY';
  if (member.stopTouched) return 'STOP';
  if (member.conservativeTargetHit) return 'TARGET';
  return 'OTHER';
}

function summarizeRows(rows) {
  const executable = rows.filter((r) => r.executable);
  const stops = executable.filter((r) => r.outcome === 'STOP').length;
  const targets = executable.filter((r) => r.outcome === 'TARGET').length;
  const returns = executable.map((r) => r.nextCloseReturnPct).filter(Number.isFinite);
  return Object.freeze({
    members: rows.length,
    executable: executable.length,
    stops,
    targets,
    stopRatePct: round(rate(stops, executable.length), 2),
    targetRatePct: round(rate(targets, executable.length), 2),
    averageNextCloseReturnPct: round(mean(returns), 4),
  });
}

function comparison(flagged, pass) {
  return Object.freeze({
    stopRateFlaggedMinusPassPp: round((flagged.stopRatePct ?? 0) - (pass.stopRatePct ?? 0), 2),
    averageReturnFlaggedMinusPassPp: round((flagged.averageNextCloseReturnPct ?? 0) - (pass.averageNextCloseReturnPct ?? 0), 4),
  });
}

function counterfactualSessionReturn(session, rowMap, keepPredicate) {
  const kept = [];
  for (const member of (session.members || [])) {
    const key = `${session.signalDate}|${String(member.ticker || '').toUpperCase()}`;
    const row = rowMap.get(key);
    if (!row) throw new Error(`MISSING_JOINED_ROW:${key}`);
    if (!keepPredicate(row)) continue;
    if (finite(member.nextCloseReturnPct)) kept.push(Number(member.nextCloseReturnPct));
  }
  return kept.length ? mean(kept) - COST_PCT : 0;
}

function buildArm({ name, audit, rows, rowMap, keepPredicate, baseline = false }) {
  const keptRows = rows.filter(keepPredicate);
  const returns = baseline
    ? audit.sessions.map((s) => Number(s.netReturnPct)).filter(Number.isFinite)
    : audit.sessions.map((s) => counterfactualSessionReturn(s, rowMap, keepPredicate));
  return Object.freeze({
    name,
    removedMembers: rows.length - keptRows.length,
    retainedMembers: keptRows.length,
    metrics: aggregateRiskAlphaReturns(returns),
    outcomes: summarizeRows(keptRows),
  });
}

function splitDates(dates) {
  return [0, 1, 2].map((i) => {
    const start = Math.floor(i * dates.length / 3);
    const end = Math.floor((i + 1) * dates.length / 3);
    return dates.slice(start, end);
  });
}

const audit = readJson(auditPath);
const sessions = Array.isArray(audit.sessions) ? audit.sessions : [];
if (sessions.length !== EXPECTED_SESSIONS) {
  throw new Error(`EVIDENCE_WINDOW_MISMATCH expected=${EXPECTED_SESSIONS} actual=${sessions.length}`);
}

const rows = [];
const rowMap = new Map();
for (let i = 0; i < sessions.length; i += 1) {
  const session = sessions[i];
  const signalDate = String(session.signalDate || '');
  const prior = sessions.slice(Math.max(0, i - LOOKBACK_SIGNAL_SESSIONS), i);
  for (const member of (session.members || [])) {
    const ticker = String(member.ticker || '').toUpperCase();
    const priorAppearances = prior.reduce((count, s) => {
      const seen = (s.members || []).some((m) => String(m.ticker || '').toUpperCase() === ticker);
      return count + (seen ? 1 : 0);
    }, 0);
    const repeatDecision = priorAppearances >= REPEAT_THRESHOLD ? 'REPEAT_EXPOSURE_WATCH' : 'PASS';
    const riskAlpha = classifyRiskAlphaMember(member);
    const row = Object.freeze({
      signalDate,
      outcomeDate: String(session.outcomeDate || ''),
      ticker,
      priorSessionsAvailable: prior.length,
      priorAppearances,
      repeatDecision,
      riskAlphaDecision: riskAlpha.decision,
      riskAlphaVeto: Boolean(riskAlpha.veto),
      executable: Boolean(member.executableByOpenRule),
      outcome: outcome(member),
      nextCloseReturnPct: finite(member.nextCloseReturnPct) ? Number(member.nextCloseReturnPct) : null,
    });
    const key = `${signalDate}|${ticker}`;
    if (rowMap.has(key)) throw new Error(`DUPLICATE_MEMBER:${key}`);
    rowMap.set(key, row);
    rows.push(row);
  }
}

const expectedMembers = sessions.reduce((n, s) => n + (s.members || []).length, 0);
if (rows.length !== expectedMembers) throw new Error('MEMBER_JOIN_COUNT_MISMATCH');

// Validity guard: the repeat count was built only from array positions strictly before i.
for (const row of rows) {
  if (row.priorAppearances > row.priorSessionsAvailable) throw new Error(`INVALID_REPEAT_COUNT:${row.signalDate}:${row.ticker}`);
}

const keepAll = () => true;
const keepRiskAlpha = (r) => !r.riskAlphaVeto;
const keepRepeat = (r) => r.repeatDecision !== 'REPEAT_EXPOSURE_WATCH';
const keepCombined = (r) => keepRiskAlpha(r) && keepRepeat(r);

const armA = buildArm({ name: 'A_V16_9_CHAMPION', audit, rows, rowMap, keepPredicate: keepAll, baseline: true });
const armB = buildArm({ name: 'B_RISKALPHA_STAGE_B', audit, rows, rowMap, keepPredicate: keepRiskAlpha });
const armC = buildArm({ name: 'C_REPEAT_EXPOSURE_ONLY', audit, rows, rowMap, keepPredicate: keepRepeat });
const armD = buildArm({ name: 'D_COMBINED_REPEAT_PLUS_RISKALPHA', audit, rows, rowMap, keepPredicate: keepCombined });

const residual = rows.filter((r) => !r.riskAlphaVeto);
const residualExecutable = residual.filter((r) => r.executable);
const residualStops = residualExecutable.filter((r) => r.outcome === 'STOP').length;
if (residualStops !== EXPECTED_RESIDUAL_STOPS) {
  throw new Error(`RESIDUAL_STOP_BASIS_CHANGED expected=${EXPECTED_RESIDUAL_STOPS} actual=${residualStops}`);
}

const flaggedResidual = residual.filter((r) => r.repeatDecision === 'REPEAT_EXPOSURE_WATCH');
const passResidual = residual.filter((r) => r.repeatDecision === 'PASS');
const flaggedSummary = summarizeRows(flaggedResidual);
const passSummary = summarizeRows(passResidual);
const separation = comparison(flaggedSummary, passSummary);
const materialAdverseSeparation = separation.stopRateFlaggedMinusPassPp >= ACCEPTANCE.minimumWorseStopRatePp
  || separation.averageReturnFlaggedMinusPassPp <= -ACCEPTANCE.minimumWorseAverageReturnPp;

const dates = [...new Set(rows.map((r) => r.signalDate))].sort();
const folds = splitDates(dates).map((foldDates, i) => {
  const set = new Set(foldDates);
  const fold = residual.filter((r) => set.has(r.signalDate));
  const flagged = summarizeRows(fold.filter((r) => r.repeatDecision === 'REPEAT_EXPOSURE_WATCH'));
  const pass = summarizeRows(fold.filter((r) => r.repeatDecision === 'PASS'));
  const cmp = comparison(flagged, pass);
  const sampleEligible = flagged.executable >= ACCEPTANCE.minimumFlaggedPerEligibleFold;
  const adverseDirection = sampleEligible
    && (cmp.stopRateFlaggedMinusPassPp > 0 || cmp.averageReturnFlaggedMinusPassPp < 0);
  return Object.freeze({
    fold: i + 1,
    from: foldDates[0] || null,
    to: foldDates.at(-1) || null,
    flagged,
    pass,
    comparison: cmp,
    sampleEligible,
    adverseDirection,
  });
});

const eligibleFolds = folds.filter((f) => f.sampleEligible).length;
const supportingFolds = folds.filter((f) => f.adverseDirection).length;
const deltaCombinedVsRiskAlpha = Object.freeze({
  averageReturnPp: round((armD.metrics.averageNetReturnPct ?? 0) - (armB.metrics.averageNetReturnPct ?? 0), 4),
  profitFactor: round((armD.metrics.profitFactor ?? 0) - (armB.metrics.profitFactor ?? 0), 3),
  maxDrawdownImprovementPp: round((armD.metrics.maximumDrawdownPct ?? 0) - (armB.metrics.maximumDrawdownPct ?? 0), 3),
  residualStopRateReductionPp: round((armB.outcomes.stopRatePct ?? 0) - (armD.outcomes.stopRatePct ?? 0), 2),
  targetRateChangePp: round((armD.outcomes.targetRatePct ?? 0) - (armB.outcomes.targetRatePct ?? 0), 2),
});

const checks = Object.freeze({
  enoughFlaggedResidualExecutable: flaggedSummary.executable >= ACCEPTANCE.minimumFlaggedResidualExecutable,
  materialAdverseSeparation,
  enoughEligibleFolds: eligibleFolds >= ACCEPTANCE.minimumEligibleFolds,
  enoughSupportingFolds: supportingFolds >= ACCEPTANCE.minimumEligibleFolds,
  drawdownImproves: deltaCombinedVsRiskAlpha.maxDrawdownImprovementPp >= ACCEPTANCE.minimumDrawdownImprovementPp,
  profitFactorNotWorse: deltaCombinedVsRiskAlpha.profitFactor >= ACCEPTANCE.minimumProfitFactorDelta,
  averageReturnPreserved: deltaCombinedVsRiskAlpha.averageReturnPp >= ACCEPTANCE.minimumAverageReturnDeltaPp,
  residualStopRateImproves: deltaCombinedVsRiskAlpha.residualStopRateReductionPp >= ACCEPTANCE.minimumResidualStopRateReductionPp,
  targetRatePreserved: deltaCombinedVsRiskAlpha.targetRateChangePp >= ACCEPTANCE.minimumTargetRateChangePp,
  noLookahead: true,
});
const allChecksPass = Object.values(checks).every(Boolean);

const report = {
  schemaVersion: 'egx.v169-repeat-exposure-audit.1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'PREREGISTERED_ONE_SHOT_RETROSPECTIVE_REPEAT_EXPOSURE_TEST',
  governance: {
    researchOnly: true,
    champion: 'V16.9',
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
    promotionEligible: false,
    riskAlphaRetuned: false,
    repeatExposureThresholdRetuned: false,
    freshForwardLedgerChanged: false,
    mainBranchChanged: false,
  },
  source: {
    sessions: sessions.length,
    fromSignalDate: sessions[0]?.signalDate ?? null,
    toSignalDate: sessions.at(-1)?.signalDate ?? null,
    lastOutcomeDate: sessions.at(-1)?.outcomeDate ?? null,
    selectedMembers: rows.length,
    residualRiskAlphaStops: residualStops,
  },
  frozenPolicy: {
    lookbackSignalSessions: LOOKBACK_SIGNAL_SESSIONS,
    repeatAppearanceThreshold: REPEAT_THRESHOLD,
    classification: 'REPEAT_EXPOSURE_WATCH_IF_TICKER_APPEARED_IN_AT_LEAST_2_OF_PREVIOUS_5_V16_9_BASKETS',
    replacementPolicy: 'NONE',
    remainingBasketPolicy: 'EQUAL_WEIGHT_RENORMALIZE_REMAINING_MEMBERS',
    roundTripCostPct: COST_PCT,
  },
  acceptance: ACCEPTANCE,
  diagnostic: {
    residualFlagged: flaggedSummary,
    residualPass: passSummary,
    separation,
    eligibleFolds,
    supportingFolds,
    folds,
  },
  arms: [armA, armB, armC, armD],
  deltaCombinedVsRiskAlpha,
  checks,
  retrospectiveStatus: allChecksPass ? 'PROMISING_RETROSPECTIVE_SHADOW_ONLY' : 'REJECTED_ONE_SHOT_NO_RETUNE',
  disposition: allChecksPass
    ? 'PREREGISTER_REPEAT_EXPOSURE_FORWARD_SHADOW_KEEP_V16_9_CHAMPION'
    : 'REJECT_REPEAT_EXPOSURE_V1_NO_RETUNE_KEEP_V16_9_CHAMPION',
  rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
