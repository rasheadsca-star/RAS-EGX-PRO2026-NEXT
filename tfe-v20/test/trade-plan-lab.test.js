import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backtestHistory } from '../src/backtest.js';
import { backtestPlanVariant, buildResistanceLadderPlan, PLAN_LAB_GOVERNANCE } from '../src/trade-plan-lab.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

test('baseline plan-lab backtest preserves canonical TFE backtest metrics', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/history/FAIT.json'), 'utf8'));
  const canonical = backtestHistory({ ticker: 'FAIT', rows: doc.sessions });
  const lab = backtestPlanVariant({ ticker: 'FAIT', rows: doc.sessions, variant: 'BASELINE_CURRENT' });
  for (const key of ['entered','target1Pct','stopPct','positivePct','avgNetPct','profitFactor','wilson95LowerTarget1Pct']) {
    assert.deepEqual(lab.summary[key], canonical.summary[key], `metric mismatch: ${key}`);
  }
  assert.deepEqual(
    lab.trades.map((x) => [x.signalDate,x.entryDate,x.exitDate,x.outcome,x.netPct]),
    canonical.trades.map((x) => [x.signalDate,x.entryDate,x.exitDate,x.outcome,x.netPct]),
  );
});

test('resistance ladder chooses second distinct true cluster without looking at RR threshold', () => {
  const base = {
    tradePlan: { entryLow:100, entryHigh:101, stop:96, target1:102, target2:102, structuralNetRR:0.1, precisionNetRR:0.1, alignmentState:'IN_ENTRY_RANGE' },
    supportResistance: {
      methods: [
        { name:'CLASSIC_PIVOT', resistance:102, weight:.9 },
        { name:'DONCHIAN_20', resistance:108, weight:1 },
      ],
    },
  };
  const plan = buildResistanceLadderPlan(base);
  assert.equal(plan.firstObstacle.center, 102);
  assert.equal(plan.target2, 108);
  assert.equal(plan.targetCluster.center, 108);
  assert.equal(PLAN_LAB_GOVERNANCE.ladderRuleConditionedOnRrThreshold, false);
});

test('synthetic SMA20 and ATR resistance cannot become ladder targets', () => {
  const base = {
    tradePlan: { entryLow:100, entryHigh:101, stop:96, target1:102, target2:102, structuralNetRR:0.1, precisionNetRR:0.1, alignmentState:'IN_ENTRY_RANGE' },
    supportResistance: {
      methods: [
        { name:'SMA20_SUPPORT', resistance:102, weight:.55 },
        { name:'ATR_REFERENCE', resistance:103, weight:.45 },
        { name:'CLASSIC_PIVOT', resistance:104, weight:.9 },
        { name:'CONFIRMED_SWING_CLUSTER', resistance:110, weight:1.2 },
      ],
    },
  };
  const plan = buildResistanceLadderPlan(base);
  assert.equal(plan.firstObstacle.center, 104);
  assert.equal(plan.target2, 110);
  assert.ok(!plan.resistanceClusters.flatMap((x) => x.methods).includes('SMA20_SUPPORT'));
  assert.ok(!plan.resistanceClusters.flatMap((x) => x.methods).includes('ATR_REFERENCE'));
});
