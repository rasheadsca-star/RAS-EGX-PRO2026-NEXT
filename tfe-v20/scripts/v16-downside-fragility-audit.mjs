import fs from 'node:fs';
import path from 'node:path';
import {
  DOWNSIDE_FRAGILITY_POLICY,
  assessSignalTimeFragility,
  assessNextOpenRecoveryTrap,
} from '../src/downsideFragilityExpert.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const historyDir = path.join(repoRoot, 'data/history');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v16-downside-fragility-audit.json');

const ACCEPTANCE = Object.freeze({
  minimumFragileExecutable: 15,
  minimumFragilePerEligibleFold: 4,
  minimumEligibleFolds: 2,
  minimumWorseStopRatePp: 10,
  minimumWorseAverageReturnPp: 1,
  minimumTrapEnrichmentPp: 5,
});

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function finite(v) { return Number.isFinite(Number(v)); }
function round(v, d = 4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function rate(n, d) { return d ? n / d * 100 : 0; }

function adjustedBars(doc) {
  return (doc?.sessions || []).map((x) => {
    const close = Number(x.close);
    const adj = Number(x.adjustedClose ?? x.close);
    const factor = close > 0 && adj > 0 ? adj / close : 1;
    return {
      date: String(x.date || ''),
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

function summarize(rows) {
  const executable = rows.filter((r) => r.executable);
  const stops = executable.filter((r) => r.outcome === 'STOP').length;
  const targets = executable.filter((r) => r.outcome === 'TARGET').length;
  const returns = executable.map((r) => r.nextCloseReturnPct).filter(Number.isFinite);
  return {
    rows: rows.length,
    executable: executable.length,
    stops,
    targets,
    stopRatePct: round(rate(stops, executable.length), 2),
    targetRatePct: round(rate(targets, executable.length), 2),
    targetMinusStopEdgePct: round(rate(targets - stops, executable.length), 2),
    positiveNextClosePct: round(rate(returns.filter((v) => v > 0).length, returns.length), 2),
    averageNextCloseReturnPct: round(mean(returns), 4),
    sumNextCloseReturnPct: round(returns.reduce((a, b) => a + b, 0), 4),
  };
}

function splitDates(dates) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const start = Math.floor(i * dates.length / 3);
    const end = Math.floor((i + 1) * dates.length / 3);
    out.push(dates.slice(start, end));
  }
  return out;
}

function groupComparison(fragile, pass) {
  return {
    stopRateFragileMinusPassPp: round((fragile.stopRatePct ?? 0) - (pass.stopRatePct ?? 0), 2),
    averageReturnFragileMinusPassPp: round((fragile.averageNextCloseReturnPct ?? 0) - (pass.averageNextCloseReturnPct ?? 0), 4),
  };
}

const audit = readJson(auditPath);
const histories = new Map();
for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
  const doc = readJson(path.join(historyDir, file));
  const ticker = String(doc.ticker || file.replace(/\.json$/i, '')).toUpperCase();
  histories.set(ticker, adjustedBars(doc));
}

const rows = [];
for (const session of (audit.sessions || [])) {
  const signalDate = String(session.signalDate || '');
  for (const member of (session.members || [])) {
    const ticker = String(member.ticker || '').toUpperCase();
    const bars = histories.get(ticker) || [];
    const signal = assessSignalTimeFragility({ bars, signalDate });
    const execution = assessNextOpenRecoveryTrap({
      frozenEntryLow: Number(member.entryLow),
      nextOpen: Number(member.nextOpen),
    });
    rows.push({
      signalDate,
      ticker,
      executable: Boolean(member.executableByOpenRule),
      outcome: outcome(member),
      nextCloseReturnPct: finite(member.nextCloseReturnPct) ? Number(member.nextCloseReturnPct) : null,
      signalDecision: signal.decision,
      signalMetrics: {
        downGapFrequencyPct: signal.downGapFrequencyPct ?? null,
        gapQ10Pct: signal.gapQ10Pct ?? null,
        latestUsedDate: signal.latestUsedDate ?? null,
      },
      executionDecision: execution.decision,
    });
  }
}

if (!rows.length) throw new Error('NO_V16_ROWS_FOR_DOWNSIDE_FRAGILITY_AUDIT');
for (const r of rows) {
  if (r.signalMetrics.latestUsedDate && r.signalMetrics.latestUsedDate > r.signalDate) {
    throw new Error(`LOOKAHEAD_DETECTED:${r.ticker}:${r.signalDate}:${r.signalMetrics.latestUsedDate}`);
  }
}

const executable = rows.filter((r) => r.executable);
const available = executable.filter((r) => r.signalDecision !== 'UNAVAILABLE');
const fragileRows = available.filter((r) => r.signalDecision === 'FRAGILE_WATCH');
const passRows = available.filter((r) => r.signalDecision === 'PASS');
const structuralTraps = executable.filter((r) => r.executionDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY');
const keptBySignal = executable.filter((r) => r.signalDecision !== 'FRAGILE_WATCH');
const keptByStructuralOpenGuard = executable.filter((r) => r.executionDecision !== 'VETO_GAP_DOWN_RECOVERY_ENTRY');

const fragileSummary = summarize(fragileRows);
const passSummary = summarize(passRows);
const comparison = groupComparison(fragileSummary, passSummary);

const trapInFragile = fragileRows.filter((r) => r.executionDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY').length;
const trapInPass = passRows.filter((r) => r.executionDecision === 'VETO_GAP_DOWN_RECOVERY_ENTRY').length;
const trapRateFragile = rate(trapInFragile, fragileRows.length);
const trapRatePass = rate(trapInPass, passRows.length);
const trapEnrichmentPp = trapRateFragile - trapRatePass;
const trapRecallPct = rate(structuralTraps.filter((r) => r.signalDecision === 'FRAGILE_WATCH').length, structuralTraps.length);

const dates = [...new Set(rows.map((r) => r.signalDate))].sort();
const folds = splitDates(dates).map((foldDates, i) => {
  const set = new Set(foldDates);
  const fold = available.filter((r) => set.has(r.signalDate));
  const f = summarize(fold.filter((r) => r.signalDecision === 'FRAGILE_WATCH'));
  const p = summarize(fold.filter((r) => r.signalDecision === 'PASS'));
  const c = groupComparison(f, p);
  const eligible = f.executable >= ACCEPTANCE.minimumFragilePerEligibleFold;
  const worse = c.stopRateFragileMinusPassPp >= 0 || c.averageReturnFragileMinusPassPp <= 0;
  return {
    fold: i + 1,
    from: foldDates[0] || null,
    to: foldDates.at(-1) || null,
    fragile: f,
    pass: p,
    comparison: c,
    sampleEligible: eligible,
    directionSupportsFragility: eligible && worse,
  };
});

const eligibleFolds = folds.filter((f) => f.sampleEligible);
const supportingFolds = folds.filter((f) => f.directionSupportsFragility);
const materialLossSeparation = comparison.stopRateFragileMinusPassPp >= ACCEPTANCE.minimumWorseStopRatePp
  || comparison.averageReturnFragileMinusPassPp <= -ACCEPTANCE.minimumWorseAverageReturnPp;
const signalCandidatePass = fragileRows.length >= ACCEPTANCE.minimumFragileExecutable
  && materialLossSeparation
  && trapEnrichmentPp >= ACCEPTANCE.minimumTrapEnrichmentPp
  && eligibleFolds.length >= ACCEPTANCE.minimumEligibleFolds
  && supportingFolds.length >= ACCEPTANCE.minimumEligibleFolds;

const structuralTrapSummary = summarize(structuralTraps);
const structuralGuardBenefit = {
  vetoedExecutions: structuralTraps.length,
  stopsAvoided: structuralTraps.filter((r) => r.outcome === 'STOP').length,
  targetsMissed: structuralTraps.filter((r) => r.outcome === 'TARGET').length,
  otherRemoved: structuralTraps.filter((r) => r.outcome === 'OTHER').length,
  averageRemovedNextCloseReturnPct: structuralTrapSummary.averageNextCloseReturnPct,
  counterfactualNetBenefitPct: round(-structuralTrapSummary.sumNextCloseReturnPct, 4),
};

const report = {
  schemaVersion: 'v16-downside-fragility-audit-v1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'POSTHOC_MECHANISM_AUDIT_WITH_ONE_SHOT_FIXED_SIGNAL_PREDICTOR',
  governance: {
    researchOnly: true,
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
    promotionEligible: false,
    thresholdsFrozenBeforeThisAuditRun: true,
    retuningAfterOutcome: false,
    freshForwardLedgerChanged: false,
    note: 'The structural next-open guard is mechanism confirmation. The signal-time fragility rule is a one-shot challenger; pass or fail, its thresholds are not retuned on this window.',
  },
  policy: DOWNSIDE_FRAGILITY_POLICY,
  acceptance: ACCEPTANCE,
  source: {
    sessions: dates.length,
    fromSignalDate: dates[0],
    toSignalDate: dates.at(-1),
    joinedRows: rows.length,
    executableRows: executable.length,
    signalAvailableExecutableRows: available.length,
  },
  baseline: summarize(executable),
  observedFailureMechanism: {
    name: 'GAP_DOWN_RECOVERY_TRAP',
    definition: 'V16 executableByOpenRule=true while next session opens below frozen entryLow.',
    structuralTrap: structuralTrapSummary,
    structuralGuardCounterfactual: summarize(keptByStructuralOpenGuard),
    structuralGuardBenefit,
    sameMechanismAlreadyProtectedByFreshForwardEntryPolicy: true,
    interpretation: 'Do not double-count this as new alpha; it explains a specific V16 historical execution loss and independently names the guard already frozen in Fresh Forward.',
  },
  signalTimeFragilityExpert: {
    fragile: fragileSummary,
    pass: passSummary,
    comparison,
    counterfactualAfterFragileVeto: summarize(keptBySignal),
    structuralTrapTargeting: {
      trapInFragile,
      trapInPass,
      trapRateFragilePct: round(trapRateFragile, 2),
      trapRatePassPct: round(trapRatePass, 2),
      trapEnrichmentPp: round(trapEnrichmentPp, 2),
      trapRecallPct: round(trapRecallPct, 2),
    },
    folds,
    checks: {
      enoughFragileExecutions: fragileRows.length >= ACCEPTANCE.minimumFragileExecutable,
      materialLossSeparation,
      trapEnrichmentAtLeast5Pp: trapEnrichmentPp >= ACCEPTANCE.minimumTrapEnrichmentPp,
      atLeastTwoEligibleFolds: eligibleFolds.length >= ACCEPTANCE.minimumEligibleFolds,
      atLeastTwoSupportingFolds: supportingFolds.length >= ACCEPTANCE.minimumEligibleFolds,
      noLookahead: true,
    },
    status: signalCandidatePass ? 'PROMISING_RETROSPECTIVE_SHADOW_ONLY' : 'REJECTED_ONE_SHOT_NO_RETUNE',
    promotionEligible: false,
  },
  disposition: signalCandidatePass
    ? 'KEEP_ZERO_WEIGHT_AND_PREREGISTER_FORWARD_SIGNAL_TIME_FRAGILITY_OBSERVATION'
    : 'REJECT_SIGNAL_TIME_FRAGILITY_RULE_KEEP_ONLY_STRUCTURAL_OPEN_GUARD_AS_NON_ALPHA_EXECUTION_CONTROL',
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
