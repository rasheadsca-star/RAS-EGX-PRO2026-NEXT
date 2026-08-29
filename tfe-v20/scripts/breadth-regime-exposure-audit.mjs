import fs from 'node:fs';
import path from 'node:path';
import { buildBreadthRegimeSnapshot } from '../src/breadthRegimeExposure.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const historyDir = path.join(repoRoot, 'data/history');
const v16AuditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const outPath = path.join(repoRoot, 'tfe-v20/reports/breadth-regime-exposure-audit.json');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 3) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs) { if (!xs.length) return 0; const s=[...xs].sort((a,b)=>a-b); const i=Math.floor(s.length/2); return s.length%2?s[i]:(s[i-1]+s[i])/2; }

function metrics(returns) {
  const gains = returns.filter(x => x > 0).reduce((a,b)=>a+b,0);
  const losses = Math.abs(returns.filter(x => x < 0).reduce((a,b)=>a+b,0));
  let equity = 1, peak = 1, maxDrawdownPct = 0;
  for (const r of returns) {
    equity *= 1 + r / 100;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
  }
  return {
    sessions: returns.length,
    averageNetReturnPct: round(mean(returns), 4),
    medianNetReturnPct: round(median(returns), 4),
    winningSessionPct: round(returns.length ? returns.filter(x=>x>0).length / returns.length * 100 : 0, 2),
    profitFactor: round(losses > 0 ? gains / losses : gains > 0 ? 999 : 0, 3),
    compoundedNetReturnPct: round((equity - 1) * 100, 3),
    maximumDrawdownPct: round(maxDrawdownPct, 3),
    bestSessionPct: round(returns.length ? Math.max(...returns) : 0, 3),
    worstSessionPct: round(returns.length ? Math.min(...returns) : 0, 3)
  };
}

function foldReport(rows) {
  const baseline = metrics(rows.map(row => row.baselineReturnPct));
  const controlled = metrics(rows.map(row => row.controlledReturnPct));
  return {
    from: rows[0]?.signalDate || null,
    to: rows.at(-1)?.signalDate || null,
    baseline,
    controlled,
    averageDeltaPct: round(controlled.averageNetReturnPct - baseline.averageNetReturnPct, 4),
    drawdownDeltaPct: round(controlled.maximumDrawdownPct - baseline.maximumDrawdownPct, 3),
    passesDirection: controlled.maximumDrawdownPct >= baseline.maximumDrawdownPct && controlled.averageNetReturnPct >= baseline.averageNetReturnPct - 0.25
  };
}

const files = fs.readdirSync(historyDir).filter(x => x.endsWith('.json')).sort();
const documents = files.map(file => {
  const doc = readJson(path.join(historyDir, file));
  return { ...doc, ticker: String(doc.ticker || file.replace(/\.json$/i, '')).toUpperCase() };
});
const v16 = readJson(v16AuditPath);
const sessions = (v16.sessions || []).slice().sort((a,b)=>a.signalDate.localeCompare(b.signalDate));

const rows = sessions.map(session => {
  const snapshot = buildBreadthRegimeSnapshot(documents, session.signalDate);
  const baselineReturnPct = Number(session.netReturnPct);
  const controlledReturnPct = baselineReturnPct * snapshot.exposure;
  return {
    signalDate: session.signalDate,
    regime: snapshot.regime,
    supportiveScore: snapshot.supportiveScore,
    exposure: snapshot.exposure,
    featureReady: snapshot.featureReady,
    metrics: snapshot.metrics,
    baselineReturnPct: round(baselineReturnPct, 4),
    controlledReturnPct: round(controlledReturnPct, 4)
  };
});

const baseline = metrics(rows.map(row=>row.baselineReturnPct));
const controlled = metrics(rows.map(row=>row.controlledReturnPct));
const regimeCounts = rows.reduce((acc,row)=>{acc[row.regime]=(acc[row.regime]||0)+1; return acc;},{});
const reducedExposureSessions = rows.filter(row=>row.exposure<1).length;
const drawdownRelativeImprovement = Math.abs(baseline.maximumDrawdownPct) > 0
  ? (Math.abs(baseline.maximumDrawdownPct) - Math.abs(controlled.maximumDrawdownPct)) / Math.abs(baseline.maximumDrawdownPct)
  : 0;
