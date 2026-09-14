import fs from 'node:fs';
import path from 'node:path';
import { classifyRiskAlphaMember, aggregateRiskAlphaReturns } from '../src/v169RiskAlphaChallenger.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const historyDir = path.join(repoRoot, 'data/history');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v169-liquidity-compression-audit.json');

const EXPECTED_SESSIONS = 45;
const EXPECTED_RESIDUAL_STOPS = 32;
const COST_PCT = 0.60;
const RECENT_N = 5;
const BASELINE_N = 20;
const MIN_RECENT_POSITIVE = 4;
const MIN_BASELINE_POSITIVE = 15;
const RATIO_THRESHOLD = 0.60;
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
function median(xs) {
  const s = xs.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

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

function splitDates(dates) {
  return [0, 1, 2].map((i) => {
    const start = Math.floor(i * dates.length / 3);
    const end = Math.floor((i + 1) * dates.length / 3);
    return dates.slice(start, end);
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

function historyBars(doc) {
  return (doc?.sessions || []).map((x) => ({
    date: String(x.date || x.sessionDate || '').slice(0, 10),
    volume: Number(x.volume),
  })).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.volume) && x.volume >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function assessLiquidity(bars, signalDate) {
  const prior = bars.filter((b) => b.date <= signalDate);
  const recent = prior.slice(-RECENT_N);
  const baseline = prior.slice(-(RECENT_N + BASELINE_N), -RECENT_N);
  const recentPos = recent.map((b) => b.volume).filter((v) => v > 0);
  const baselinePos = baseline.map((b) => b.volume).filter((v) => v > 0);
  const latestUsedDate = recent.at(-1)?.date ?? null;
  if (latestUsedDate && latestUsedDate > signalDate) throw new Error(`LOOKAHEAD_DETECTED:${signalDate}:${latestUsedDate}`);
  if (recentPos.length < MIN_RECENT_POSITIVE || baselinePos.length < MIN_BASELINE_POSITIVE) {
    return Object.freeze({ decision: 'UNAVAILABLE', latestUsedDate, ratio: null });
  }
  const recentMedian = median(recentPos);
  const baselineMedian = median(baselinePos);
  if (!(baselineMedian > 0)) return Object.freeze({ decision: 'UNAVAILABLE', latestUsedDate, ratio: null });
  const ratio = recentMedian / baselineMedian;
  return Object.freeze({
    decision: ratio <= RATIO_THRESHOLD ? 'LIQUIDITY_COMPRESSION_WATCH' : 'PASS',
    latestUsedDate,
    ratio: round(ratio, 4),
    recentMedianVolume: round(recentMedian, 2),
    priorMedianVolume: round(baselineMedian, 2),
  });
}

const audit = readJson(auditPath);
const sessions = Array.isArray(audit.sessions) ? audit.sessions : [];
if (sessions.length !== EXPECTED_SESSIONS) throw new Error(`EVIDENCE_WINDOW_MISMATCH expected=${EXPECTED_SESSIONS} actual=${sessions.length}`);

const histories = new Map();
for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
  const doc = readJson(path.join(historyDir, file));
  const ticker = String(doc.ticker || file.replace(/\.json$/i, '')).toUpperCase();
  histories.set(ticker, historyBars(doc));
}

const rows = [];
const rowMap = new Map();
for (const session of sessions) {
  const signalDate = String(session.signalDate || '');
  for (const member of (session.members || [])) {
    const ticker = String(member.ticker || '').toUpperCase();
    const liquidity = assessLiquidity(histories.get(ticker) || [], signalDate);
    const riskAlpha = classifyRiskAlphaMember(member);
    const row = Object.freeze({
      signalDate,
      outcomeDate: String(session.outcomeDate || ''),
      ticker,
      liquidityDecision: liquidity.decision,
      liquidityRatio: liquidity.ratio,
      liquidityLatestUsedDate: liquidity.latestUsedDate,
      riskAlphaVeto: Boolean(riskAlpha.veto),
      executable: Boolean(member.executableByOpenRule),
      outcome: outcome(member),
      nextCloseReturnPct: finite(member.nextCloseReturnPct) ? Number(member.nextCloseReturnPct) : null,
    });
    if (row.liquidityLatestUsedDate && row.liquidityLatestUsedDate > signalDate) throw new Error(`LOOKAHEAD_DETECTED:${ticker}:${signalDate}`);
    const key = `${signalDate}|${ticker}`;
    if (rowMap.has(key)) throw new Error(`DUPLICATE_MEMBER:${key}`);
    rowMap.set(key, row);
    rows.push(row);
  }
}

const keepAll = () => true;
const keepRiskAlpha = (r) => !r.riskAlphaVeto;
const keepLiquidity = (r) => r.liquidityDecision !== 'LIQUIDITY_COMPRESSION_WATCH';
const keepCombined = (r) => keepRiskAlpha(r) && keepLiquidity(r);
const armA = buildArm({ name: 'A_V16_9_CHAMPION', audit, rows, rowMap, keepPredicate: keepAll, baseline: true });
const armB = buildArm({ name: 'B_RISKALPHA_STAGE_B', audit, rows, rowMap, keepPredicate: keepRiskAlpha });
const armC = buildArm({ name: 'C_LIQUIDITY_COMPRESSION_ONLY', audit, rows, rowMap, keepPredicate: keepLiquidity });
const armD = buildArm({ name: 'D_COMBINED_LIQUIDITY_PLUS_RISKALPHA', audit, rows, rowMap, keepPredicate: keepCombined });

const residual = rows.filter((r) => !r.riskAlphaVeto);
const residualExecutable = residual.filter((r) => r.executable);
const residualStops = residualExecutable.filter((r) => r.outcome === 'STOP').length;
if (residualStops !== EXPECTED_RESIDUAL_STOPS) throw new Error(`RESIDUAL_STOP_BASIS_CHANGED expected=${EXPECTED_RESIDUAL_STOPS} actual=${residualStops}`);

const availableResidual = residual.filter((r) => r.liquidityDecision !== 'UNAVAILABLE');
const flaggedResidual = availableResidual.filter((r) => r.liquidityDecision === 'LIQUIDITY_COMPRESSION_WATCH');
const passResidual = availableResidual.filter((r) => r.liquidityDecision === 'PASS');
const flaggedSummary = summarizeRows(flaggedResidual);
const passSummary = summarizeRows(passResidual);
const separation = comparison(flaggedSummary, passSummary);
const materialAdverseSeparation = separation.stopRateFlaggedMinusPassPp >= ACCEPTANCE.minimumWorseStopRatePp
  || separation.averageReturnFlaggedMinusPassPp <= -ACCEPTANCE.minimumWorseAverageReturnPp;

const dates = [...new Set(rows.map((r) => r.signalDate))].sort();
const folds = splitDates(dates).map((foldDates, i) => {
  const set = new Set(foldDates);
  const fold = availableResidual.filter((r) => set.has(r.signalDate));
  const flagged = summarizeRows(fold.filter((r) => r.liquidityDecision === 'LIQUIDITY_COMPRESSION_WATCH'));
  const pass = summarizeRows(fold.filter((r) => r.liquidityDecision === 'PASS'));
  const cmp = comparison(flagged, pass);
  const sampleEligible = flagged.executable >= ACCEPTANCE.minimumFlaggedPerEligibleFold;
  const adverseDirection = sampleEligible && (cmp.stopRateFlaggedMinusPassPp > 0 || cmp.averageReturnFlaggedMinusPassPp < 0);
  return Object.freeze({ fold: i + 1, from: foldDates[0] || null, to: foldDates.at(-1) || null, flagged, pass, comparison: cmp, sampleEligible, adverseDirection });
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
  schemaVersion: 'egx.v169-liquidity-compression-audit.1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'PREREGISTERED_ONE_SHOT_RETROSPECTIVE_LIQUIDITY_COMPRESSION_TEST',
  governance: {
    researchOnly: true, champion: 'V16.9', scoringImpact: 'NONE', alphaWeight: 0,
    productionAuthority: false, promotionEligible: false, riskAlphaRetuned: false,
    liquidityThresholdRetuned: false, freshForwardLedgerChanged: false, mainBranchChanged: false,
  },
  source: {
    sessions: sessions.length, fromSignalDate: sessions[0]?.signalDate ?? null,
    toSignalDate: sessions.at(-1)?.signalDate ?? null, lastOutcomeDate: sessions.at(-1)?.outcomeDate ?? null,
    selectedMembers: rows.length, residualRiskAlphaStops: residualStops,
  },
  frozenPolicy: {
    recentSessions: RECENT_N, baselineSessions: BASELINE_N,
    minimumRecentPositiveVolume: MIN_RECENT_POSITIVE, minimumBaselinePositiveVolume: MIN_BASELINE_POSITIVE,
    compressionRatioThreshold: RATIO_THRESHOLD, roundTripCostPct: COST_PCT,
    replacementPolicy: 'NONE', remainingBasketPolicy: 'EQUAL_WEIGHT_RENORMALIZE_REMAINING_MEMBERS',
  },
  acceptance: ACCEPTANCE,
  diagnostic: {
    unavailableResidualMembers: residual.filter((r) => r.liquidityDecision === 'UNAVAILABLE').length,
    residualFlagged: flaggedSummary, residualPass: passSummary, separation, eligibleFolds, supportingFolds, folds,
  },
  arms: [armA, armB, armC, armD],
  deltaCombinedVsRiskAlpha,
  checks,
  retrospectiveStatus: allChecksPass ? 'PROMISING_RETROSPECTIVE_SHADOW_ONLY' : 'REJECTED_ONE_SHOT_NO_RETUNE',
  disposition: allChecksPass ? 'PREREGISTER_LIQUIDITY_COMPRESSION_FORWARD_SHADOW_KEEP_V16_9_CHAMPION' : 'REJECT_LIQUIDITY_COMPRESSION_V1_NO_RETUNE_KEEP_V16_9_CHAMPION',
  rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
