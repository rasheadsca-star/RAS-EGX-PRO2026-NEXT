import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V17_PARALLEL_VALIDATION,
  freezeV17ParallelCohort,
  evaluateParallelCohort,
  betaPosteriorProbabilityAboveHalf,
  evaluateV17SequentialEvidence,
} from '../src/v17ParallelSequentialValidation.js';

function frozenSnapshot() {
  return {
    schemaVersion: 'egx.fresh-forward-ledger.snapshot.2',
    status: 'FROZEN_PRE_OUTCOME_FORWARD_EVIDENCE',
    researchOnly: true,
    immutable: true,
    capturedBeforeNextSessionOpen: true,
    signalSessionDate: '2026-08-30',
    nextSessionOpenAt: '2026-08-31T07:00:00.000Z',
    marketCalendar: { nextTradingSessionDate: '2026-08-31', nextSessionOpenAt: '2026-08-31T07:00:00.000Z' },
    snapshotHash: '89a9e2ae85a94b6a18ffeb08daff691577db452dd10abd2b7de9e352a188573e',
    sourceBundleHash: 'f27090d3c46c26e04d7068c1f3399f48ac09b19b8ca99619aaebeb67625a3e88',
    v16Signals: [
      { ticker: 'AAA', rank: 1, category: 'PRIMARY_1', entryLow: 100, entryHigh: 102, stopLoss: 80, target1: 110, score: 71, currentSessionEligible: true },
      { ticker: 'BBB', rank: 2, category: 'PRIMARY_2', entryLow: 50, entryHigh: 51, stopLoss: 45, target1: 56, score: 70, currentSessionEligible: true },
      { ticker: 'CCC', rank: 3, category: 'CONDITIONAL', entryLow: 20, entryHigh: 21, stopLoss: 18, target1: 24, score: 69, currentSessionEligible: true },
      { ticker: 'DDD', rank: 4, category: 'RESERVE_1', entryLow: 30, entryHigh: 31, stopLoss: 27, target1: 35, score: 68, currentSessionEligible: true },
      { ticker: 'EEE', rank: 5, category: 'RESERVE_2', entryLow: 40, entryHigh: 41, stopLoss: 36, target1: 46, score: 67, currentSessionEligible: true },
    ],
  };
}

function threeBars(first, second, third) {
  return [
    { sessionDate: '2026-08-31', ...first },
    { sessionDate: '2026-09-01', ...second },
    { sessionDate: '2026-09-02', ...third },
  ];
}

test('parallel contract is research-only and hard-capped', () => {
  assert.equal(V17_PARALLEL_VALIDATION.productionAuthority, false);
  assert.equal(V17_PARALLEL_VALIDATION.automaticOrders, false);
  assert.equal(V17_PARALLEL_VALIDATION.automaticPromotion, false);
  assert.equal(V17_PARALLEL_VALIDATION.sequential.hardMaxCohorts, 40);
  assert.equal(V17_PARALLEL_VALIDATION.sequential.formalSuperiorityProbability, 0.99);
});