const compoundedRetention = baseline.compoundedNetReturnPct > 0
  ? controlled.compoundedNetReturnPct / baseline.compoundedNetReturnPct
  : controlled.compoundedNetReturnPct >= baseline.compoundedNetReturnPct ? 1 : 0;

const folds = [];
for (let i=0;i<3;i++) {
  const start = Math.floor(i * rows.length / 3);
  const end = i === 2 ? rows.length : Math.floor((i + 1) * rows.length / 3);
  folds.push({ fold:i+1, ...foldReport(rows.slice(start,end)) });
}

const checks = {
  evaluableSessionsAtLeast30: rows.length >= 30,
  reducedExposureSessionsAtLeast5: reducedExposureSessions >= 5,
  averageReturnNotLowerByMoreThan015pp: controlled.averageNetReturnPct >= baseline.averageNetReturnPct - 0.15,
  profitFactorAtLeastBaseline: controlled.profitFactor >= baseline.profitFactor,
  drawdownImprovesAtLeast20PctRelative: drawdownRelativeImprovement >= 0.20,
  worstSessionImprovesAtLeast1pp: controlled.worstSessionPct - baseline.worstSessionPct >= 1.0,
  compoundedReturnRetentionAtLeast80Pct: compoundedRetention >= 0.80,
  positiveDirectionAtLeast2Of3Folds: folds.filter(fold=>fold.passesDirection).length >= 2
};
const passesInternalResearchGate = Object.values(checks).every(Boolean);

const report = {
  schemaVersion: 'raw-breadth-regime-exposure-v1-audit',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'POSTHOC_RESEARCH_PROGRAM_RETROSPECTIVE_POINT_IN_TIME',
  lineage: {
    independentGeneration: true,
    readsV16ForRegimeGeneration: false,
    readsLegacyScoresForRegimeGeneration: false,
    sourceInputs: 'data/history adjusted close through signal date only',
    v16Use: 'outcome evaluation only after regime/exposure is determined'
  },
  governance: {
    policyFrozenBeforeFirstOutcomeAudit: true,
    historicalWindowAlreadyObservedByResearchProgram: true,
    finalHoldoutStatus: 'NOT_UNTOUCHED_DO_NOT_PROMOTE_FROM_THIS_AUDIT',
    allowedDecision: 'REJECT_OR_FRESH_FORWARD_SHADOW_CANDIDATE_ONLY'
  },
  frozenPolicy: {
    minimumHistory: 60,
    minimumFeatureReadyUniverse: 60,
    supportiveConditions: ['breadth20>=55','breadth50>=50','positive20>=55','medianReturn20>=0'],
    exposure: { score0or1:0, score2:0.5, score3or4:1, unknown:0.5 },
    outcomeInputs: false
  },
  universe: { documents: documents.length },
  regimeCounts,
  reducedExposureSessions,
  baseline,
  controlled,
  deltas: {
    averageNetReturnPct: round(controlled.averageNetReturnPct - baseline.averageNetReturnPct, 4),
    profitFactor: round(controlled.profitFactor - baseline.profitFactor, 3),
    maximumDrawdownPct: round(controlled.maximumDrawdownPct - baseline.maximumDrawdownPct, 3),
    drawdownRelativeImprovementPct: round(drawdownRelativeImprovement * 100, 2),
    worstSessionPct: round(controlled.worstSessionPct - baseline.worstSessionPct, 3),
    compoundedReturnRetentionPct: round(compoundedRetention * 100, 2)
  },
  folds,
  internalResearchChecks: checks,
  passesInternalResearchGate,
  disposition: passesInternalResearchGate ? 'CANDIDATE_FOR_FRESH_FORWARD_SHADOW_ONLY' : 'REJECT_EXPOSURE_POLICY_V1_NO_RETUNING',
  promotion: {
    eligible: false,
    reason: passesInternalResearchGate
      ? 'Retrospective internal gate passed, but the historical period is already observed. Fresh point-in-time forward shadow is required.'
      : 'Frozen retrospective gate failed. Do not retune V1 thresholds or exposure mapping on this observed sample.'
  },
  sessions: rows
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, sessions: undefined }, null, 2));