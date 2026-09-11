import fs from 'node:fs';
import path from 'node:path';
import { freezeV17ParallelCohort, V17_PARALLEL_VALIDATION } from '../src/v17ParallelSequentialValidation.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const snapshotsDir = path.join(root, 'forward-ledger', 'snapshots');
const reportDir = path.join(root, 'reports');
const expectedDate = process.env.EXPECTED_SIGNAL_DATE || null;
const explicitPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

function selectSnapshot() {
  if (explicitPath) return explicitPath;
  const files = fs.readdirSync(snapshotsDir)
    .filter((x) => /^\d{4}-\d{2}-\d{2}-[a-f0-9]+\.json$/.test(x))
    .sort();
  if (!files.length) throw new Error('NO_FORWARD_SNAPSHOTS');
  if (expectedDate) {
    const match = files.filter((x) => x.startsWith(`${expectedDate}-`)).at(-1);
    if (!match) throw new Error(`EXPECTED_SNAPSHOT_NOT_FOUND:${expectedDate}`);
    return path.join(snapshotsDir, match);
  }
  return path.join(snapshotsDir, files.at(-1));
}

const snapshotPath = selectSnapshot();
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
if (expectedDate && snapshot.signalSessionDate !== expectedDate) throw new Error(`SIGNAL_DATE_MISMATCH:${snapshot.signalSessionDate}`);
const cohort = freezeV17ParallelCohort(snapshot);

fs.mkdirSync(reportDir, { recursive: true });
const report = {
  schemaVersion: 'egx.v17-parallel-freeze-report.1',
  generatedAt: new Date().toISOString(),
  sourceSnapshotFile: path.relative(root, snapshotPath).replaceAll('\\', '/'),
  cohort,
  contract: V17_PARALLEL_VALIDATION,
  researchOnly: true,
  productionAuthority: false,
};
fs.writeFileSync(path.join(reportDir, 'v17-parallel-cohort.json'), `${JSON.stringify(report, null, 2)}\n`);

const armRows = Object.values(cohort.arms).map((arm) => `
<tr><td><b>${arm.policy.id}</b></td><td>${arm.policy.label}</td><td>${arm.policy.maxPositions}</td><td>${arm.policy.gapDownPolicy}</td><td>${arm.policy.substitution ? 'YES' : 'NO'}</td><td>${arm.candidateTickers.join(', ')}</td></tr>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V17 Parallel Sequential Validation</title><style>body{font-family:Arial,sans-serif;background:#0b1220;color:#e8eefc;margin:0;padding:24px}.wrap{max-width:1180px;margin:auto}.badge{display:inline-block;padding:7px 10px;border-radius:999px;background:#25334f;font-weight:700}.card{background:#121b2f;border:1px solid #283856;border-radius:16px;padding:20px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.kpi{background:#0e1728;border-radius:12px;padding:16px}.kpi b{display:block;font-size:22px;margin-top:6px}table{width:100%;border-collapse:collapse;min-width:900px}th,td{padding:12px;border-bottom:1px solid #27344e;text-align:left}.scroll{overflow-x:auto}.good{color:#7ee787}.warn{color:#ffd166}.muted{color:#9fb0cb}.hash{font-family:monospace;word-break:break-all;font-size:12px}</style></head><body><div class="wrap"><span class="badge">RESEARCH / SHADOW ONLY</span><h1>V17 Parallel Sequential Validation</h1><p class="muted">Frozen before the first 31-Aug-2026 outcome. One control and three challengers accumulate the same future evidence in parallel.</p><div class="grid"><div class="kpi">Signal cohort<b>${cohort.signalSessionDate}</b></div><div class="kpi">First outcome session<b>${cohort.nextTradingSessionDate}</b></div><div class="kpi">Parallel challengers<b>3</b></div><div class="kpi">Hard evidence cap<b>40 cohorts</b></div></div><div class="card"><h2>Frozen arms</h2><div class="scroll"><table><tr><th>Arm</th><th>Definition</th><th>Max positions</th><th>Gap-down rule</th><th>Substitution</th><th>Frozen candidates</th></tr>${armRows}</table></div></div><div class="card"><h2>Sequential stopping rules</h2><p>Early decisions start only after <b>${V17_PARALLEL_VALIDATION.sequential.minEarlyCohorts}</b> completed paired cohorts and <b>${V17_PARALLEL_VALIDATION.sequential.minEarlyDecisivePairs}</b> decisive pairs.</p><p>Early positive probability: <b>${(V17_PARALLEL_VALIDATION.sequential.earlyPositiveProbability*100).toFixed(1)}%</b>. Early futility: <b>${(V17_PARALLEL_VALIDATION.sequential.earlyFutilityProbability*100).toFixed(0)}%</b>. Formal research challenger: <b>${(V17_PARALLEL_VALIDATION.sequential.formalSuperiorityProbability*100).toFixed(0)}%</b> plus return/drawdown/stop-rate gates.</p><p class="warn">No arm receives production authority even if a research gate passes.</p></div><div class="card"><h2>Evidence anchors</h2><p><b>Source snapshot SHA-256</b></p><p class="hash">${cohort.sourceSnapshotHash}</p><p><b>Parallel cohort SHA-256</b></p><p class="hash">${cohort.cohortHash}</p><p><b>Contract SHA-256</b></p><p class="hash">${cohort.contractHash}</p><p class="good"><b>FROZEN_PRE_OUTCOME_PARALLEL_COHORT</b></p></div></div></body></html>`;
fs.writeFileSync(path.join(reportDir, 'v17-parallel-dashboard.html'), html);
console.log(JSON.stringify({ signalSessionDate: cohort.signalSessionDate, nextTradingSessionDate: cohort.nextTradingSessionDate, cohortHash: cohort.cohortHash, contractHash: cohort.contractHash, arms: Object.fromEntries(Object.entries(cohort.arms).map(([id, x]) => [id, x.candidateTickers])) }, null, 2));