test('freeze builds all four arms from one immutable snapshot', () => {
  const cohort = freezeV17ParallelCohort(frozenSnapshot());
  assert.equal(cohort.status, 'FROZEN_PRE_OUTCOME_PARALLEL_COHORT');
  assert.deepEqual(cohort.arms.V16_CONTROL.candidateTickers, ['AAA', 'BBB']);
  assert.deepEqual(cohort.arms.V17_B.candidateTickers, ['AAA', 'BBB']);
  assert.deepEqual(cohort.arms.V17_A.candidateTickers, ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
  assert.deepEqual(cohort.arms.V17_C.candidateTickers, ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
  assert.match(cohort.cohortHash, /^[a-f0-9]{64}$/);
});

test('control allows same-session gap recovery while V17 vetoes it', () => {
  const cohort = freezeV17ParallelCohort(frozenSnapshot());
  const barsByTicker = {
    AAA: threeBars(
      { open: 90, high: 101, low: 89, close: 100 },
      { open: 101, high: 106, low: 99, close: 105 },
      { open: 105, high: 111, low: 104, close: 110 },
    ),
    BBB: threeBars(
      { open: 60, high: 61, low: 59, close: 60 },
      { open: 60, high: 61, low: 59, close: 60 },
      { open: 60, high: 61, low: 59, close: 60 },
    ),
    CCC: threeBars(
      { open: 20.5, high: 22, low: 20, close: 21.5 },
      { open: 21.5, high: 23, low: 21, close: 22.5 },
      { open: 22.5, high: 24.5, low: 22, close: 24 },
    ),
    DDD: threeBars(
      { open: 30.5, high: 32, low: 30, close: 31.5 },
      { open: 31.5, high: 33, low: 31, close: 32.5 },
      { open: 32.5, high: 35.5, low: 32, close: 35 },
    ),
    EEE: threeBars(
      { open: 40.5, high: 42, low: 40, close: 41.5 },
      { open: 41.5, high: 43, low: 41, close: 42.5 },
      { open: 42.5, high: 46.5, low: 42, close: 46 },
    ),
  };
  const result = evaluateParallelCohort({ cohort, barsByTicker });
  const controlAAA = result.arms.V16_CONTROL.members.find((m) => m.ticker === 'AAA');
  const v17AAA = result.arms.V17_A.members.find((m) => m.ticker === 'AAA');
  assert.equal(controlAAA.entered, true);
  assert.equal(v17AAA.status, 'VETOED');
  assert.equal(v17AAA.entered, false);
});

test('V17 A substitutes while B does not and C consumes only one slot', () => {
  const cohort = freezeV17ParallelCohort(frozenSnapshot());
  const barsByTicker = {
    AAA: threeBars(
      { open: 90, high: 95, low: 89, close: 94 },
      { open: 94, high: 95, low: 92, close: 93 },
      { open: 93, high: 94, low: 91, close: 92 },
    ),
    BBB: threeBars(
      { open: 60, high: 61, low: 59, close: 60 },
      { open: 60, high: 61, low: 59, close: 60 },
      { open: 60, high: 61, low: 59, close: 60 },
    ),
    CCC: threeBars(
      { open: 20.5, high: 22, low: 20, close: 21.5 },
      { open: 21.5, high: 23, low: 21, close: 22.5 },
      { open: 22.5, high: 24.5, low: 22, close: 24 },
    ),
    DDD: threeBars(
      { open: 30.5, high: 32, low: 30, close: 31.5 },
      { open: 31.5, high: 33, low: 31, close: 32.5 },
      { open: 32.5, high: 35.5, low: 32, close: 35 },
    ),
    EEE: threeBars(
      { open: 40.5, high: 42, low: 40, close: 41.5 },
      { open: 41.5, high: 43, low: 41, close: 42.5 },
      { open: 42.5, high: 46.5, low: 42, close: 46 },
    ),
  };
  const result = evaluateParallelCohort({ cohort, barsByTicker });
  assert.equal(result.arms.V17_A.entered, 2);
  assert.deepEqual(result.arms.V17_A.members.filter((m) => m.entered).map((m) => m.ticker), ['CCC', 'DDD']);
  assert.equal(result.arms.V17_B.entered, 0);
  assert.equal(result.arms.V17_C.entered, 1);
  assert.deepEqual(result.arms.V17_C.members.filter((m) => m.entered).map((m) => m.ticker), ['CCC']);
});

test('Beta posterior gives neutral prior and strong probability after five straight paired wins', () => {
  assert.equal(betaPosteriorProbabilityAboveHalf(0, 0), 0.5);
  assert.ok(betaPosteriorProbabilityAboveHalf(5, 0) > 0.975);
  assert.ok(betaPosteriorProbabilityAboveHalf(0, 5) < 0.025);
});

function syntheticResult(i, controlReturn, challengerReturn, stopControl = 0, stopArm = 0) {
  const arm = (id, r, stops) => ({
    armId: id,
    complete: true,
    portfolioNetReturnPct: r,
    entered: 1,
    stops,
    targets: r > 0 ? 1 : 0,
  });
  return {
    schemaVersion: 'egx.v17-parallel-cohort-result.1',
    cohortHash: `cohort-${i}`,
    signalSessionDate: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    arms: {
      V16_CONTROL: arm('V16_CONTROL', controlReturn, stopControl),
      V17_A: arm('V17_A', challengerReturn, stopArm),
      V17_B: arm('V17_B', challengerReturn, stopArm),
      V17_C: arm('V17_C', challengerReturn, stopArm),
    },
  };
}

test('twenty clean paired wins can pass the formal research gate without production authority', () => {
  const results = Array.from({ length: 20 }, (_, i) => syntheticResult(i, 0, 1));
  const evidence = evaluateV17SequentialEvidence(results);
  assert.equal(evidence.challengers.V17_A.status, 'FORMAL_RESEARCH_CHALLENGER_PASS');
  assert.ok(evidence.challengers.V17_A.posteriorProbabilityBetterThanControl >= 0.99);
  assert.equal(evidence.productionAuthority, false);
  assert.equal(evidence.automaticPromotion, false);
});

test('hard maximum converts persistent no-edge evidence into terminal no-material-edge status', () => {
  const results = Array.from({ length: 40 }, (_, i) => syntheticResult(i, 0.5, 0.5));
  const evidence = evaluateV17SequentialEvidence(results);
  assert.equal(evidence.challengers.V17_A.status, 'NO_MATERIAL_EDGE_UNDER_FROZEN_CONTRACT');
  assert.equal(evidence.challengers.V17_A.completedPairedCohorts, 40);
});
