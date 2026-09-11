import fs from 'node:fs';
import path from 'node:path';
import { evaluateV17SequentialEvidence } from '../src/v17ParallelSequentialValidation.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const resultDir = path.join(root, 'parallel-validation', 'results');
const reportDir = path.join(root, 'reports');
fs.mkdirSync(resultDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const files = fs.readdirSync(resultDir).filter((x) => x.endsWith('.json')).sort();
const results = [];
const seen = new Set();
for (const file of files) {
  const full = path.join(resultDir, file);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (parsed.schemaVersion !== 'egx.v17-parallel-cohort-result.1') throw new Error(`INVALID_RESULT_SCHEMA:${file}`);
  if (!parsed.cohortHash) throw new Error(`RESULT_COHORT_HASH_MISSING:${file}`);
  if (seen.has(parsed.cohortHash)) throw new Error(`DUPLICATE_COHORT_RESULT:${parsed.cohortHash}`);
  seen.add(parsed.cohortHash);
  if (parsed.researchOnly !== true || parsed.productionAuthority !== false) throw new Error(`RESULT_AUTHORITY_INVALID:${file}`);
  results.push(parsed);
}
results.sort((a, b) => String(a.signalSessionDate || '').localeCompare(String(b.signalSessionDate || '')));
const evidence = evaluateV17SequentialEvidence(results);
const out = {
  schemaVersion: 'egx.v17-sequential-evidence-report.1',
  generatedAt: new Date().toISOString(),
  resultFiles: files,
  completedResultCount: results.length,
  evidence,
  researchOnly: true,
  productionAuthority: false,
  automaticPromotion: false,
};
fs.writeFileSync(path.join(reportDir, 'v17-sequential-evidence.json'), `${JSON.stringify(out, null, 2)}\n`);

const rows = Object.entries(evidence.challengers).map(([id, x]) => `<tr><td><b>${id}</b></td><td>${x.status}</td><td>${x.completedPairedCohorts}</td><td>${x.decisivePairs}</td><td>${(x.posteriorProbabilityBetterThanControl*100).toFixed(2)}%</td><td>${x.meanPairedDeltaPct.toFixed(4)} pp</td><td>${x.arm.stopRatePct.toFixed(2)}%</td><td>${x.control.stopRatePct.toFixed(2)}%</td></tr>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V17 Sequential Evidence</title><style>body{font-family:Arial,sans-serif;background:#0b1220;color:#e8eefc;margin:0;padding:24px}.wrap{max-width:1180px;margin:auto}.badge{display:inline-block;padding:7px 10px;border-radius:999px;background:#25334f;font-weight:700}.card{background:#121b2f;border:1px solid #283856;border-radius:16px;padding:20px;margin:16px 0}table{width:100%;border-collapse:collapse;min-width:900px}th,td{padding:12px;border-bottom:1px solid #27344e;text-align:left}.scroll{overflow-x:auto}.muted{color:#9fb0cb}.warn{color:#ffd166}</style></head><body><div class="wrap"><span class="badge">RESEARCH / SHADOW ONLY</span><h1>V17 Sequential Evidence</h1><p class="muted">Append-only paired forward evidence. No automatic promotion or production authority.</p><div class="card"><h2>Current state</h2><p>Completed cohort result files: <b>${results.length}</b> / hard cap <b>${evidence.hardMaxCohorts}</b>.</p><div class="scroll"><table><tr><th>Arm</th><th>Status</th><th>Paired cohorts</th><th>Decisive</th><th>P(better)</th><th>Mean delta</th><th>Arm stop rate</th><th>Control stop rate</th></tr>${rows}</table></div><p class="warn">A research pass never authorizes live orders or production promotion.</p></div></div></body></html>`;
fs.writeFileSync(path.join(reportDir, 'v17-sequential-evidence-dashboard.html'), html);
console.log(JSON.stringify({ completedResultCount: results.length, challengers: Object.fromEntries(Object.entries(evidence.challengers).map(([id, x]) => [id, { status: x.status, pBetter: x.posteriorProbabilityBetterThanControl, paired: x.completedPairedCohorts, decisive: x.decisivePairs }])) }, null, 2));
