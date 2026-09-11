import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const v16Path = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const v19Path = path.join(repoRoot, 'data/v19/native-challenger-v6.json');
const outPath = path.join(repoRoot, 'tfe-v20/reports/meta-v19-development-consensus-audit.json');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 2) { if (!Number.isFinite(v)) return null; const q = 10 ** d; return Math.round(v * q) / q; }
function mean(xs) { const q = xs.filter(Number.isFinite); return q.length ? q.reduce((a, b) => a + b, 0) / q.length : null; }

function metrics(rows) {
  const executable = rows.filter(x => x.executableByOpenRule === true);
  const target = executable.filter(x => x.conservativeTargetHit === true).length;
  const stops = executable.filter(x => x.stopTouched === true).length;
  const next = executable.map(x => Number(x.nextCloseReturnPct)).filter(Number.isFinite);
  return {
    selectionCount: rows.length,
    executableCount: executable.length,
    noEntryCount: rows.length - executable.length,
    conservativeTargetHitCount: target,
    conservativeTargetHitRatePct: round(target / Math.max(1, executable.length) * 100),
    stopTouchedCount: stops,
    stopTouchRatePct: round(stops / Math.max(1, executable.length) * 100),
    targetMinusStopEdgePct: round((target - stops) / Math.max(1, executable.length) * 100),
    averageNextCloseReturnPct: round(mean(next), 4),
    positiveNextCloseReturnPct: round(next.filter(x => x > 0).length / Math.max(1, next.length) * 100)
  };
}

function delta(a, b) {
  return {
    targetRatePct: round(a.conservativeTargetHitRatePct - b.conservativeTargetHitRatePct),
    stopRatePct: round(a.stopTouchRatePct - b.stopTouchRatePct),
    targetMinusStopEdgePct: round(a.targetMinusStopEdgePct - b.targetMinusStopEdgePct),
    averageNextCloseReturnPct: round(a.averageNextCloseReturnPct - b.averageNextCloseReturnPct, 4),
    positiveNextCloseReturnPct: round(a.positiveNextCloseReturnPct - b.positiveNextCloseReturnPct)
  };
}

function evaluate(rows) {
  const agreed = metrics(rows.filter(x => x.v19Confirmed));
  const v16Only = metrics(rows.filter(x => !x.v19Confirmed));
  return { agreed, v16Only, deltasAgreementMinusV16Only: delta(agreed, v16Only) };
}

const v16 = readJson(v16Path);
const v19 = readJson(v19Path);
const v19Dev = Array.isArray(v19?.development?.results) ? v19.development.results : [];
const v19HoldoutDates = new Set((v19?.holdoutBenchmark?.results || []).map(x => x.signalDate));
const v19ByDate = new Map(v19Dev.map(x => [x.signalDate, new Set(x.tickers || [])]));
const v16Sessions = (v16.sessions || []).filter(s => v19ByDate.has(s.signalDate) && !v19HoldoutDates.has(s.signalDate));

const joined = [];
for (const session of v16Sessions) {
  const confirmed = v19ByDate.get(session.signalDate);
  for (const member of session.members || []) {
    joined.push({
      ...member,
      signalDate: session.signalDate,
      outcomeDate: session.outcomeDate,
      v19Confirmed: confirmed.has(member.ticker)
    });
  }
}

if (!joined.length) {
  throw new Error('No common development dates between V16 blocked walk-forward and V19 V6 development replay');
}

const overall = evaluate(joined);
const dates = [...new Set(joined.map(x => x.signalDate))].sort();
const folds = [];
for (let i = 0; i < 3; i++) {
  const start = Math.floor(i * dates.length / 3);
  const end = Math.floor((i + 1) * dates.length / 3);
  const foldDates = new Set(dates.slice(start, end));
  const rows = joined.filter(x => foldDates.has(x.signalDate));
  const e = evaluate(rows);
  const eligible = e.agreed.executableCount >= 4 && e.v16Only.executableCount >= 4;
  const positiveDirection = eligible
    && e.deltasAgreementMinusV16Only.targetMinusStopEdgePct > 0
    && e.deltasAgreementMinusV16Only.stopRatePct <= 0
    && e.deltasAgreementMinusV16Only.averageNextCloseReturnPct > 0;
  folds.push({ fold: i + 1, from: dates[start] || null, to: dates[end - 1] || null, eligible, positiveDirection, ...e });
}

const checks = {
  sampleAgreedExecutableAtLeast12: overall.agreed.executableCount >= 12,
  sampleV16OnlyExecutableAtLeast12: overall.v16Only.executableCount >= 12,
  targetUpliftAtLeast5pp: overall.deltasAgreementMinusV16Only.targetRatePct >= 5,
  stopNotWorse: overall.deltasAgreementMinusV16Only.stopRatePct <= 0,
  edgeUpliftAtLeast8pp: overall.deltasAgreementMinusV16Only.targetMinusStopEdgePct >= 8,
  averageNextCloseReturnImproves: overall.deltasAgreementMinusV16Only.averageNextCloseReturnPct > 0,
  positiveDirectionInAtLeast2EligibleFolds: folds.filter(x => x.eligible && x.positiveDirection).length >= 2
};

const supportsConfirmatoryHypothesis = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 'meta-v19-development-consensus-audit-v1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'WALK_FORWARD_DEVELOPMENT_REPLAY_SHARED_RESEARCH_LINEAGE',
  sourcePolicy: {
    v16: 'Exact V16.9 blocked walk-forward selections with conservative next-session target/stop audit',
    v19: 'V19 V6 development walk-forward selections only; reused final holdout explicitly excluded',
    v19Lineage: 'DISTINCT_RANKING_SHARED_RESEARCH_UTILITIES_AND_POSTHOC_POLICY_LINEAGE',
    transactionCostContextPct: 0.60,
    automaticPromotion: false
  },
  coverage: {
    commonDevelopmentSessions: dates.length,
    fromSignalDate: dates[0] || null,
    toSignalDate: dates.at(-1) || null,
    joinedV16Selections: joined.length,
    excludedV19HoldoutDates: v19HoldoutDates.size
  },
  overall,
  folds,
  preregisteredChecks: checks,
  supportsConfirmatoryHypothesis,
  promotion: {
    eligible: false,
    reason: supportsConfirmatoryHypothesis
      ? 'Hypothesis survives older development replay, but V19 remains shared-lineage and V6 policy was benchmark/post-hoc informed; fresh independent evidence still required.'
      : 'V19 agreement uplift does not robustly reproduce outside the reused holdout; do not give V19 positive alpha weight.'
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
