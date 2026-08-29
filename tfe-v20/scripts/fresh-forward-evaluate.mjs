import fs from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateFreshForwardSignal,
  sha256,
  summarizeFreshForward,
  verifyFreshForwardSnapshot,
} from '../sidecars/fresh-forward-ledger.js';
import { analyzeFreshForwardSourceQuality } from '../sidecars/fresh-forward-quality.js';

const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error('USAGE: node scripts/fresh-forward-evaluate.mjs <snapshot.json> [baseUrl]');
const base = (process.argv[3] || process.env.TFE_BASE_URL || 'https://egx-tfe-v20-fusion-rc2.vercel.app').replace(/\/$/, '');
const snapshotText = await fs.readFile(path.resolve(snapshotPath), 'utf8');
const snapshot = JSON.parse(snapshotText);
const integrity = verifyFreshForwardSnapshot(snapshot);
if (!integrity.ok) throw new Error(`INVALID_FRESH_FORWARD_SNAPSHOT:${integrity.errors.join(',')}`);
const sourceQuality = analyzeFreshForwardSourceQuality(snapshot);
if (sourceQuality.lookaheadDetected) throw new Error(`FORWARD_SOURCE_LOOKAHEAD:${sourceQuality.futureSources.join(',')}`);

async function history(ticker) {
  const response = await fetch(`${base}/api/index?route=history&ticker=${encodeURIComponent(ticker)}&limit=500`, {
    cache: 'no-store', headers: { 'user-agent': 'EGX-FRESH-FORWARD-EVALUATOR' },
  });
  if (!response.ok) throw new Error(`HISTORY_HTTP_${response.status}:${ticker}`);
  const text = await response.text();
  return { payload: JSON.parse(text), digestSha256: sha256(text) };
}

const results = [];
const historyProofs = {};
for (const signal of snapshot.v16Signals ?? []) {
  const h = await history(signal.ticker);
  historyProofs[signal.ticker] = h.digestSha256;
  results.push(evaluateFreshForwardSignal({ ...signal, sessionDate: snapshot.signalSessionDate }, h.payload?.bars ?? []));
}

const report = {
  schemaVersion: 'egx.fresh-forward-ledger.evaluation.2',
  generatedAt: new Date().toISOString(),
  sourceSnapshotHash: snapshot.snapshotHash,
  sourceCommit: snapshot.sourceCommit,
  policyHash: snapshot.policyHash,
  scoringImpact: 'NONE',
  promotionEligible: false,
  sourceQuality,
  algorithmicAttributionEligible: sourceQuality.algorithmicAttributionEligible,
  historyEndpoint: base,
  historyProofs,
  summary: summarizeFreshForward(results),
  results,
};
const out = path.resolve('reports', `fresh-forward-evaluation-${snapshot.signalSessionDate}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  output: out,
  sourceSnapshotHash: report.sourceSnapshotHash,
  sourceQuality: report.sourceQuality,
  summary: report.summary,
}, null, 2));
