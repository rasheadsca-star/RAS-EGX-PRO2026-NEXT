import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const snapshotPath = path.join(ROOT, 'tfe-v20/evidence/meta/current-meta-snapshot.json');
if (!fs.existsSync(snapshotPath)) throw new Error('META_SNAPSHOT_MISSING');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const rows = snapshot.evaluated ?? [];

const blockerCounts = new Map();
const targetProvenance = new Map();
const rrs = [];
for (const row of rows) {
  for (const block of row.meta?.blocks ?? []) blockerCounts.set(block, (blockerCounts.get(block) ?? 0) + 1);
  const rr = Number(row.tfeContext?.tradePlan?.structuralNetRR);
  if (Number.isFinite(rr)) rrs.push(rr);
  for (const p of row.tfeContext?.target2Provenance ?? []) targetProvenance.set(p.name, (targetProvenance.get(p.name) ?? 0) + 1);
}

const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, pct: rows.length ? Number((count / rows.length * 100).toFixed(1)) : null }));
const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const blockers = sorted(blockerCounts);
const systemic = blockers.filter((x) => x.pct >= 75).map((x) => ({ severity: 'HIGH', finding: `SYSTEMIC_GATE_${x.name}`, affectedPct: x.pct }));
const sma20Targets = rows.filter((x) => (x.tfeContext?.target2Provenance ?? []).some((p) => p.name === 'SMA20_SUPPORT'));
const onlyStructuralBlock = rows.filter((x) => {
  const b = x.meta?.blocks ?? [];
  return b.length === 1 && b[0] === 'STRUCTURAL_RR_LOW';
});
const almostPass = rows.filter((x) => {
  const b = new Set(x.meta?.blocks ?? []);
  return [...b].every((v) => ['STRUCTURAL_RR_LOW', 'INSUFFICIENT_INDEPENDENT_EXPERTS', 'EXPERT_EVIDENCE_TOO_WEAK'].includes(v));
});

const review = {
  schemaVersion: 'egx-meta-destructive-review-v1',
  generatedAt: new Date().toISOString(),
  reviewedSnapshotGeneratedAt: snapshot.generatedAt,
  marketSession: snapshot.marketSession,
  status: 'REJECT_FOR_PROMOTION',
  zeroCriticalHighFindings: false,
  counts: {
    evaluated: rows.length,
    actionable: rows.filter((x) => ['BUY', 'READY'].includes(x.meta?.decision)).length,
    noTrade: rows.filter((x) => x.meta?.decision === 'NO_TRADE').length,
    onlyStructuralBlock: onlyStructuralBlock.length,
    almostPass: almostPass.length,
    sma20SyntheticTarget2: sma20Targets.length,
  },
  structuralRR: {
    available: rrs.length,
    below070: rrs.filter((x) => x < 0.70).length,
    min: rrs.length ? Math.min(...rrs) : null,
    median: median(rrs),
    max: rrs.length ? Math.max(...rrs) : null,
  },
  blockerHistogram: blockers,
  target2ProvenanceHistogram: sorted(targetProvenance),
  systemicFindings: [
    ...systemic,
    ...(sma20Targets.length ? [{
      severity: 'HIGH',
      finding: 'SYNTHETIC_SMA20_RESISTANCE_CAN_BECOME_STRUCTURAL_TARGET2',
      affectedTickers: sma20Targets.map((x) => x.ticker),
      rationale: 'SMA20_SUPPORT creates a synthetic resistance for scoring geometry; current plan builder does not exclude it from structural resistance selection.',
    }] : []),
  ],
  closestCandidates: almostPass.map((x) => ({
    ticker: x.ticker,
    edgeScore: x.meta?.edgeScore,
    confidence: x.meta?.confidence,
    blocks: x.meta?.blocks,
    rr: x.tfeContext?.tradePlan?.structuralNetRR ?? null,
    target2: x.tfeContext?.tradePlan?.target2 ?? null,
    target2Provenance: (x.tfeContext?.target2Provenance ?? []).map((p) => p.name),
    tfeReasons: x.tfeContext?.reasonCodes ?? [],
  })),
  criticDecision: {
    thresholdRelaxationAllowed: false,
    productionPromotionAllowed: false,
    nextRequiredTest: 'PLAN_CONSTRUCTION_ABLATION_WITH_POINT_IN_TIME_BACKTEST',
  },
};

const outPath = path.join(ROOT, 'tfe-v20/evidence/meta/current-meta-review.json');
fs.writeFileSync(outPath, JSON.stringify(review, null, 2) + '\n');
console.log(JSON.stringify(review, null, 2));
