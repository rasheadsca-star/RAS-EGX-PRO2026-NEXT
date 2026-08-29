import fs from 'node:fs';
import path from 'node:path';
import {
  V169_RISK_ALPHA_POLICY,
  evaluateRiskAlphaSession,
  aggregateRiskAlphaReturns,
  summarizeOutcomeMembers,
  classifyRiskAlphaMember,
} from '../src/v169RiskAlphaChallenger.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const outPath = path.join(repoRoot, 'tfe-v20/reports/v169-riskalpha-audit.json');

const ACCEPTANCE = Object.freeze({
  minimumSessions: 30,
  minimumVetoedMembers: 5,
  minimumAverageReturnImprovementPp: 0.15,
  minimumProfitFactorImprovement: 0.15,
  minimumDrawdownImprovementPp: 1.0,
  minimumStopRateReductionPp: 5.0,
  maximumTargetRateDegradationPp: 5.0,
});

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 4) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }

const audit = readJson(auditPath);
const sessions = Array.isArray(audit.sessions) ? audit.sessions : [];
if (!sessions.length) throw new Error('NO_V16_SESSIONS');

const baselineReturns = sessions.map((s) => Number(s.netReturnPct)).filter(Number.isFinite);
const challengerSessions = sessions.map(evaluateRiskAlphaSession);
const challengerReturns = challengerSessions.map((s) => s.challengerNetReturnPct).filter(Number.isFinite);
if (baselineReturns.length !== challengerReturns.length) throw new Error('SESSION_ALIGNMENT_FAILURE');

const baseline = aggregateRiskAlphaReturns(baselineReturns);
const challenger = aggregateRiskAlphaReturns(challengerReturns);

const baselineOutcome = summarizeOutcomeMembers(sessions);
const keptOutcome = summarizeOutcomeMembers(sessions, (m) => !classifyRiskAlphaMember(m).veto);
const vetoed = sessions.flatMap((s) => s.members || []).filter((m) => classifyRiskAlphaMember(m).veto);
const vetoedStops = vetoed.filter((m) => Boolean(m.stopTouched)).length;
const vetoedTargets = vetoed.filter((m) => Boolean(m.conservativeTargetHit)).length;

const deltas = {
  averageReturnImprovementPp: round((challenger.averageNetReturnPct ?? 0) - (baseline.averageNetReturnPct ?? 0), 4),
  profitFactorImprovement: round((challenger.profitFactor ?? 0) - (baseline.profitFactor ?? 0), 3),
  drawdownImprovementPp: round((challenger.maximumDrawdownPct ?? 0) - (baseline.maximumDrawdownPct ?? 0), 3),
  stopRateReductionPp: round((baselineOutcome.stopRatePct ?? 0) - (keptOutcome.stopRatePct ?? 0), 2),
  targetRateChangePp: round((keptOutcome.conservativeTargetRatePct ?? 0) - (baselineOutcome.conservativeTargetRatePct ?? 0), 2),
};

const checks = {
  enoughSessions: sessions.length >= ACCEPTANCE.minimumSessions,
  enoughVetoes: vetoed.length >= ACCEPTANCE.minimumVetoedMembers,
  averageReturnImproves: deltas.averageReturnImprovementPp >= ACCEPTANCE.minimumAverageReturnImprovementPp,
  profitFactorImproves: deltas.profitFactorImprovement >= ACCEPTANCE.minimumProfitFactorImprovement,
  drawdownImproves: deltas.drawdownImprovementPp >= ACCEPTANCE.minimumDrawdownImprovementPp,
  stopRateImproves: deltas.stopRateReductionPp >= ACCEPTANCE.minimumStopRateReductionPp,
  targetRatePreserved: deltas.targetRateChangePp >= -ACCEPTANCE.maximumTargetRateDegradationPp,
  noLookaheadByConstruction: true,
};

const allChecksPass = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 'egx.v169-riskalpha-audit.1',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'ONE_SHOT_RETROSPECTIVE_CHALLENGER_AUDIT',
  governance: {
    researchOnly: true,
    champion: 'V16.9',
    challenger: 'V16.9-RiskAlpha',
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
    promotionEligible: false,
    thresholdsFrozenBeforeAudit: true,
    retuningAfterOutcome: false,
    freshForwardLedgerChanged: false,
  },
  policy: V169_RISK_ALPHA_POLICY,
  acceptance: ACCEPTANCE,
  source: {
    sourceSchema: audit.schemaVersion,
    sessions: sessions.length,
    fromSignalDate: sessions[0]?.signalDate ?? null,
    toSignalDate: sessions.at(-1)?.signalDate ?? null,
    lastOutcomeDate: sessions.at(-1)?.outcomeDate ?? null,
  },
  baseline,
  challenger,
  deltas,
  executionOutcomes: {
    baseline: baselineOutcome,
    afterRiskAlphaGuard: keptOutcome,
    vetoedMembers: vetoed.length,
    vetoedStops,
    vetoedConservativeTargets: vetoedTargets,
  },
  checks,
  retrospectiveStatus: allChecksPass ? 'PROMISING_RETROSPECTIVE_ZERO_WEIGHT_ONLY' : 'NOT_ACCEPTED_NO_RETUNE',
  disposition: allChecksPass
    ? 'PREREGISTER_RISKALPHA_FORWARD_CHALLENGER_KEEP_V16_9_CHAMPION'
    : 'KEEP_V16_9_CHAMPION_REJECT_RISKALPHA_V0_1_NO_RETUNE',
  note: 'Even a pass is not promotion evidence. The next-open guard must be judged prospectively against frozen V16.9 signals under the same costs and outcome rules.',
  sessions: challengerSessions,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, sessions: undefined }, null, 2));
