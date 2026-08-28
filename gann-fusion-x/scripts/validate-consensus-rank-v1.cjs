#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const input = path.join(ROOT, 'gann-fusion-x/data/consensus-rank-v1-backtest.json');
const outJson = path.join(ROOT, 'gann-fusion-x/data/consensus-rank-v1-evidence.json');
const outMd = path.join(ROOT, 'gann-fusion-x/data/consensus-rank-v1-evidence.md');

const r = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(r.dates) || r.dates.length !== 60) {
  throw new Error(`EXPECTED_EXACTLY_60_EVALUATION_SESSIONS_GOT_${r.dates?.length}`);
}

const full = r.summary60?.CONSENSUS_FINAL;
const first = r.summaryFirst30?.final;
const last = r.summaryLast30?.final;
if (!full || !first || !last) throw new Error('CONSENSUS_RANK_V1_REQUIRED_SUMMARY_MISSING');

// Locked before this challenger run. Source: accepted research baseline V16 Quality Gate V2 evidence.
const baseline = {
  version: 'V16 Quality Gate V2 Consensus Final',
  full60: { profitFactor: 2.07, compoundedBasketPct: 41.911, maxDrawdownPct: -10.356 },
  first30: { profitFactor: 1.09, compoundedBasketPct: -0.77, maxDrawdownPct: -4.904 },
  last30: { profitFactor: 2.42, compoundedBasketPct: 43.013, maxDrawdownPct: -10.356 }
};

const acceptance = {
  pfImprovedVsV2: Number(full.profitFactor) > baseline.full60.profitFactor,
  maxDrawdownImprovedVsV2: Number(full.maxDrawdownPct) > baseline.full60.maxDrawdownPct,
  full60CompoundPositive: Number(full.compoundedBasketPct) > 0,
  first30PfImprovedVsV2: Number(first.profitFactor) > baseline.first30.profitFactor,
  first30CompoundNonNegative: Number(first.compoundedBasketPct) >= 0,
  first30DrawdownNotWorseVsV2: Number(first.maxDrawdownPct) >= baseline.first30.maxDrawdownPct,
  last30StillProfitable: Number(last.profitFactor) >= 1.25 && Number(last.compoundedBasketPct) > 0
};
acceptance.passed = Object.values(acceptance).every(Boolean);

const evidence = {
  schemaVersion: 'egx-consensus-rank-v1-evidence',
  generatedAt: new Date().toISOString(),
  rulesLockedBeforeResult: true,
  noFixedStockCount: true,
  rankFormula: 'consensusQualityScore = sqrt(V16 same-session percentile × SEPA same-session percentile)',
  sizingFormula: 'consensusQualityWeight = consensusQualityScore / 100; final size = quality weight × existing Regime multiplier',
  gannRoleUnchanged: 'GANN remains timing-only after intersection; it cannot add a stock.',
  baseline,
  challenger: {
    full60: full,
    first30: first,
    last30: last,
    commonLive: r.commonLive || null
  },
  acceptance
};

const f = n => Number.isFinite(Number(n)) ? Number(n).toFixed(3) : 'n/a';
const md = [
  '# Consensus Rank V1 — Locked Evidence',
  '',
  `Generated: ${evidence.generatedAt}`,
  '',
  `Acceptance: **${acceptance.passed ? 'PASS' : 'FAIL'}**`,
  '',
  'No Top-N is used. Every V16 Quality V2 qualified stock and every SEPA-qualified stock may participate; only their intersection reaches GANN.',
  '',
  'Rank formula: `sqrt(V16 percentile × SEPA percentile)`. The score is used only as a continuous capital weight; GANN remains the timing sequencer and Regime remains the protection layer.',
  '',
  '## Locked comparison',
  '',
  '| Window | Metric | V2 baseline | Rank V1 |',
  '|---|---|---:|---:|',
  `| 60 | PF | ${f(baseline.full60.profitFactor)} | ${f(full.profitFactor)} |`,
  `| 60 | Compound % | ${f(baseline.full60.compoundedBasketPct)} | ${f(full.compoundedBasketPct)} |`,
  `| 60 | Max DD % | ${f(baseline.full60.maxDrawdownPct)} | ${f(full.maxDrawdownPct)} |`,
  `| First 30 | PF | ${f(baseline.first30.profitFactor)} | ${f(first.profitFactor)} |`,
  `| First 30 | Compound % | ${f(baseline.first30.compoundedBasketPct)} | ${f(first.compoundedBasketPct)} |`,
  `| First 30 | Max DD % | ${f(baseline.first30.maxDrawdownPct)} | ${f(first.maxDrawdownPct)} |`,
  `| Last 30 | PF | ${f(baseline.last30.profitFactor)} | ${f(last.profitFactor)} |`,
  `| Last 30 | Compound % | ${f(baseline.last30.compoundedBasketPct)} | ${f(last.compoundedBasketPct)} |`,
  `| Last 30 | Max DD % | ${f(baseline.last30.maxDrawdownPct)} | ${f(last.maxDrawdownPct)} |`,
  '',
  '## Acceptance',
  ...Object.entries(acceptance).map(([k,v]) => `- ${k}: **${v}**`),
  '',
  'This is research evidence, not a guarantee of future returns. No production engine or UI is changed by this run.',
  ''
].join('\n');

fs.writeFileSync(outJson, JSON.stringify(evidence, null, 2) + '\n');
fs.writeFileSync(outMd, md);
console.log(JSON.stringify({acceptance, full60: full, first30: first, last30: last}, null, 2));
