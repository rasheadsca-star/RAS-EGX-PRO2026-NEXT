import fs from 'node:fs';
import path from 'node:path';
import {
  DOWNSIDE_FRAGILITY_POLICY,
  assessSignalTimeFragility,
  assessNextOpenRecoveryTrap,
} from '../src/downsideFragilityExpert.js';
import { aggregateRiskAlphaReturns } from '../src/v169RiskAlphaChallenger.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const historyDir = path.join(repoRoot, 'data/history');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v169-loss-shield-stagea-stack-audit.json');

const COST_PCT = 0.60;
const EXPECTED_SESSIONS = 45;
const STAGE_A_ACCEPTANCE = Object.freeze({
  minimumFragileExecutable: 15,
  minimumFragilePerEligibleFold: 4,
  minimumEligibleFolds: 2,
  minimumWorseStopRatePp: 10,
  minimumWorseAverageReturnPp: 1,
  minimumTrapEnrichmentPp: 5,
});

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function finite(v) { return Number.isFinite(Number(v)); }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function rate(n, d) { return d ? n / d * 100 : 0; }

function adjustedBars(doc) {
  return (doc?.sessions || []).map((x) => {
    const close = Number(x.close);
    const adj = Number(x.adjustedClose ?? x.close);
    const factor = close > 0 && adj > 0 ? adj / close : 1;
    return {
      date: String(x.date || x.sessionDate || '').slice(0, 10),
      open: Number(x.open) * factor,
      close: adj,
    };
  }).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.open > 0 && x.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
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

function splitDates(dates) {
  return [0, 1, 2].map((i) => {
    const start = Math.floor(i * dates.length / 3);
    const end = Math.floor((i + 1) * dates.length / 3);
    return dates.slice(start, end);
  });
}

function groupComparison(fragile, pass) {
  return Object.freeze({
    stopRateFragileMinusPassPp: round((fragile.stopRatePct ?? 0) - (pass.stopRatePct ?? 0), 2),
    averageReturnFragileMinusPassPp: round((fragile.averageNextCloseReturnPct ?? 0) - (pass.averageNextCloseReturnPct ?? 0), 4),
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

const audit = readJson(auditPath);
const sessions = Array.isArray(audit.sessions) ? audit.sessions : [];
if (sessions.length !== EXPECTED_SESSIONS) {
  throw new Error(`EVIDENCE_WINDOW_MISMATCH expected=${EXPECTED_SESSIONS} actual=${sessions.length}`);
}

const histories = new Map();
for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
  const doc = readJson(path.join(historyDir, file));
  const ticker = String(doc.ticker || file.replace(/\.json$/i, '')).toUpperCase();
  histories.set(ticker, adjustedBars(doc));
}

const rows = [];
const rowMap = new Map();
for (const session of sessions) {
  const signalDate = String(session.signalDate || '');
  for (const member of (session.members || [])) {
    const ticker = String(member.ticker || '').toUpperCase();
    const bars = histories.get(ticker) || [];
    const stageA = assessSignalTimeFragility({ bars, signalDate });
    const stageB = assessNextOpenRecoveryTrap({
      frozenEntryLow: Number(member.entryLow),
      nextOpen: Number(member.nextOpen),
    });
    const row = Object.freeze({
      signalDate,
      outcomeDate: String(session.outcomeDate || ''),
      ticker,
      executable: Boolean(member.executableByOpenRule),
      outcome: outcome(member),
      nextCloseReturnPct: finite(member.nextCloseReturnPct) ? Number(member.nextCloseReturnPct) : null,
      stageADecision: stageA.decision,
      stageALatestUsedDate: stageA.latestUsedDate ?? null,
      stageADownGapFrequencyPct: stageA.downGapFrequencyPct ?? null,
      stageAGapQ10Pct: stageA.gapQ10Pct ?? null,
      stageBDecision: stageB.decision,
    });
    if (row.stageALatestUsedDate && row.stageALatestUsedDate > signalDate) {
      throw new Error(`LOOKAHEAD_DETECTED:${ticker}:${signalDate}:${row.stageALatestUsedDate}`);
    }
    const key = `${signalDate}|${ticker}`;
    if (rowMap.has(key)) throw new Error(`DUPLICATE_MEMBER:${key}`);
    rowMap.set(key, row);
    rows.push(row);
  }
}

const expectedMembers = sessions.reduce((n, s) => n + (s.members || []).length, 0);
if (rows.length !== expectedMembers) throw new Error('MEMBER_JOIN_COUNT_MISMATCH');

const keepAll = () => true;
const keepRiskAlpha = (r) => r.stageBDecision !== 'VETO_GAP_DOWN_RECOVERY_ENTRY';
const keepStageA = (r) => r.stageADecision !== 'FRAGILE_WATCH';
const keepCombined = (r) => keepRiskAlpha(r) && keepStageA(r);

const armA = buildArm({ name: 'A_V16_9_CHAMPION', audit, rows, rowMap, keepPredicate: keepAll, baseline: true });
const armB = buildArm({ name: 'B_RISKALPHA_STAGE_B', audit, rows, rowMap, keepPredicate: keepRiskAlpha });
const armC = buildArm({ name: 'C_DOWNSIDE_FRAGILITY_STAGE_A', audit, rows, rowMap, keepPredicate: keepStageA });
const armD = buildArm({ name: 'D_COMBINED_STAGE_A_PLUS_RISKALPHA', audit, rows, rowMap, keepPredicate: keepCombined });

const executable = rows.filter((r) => r.executable);
const available = executable.filter((r) => r.stageADecision !== 'UNAVAILABLE');
const fragileRows = available.filter((r) => r.stageADecision === 'FRAGILE_WATCH');
const passRows = available.filter((r) => r.stageADecision === 'PASS');
const structuralTraps = executable.filter((r) => r.stageBDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY');
const fragileSummary = summarizeRows(fragileRows);
const passSummary = summarizeRows(passRows);
const comparison = groupComparison(fragileSummary, passSummary);

const trapInFragile = fragileRows.filter((r) => r.stageBDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY').length;
const trapInPass = passRows.filter((r) => r.stageBDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY').length;
const trapRateFragile = rate(trapInFragile, fragileRows.length);
const trapRatePass = rate(trapInPass, passRows.length);
const trapEnrichmentPp = trapRateFragile - trapRatePass;

const dates = [...new Set(rows.map((r) => r.signalDate))].sort();
const folds = splitDates(dates).map((foldDates, i) => {
  const set = new Set(foldDates);
  const fold = available.filter((r) => set.has(r.signalDate));
  const fragile = summarizeRows(fold.filter((r) => r.stageADecision === 'FRAGILE_WATCH'));
  const pass = summarizeRows(fold.filter((r) => r.stageADecision === 'PASS'));
  const cmp = groupComparison(fragile, pass);
  const sampleEligible = fragile.executable >= STAGE_A_ACCEPTANCE.minimumFragilePerEligibleFold;
  const directionSupportsFragility = sampleEligible
    && (cmp.stopRateFragileMinusPassPp >= 0 || cmp.averageReturnFragileMinusPassPp <= 0);
  return Object.freeze({
    fold: i + 1,
    from: foldDates[0] || null,
    to: foldDates.at(-1) || null,
    fragile,
    pass,
    comparison: cmp,
    sampleEligible,
    directionSupportsFragility,
  });
});

const eligibleFolds = folds.filter((f) => f.sampleEligible).length;
const supportingFolds = folds.filter((f) => f.directionSupportsFragility).length;
const materialLossSeparation = comparison.stopRateFragileMinusPassPp >= STAGE_A_ACCEPTANCE.minimumWorseStopRatePp
  || comparison.averageReturnFragileMinusPassPp <= -STAGE_A_ACCEPTANCE.minimumWorseAverageReturnPp;
const stageAPass = fragileRows.length >= STAGE_A_ACCEPTANCE.minimumFragileExecutable
  && materialLossSeparation
  && trapEnrichmentPp >= STAGE_A_ACCEPTANCE.minimumTrapEnrichmentPp
  && eligibleFolds >= STAGE_A_ACCEPTANCE.minimumEligibleFolds
  && supportingFolds >= STAGE_A_ACCEPTANCE.minimumEligibleFolds;

const deltaCombinedVsRiskAlpha = Object.freeze({
  averageReturnPp: round((armD.metrics.averageNetReturnPct ?? 0) - (armB.metrics.averageNetReturnPct ?? 0), 4),
  profitFactor: round((armD.metrics.profitFactor ?? 0) - (armB.metrics.profitFactor ?? 0), 3),
  maxDrawdownImprovementPp: round((armD.metrics.maximumDrawdownPct ?? 0) - (armB.metrics.maximumDrawdownPct ?? 0), 3),
  stopRateReductionPp: round((armB.outcomes.stopRatePct ?? 0) - (armD.outcomes.stopRatePct ?? 0), 2),
  targetRateChangePp: round((armD.outcomes.targetRatePct ?? 0) - (armB.outcomes.targetRatePct ?? 0), 2),
});

const stageAVeto = rows.filter((r) => r.stageADecision === 'FRAGILE_WATCH');
const stageBVeto = rows.filter((r) => r.stageBDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY');
const overlap = rows.filter((r) => r.stageADecision === 'FRAGILE_WATCH' && r.stageBDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY');

const report = {
  schemaVersion: 'egx.v169-loss-shield-stagea-stack-audit.1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'PREREGISTERED_ONE_SHOT_RETROSPECTIVE_STACK_TEST',
  governance: {
    researchOnly: true,
    champion: 'V16.9',
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
    promotionEligible: false,
    riskAlphaRetuned: false,
    stageAThresholdsRetuned: false,
    freshForwardLedgerChanged: false,
    mainBranchChanged: false,
  },
  source: {
    auditSchema: audit.schemaVersion,
    sessions: sessions.length,
    fromSignalDate: sessions[0]?.signalDate ?? null,
    toSignalDate: sessions.at(-1)?.signalDate ?? null,
    lastOutcomeDate: sessions.at(-1)?.outcomeDate ?? null,
    selectedMembers: rows.length,
    executableMembers: executable.length,
  },
  policy: {
    roundTripCostPct: COST_PCT,
    stageA: DOWNSIDE_FRAGILITY_POLICY,
    stageB: 'VETO_IF_NEXT_OPEN_BELOW_FROZEN_ENTRY_LOW',
    replacementPolicy: 'NONE',
    remainingBasketPolicy: 'EQUAL_WEIGHT_RENORMALIZE_REMAINING_MEMBERS',
  },
  stageAFormalOneShot: {
    acceptance: STAGE_A_ACCEPTANCE,
    fragile: fragileSummary,
    pass: passSummary,
    comparison,
    structuralTrapTargeting: {
      structuralTraps: structuralTraps.length,
      trapInFragile,
      trapInPass,
      trapRateFragilePct: round(trapRateFragile, 2),
      trapRatePassPct: round(trapRatePass, 2),
      trapEnrichmentPp: round(trapEnrichmentPp, 2),
    },
    folds,
    checks: {
      enoughFragileExecutions: fragileRows.length >= STAGE_A_ACCEPTANCE.minimumFragileExecutable,
      materialLossSeparation,
      trapEnrichmentAtLeast5Pp: trapEnrichmentPp >= STAGE_A_ACCEPTANCE.minimumTrapEnrichmentPp,
      atLeastTwoEligibleFolds: eligibleFolds >= STAGE_A_ACCEPTANCE.minimumEligibleFolds,
      atLeastTwoSupportingFolds: supportingFolds >= STAGE_A_ACCEPTANCE.minimumEligibleFolds,
      noLookahead: true,
    },
    status: stageAPass ? 'PROMISING_RETROSPECTIVE_SHADOW_ONLY' : 'REJECTED_ONE_SHOT_NO_RETUNE',
  },
  vetoAnatomy: {
    stageAAllMembers: stageAVeto.length,
    stageBAllMembers: stageBVeto.length,
    overlapAllMembers: overlap.length,
    stageAExecutableStops: stageAVeto.filter((r) => r.executable && r.outcome === 'STOP').length,
    stageAExecutableTargets: stageAVeto.filter((r) => r.executable && r.outcome === 'TARGET').length,
    stageBExecutableStops: stageBVeto.filter((r) => r.executable && r.outcome === 'STOP').length,
    stageBExecutableTargets: stageBVeto.filter((r) => r.executable && r.outcome === 'TARGET').length,
  },
  arms: [armA, armB, armC, armD],
  deltaCombinedVsRiskAlpha,
  formalDisposition: stageAPass
    ? 'KEEP_STAGE_A_ZERO_WEIGHT_FORWARD_SHADOW_ONLY_NO_PROMOTION'
    : 'REJECT_STAGE_A_ONE_SHOT_NO_RETUNE_KEEP_RISKALPHA_V01_REJECTED_AND_V16_9_CHAMPION',
  note: 'The stacked metrics are descriptive. The only formal Stage-A pass/fail rule is the previously frozen Downside Fragility contract. No retrospective result grants production authority.',
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
