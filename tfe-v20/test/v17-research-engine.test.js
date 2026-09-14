import test from 'node:test';
import assert from 'node:assert/strict';

import { assessV17ResearchReadiness } from '../src/v17ResearchGovernance.js';
import {
  createV17ResearchObservationState,
  observeV17ResearchBatch,
  summarizeV17ResearchObservationState,
} from '../src/v17ResearchObservationEngine.js';
import {
  createV17ResearchDecisionLedger,
  appendV17ResearchDecisionRecord,
  verifyV17ResearchDecisionLedger,
} from '../src/v17ResearchDecisionLedger.js';

function frozenSnapshot() {
  return {
    schemaVersion: 'egx.fresh-forward-ledger.snapshot.2',
    status: 'FROZEN_PRE_OUTCOME_FORWARD_EVIDENCE',
    researchOnly: true,
    immutable: true,
    capturedBeforeNextSessionOpen: true,
    capturedAt: '2026-08-30T18:33:59.318Z',
    signalSessionDate: '2026-08-30',
    snapshotHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceBundleHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    marketCalendar: {
      nextTradingSessionDate: '2026-08-31',
      nextSessionOpenAt: '2026-08-31T07:00:00.000Z',
    },
    policy: {
      entryRule: 'NEXT_SESSION_ONLY',
      entryFillRule: 'ENTRY_ZONE_TOUCH_NO_GAP_DOWN_FILL',
      maxHoldSessions: 3,
      roundTripCostPct: 0.6,
      sameBarTargetStop: 'STOP_FIRST',
      productionAuthority: false,
    },
    sources: {
      v16: { sessionDate: '2026-08-30' },
      regime: { sessionDate: '2026-08-30' },
      triple: { sessionDate: '2026-08-30' },
      v20: { sessionDate: '2026-08-16' },
      metaShadow: { sessionDate: '2026-08-30' },
    },
    v16Signals: [
      { ticker: 'MFPC', rank: 1, category: 'PRIMARY_1', score: 71.856, entryLow: 40.8541, entryHigh: 41.0459, stopLoss: 39.8948, target1: 42.3889, currentSessionEligible: true },
      { ticker: 'DAPH', rank: 2, category: 'PRIMARY_2', score: 70.548, entryLow: 140.5181, entryHigh: 142.6819, stopLoss: 129.6988, target1: 157.8289, currentSessionEligible: true },
      { ticker: 'GRCA', rank: 3, category: 'CONDITIONAL', score: 70.247, entryLow: 81.7245, entryHigh: 82.8755, stopLoss: 75.9695, target1: 90.9325, currentSessionEligible: true },
      { ticker: 'BINV', rank: 4, category: 'RESERVE_1', score: 68.905, entryLow: 52.455, entryHigh: 52.725, stopLoss: 51.105, target1: 54.615, currentSessionEligible: true },
      { ticker: 'KWIN', rank: 5, category: 'RESERVE_2', score: 67.28, entryLow: 119.81, entryHigh: 121.77, stopLoss: 110.01, target1: 135.49, currentSessionEligible: true },
    ],
  };
}

function observation(ticker, { open, high, low, last, at = '2026-08-31T07:10:00.000Z' }) {
  return { ticker, observedAt: at, sessionDate: '2026-08-31', open, high, low, last, sessionClosed: false };
}

test('V17 treats stale optional V20 as degraded evidence, not a critical blocker', () => {
  const readiness = assessV17ResearchReadiness(frozenSnapshot());
  assert.equal(readiness.ready, true);
  assert.equal(readiness.evidenceQuality, 'DEGRADED_OPTIONAL_INPUTS');
  assert.ok(readiness.warnings.includes('OPTIONAL_SOURCE_STALE:v20'));
  assert.equal(readiness.productionAuthority, false);
});

test('V17 fails closed when a critical same-session source is stale', () => {
  const snapshot = frozenSnapshot();
  snapshot.sources.triple.sessionDate = '2026-08-27';
  const readiness = assessV17ResearchReadiness(snapshot);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.includes('CRITICAL_SOURCE_STALE:triple'));
});

test('V17 records a gap-down veto from the frozen next-open rule', () => {
  const state = createV17ResearchObservationState({ snapshot: frozenSnapshot() });
  const next = observeV17ResearchBatch({
    state,
    observations: [observation('MFPC', { open: 40.0, high: 40.8, low: 39.95, last: 40.5 })],
  });
  const mfpc = next.researchDecisions.find((x) => x.ticker === 'MFPC');
  assert.equal(mfpc.label, 'OBSERVE_GAP_VETO');
  assert.equal(mfpc.productionAuthority, false);
});

test('V17 labels an opening above the entry zone without retrace as no-chase observation', () => {
  const state = createV17ResearchObservationState({ snapshot: frozenSnapshot() });
  const next = observeV17ResearchBatch({
    state,
    observations: [observation('MFPC', { open: 42.0, high: 42.2, low: 41.5, last: 42.0 })],
  });
  const mfpc = next.researchDecisions.find((x) => x.ticker === 'MFPC');
  assert.equal(mfpc.label, 'OBSERVE_NO_CHASE');
  assert.equal(mfpc.simulatedEntryPrice, null);
});

test('V17 research portfolio governor admits at most the two highest-priority simultaneous observations', () => {
  const state = createV17ResearchObservationState({ snapshot: frozenSnapshot() });
  const next = observeV17ResearchBatch({
    state,
    observations: [
      observation('MFPC', { open: 40.9, high: 41.2, low: 40.8, last: 41.0 }),
      observation('DAPH', { open: 141.0, high: 143.0, low: 140.8, last: 142.0 }),
      observation('GRCA', { open: 82.0, high: 83.0, low: 81.9, last: 82.5 }),
    ],
  });

  assert.equal(next.researchDecisions.find((x) => x.ticker === 'MFPC').label, 'OBSERVE_ENTRY_ELIGIBLE');
  assert.equal(next.researchDecisions.find((x) => x.ticker === 'DAPH').label, 'OBSERVE_ENTRY_ELIGIBLE');
  assert.equal(next.researchDecisions.find((x) => x.ticker === 'GRCA').label, 'OBSERVE_PORTFOLIO_CAP');

  const summary = summarizeV17ResearchObservationState(next);
  assert.equal(summary.maxConcurrentObservedPositions, 2);
  assert.equal(summary.lifecycle.filter((x) => x.entryPrice !== null).length, 2);
  assert.equal(summary.productionAuthority, false);
});

test('V17 append-only ledger is hash chained and detects tampering', () => {
  const state = createV17ResearchObservationState({ snapshot: frozenSnapshot() });
  const observed = observeV17ResearchBatch({
    state,
    observations: [observation('MFPC', { open: 40.9, high: 41.2, low: 40.8, last: 41.0 })],
  });

  const ledger0 = createV17ResearchDecisionLedger({
    snapshotHash: state.snapshotHash,
    signalSessionDate: state.signalSessionDate,
    nextTradingSessionDate: state.nextTradingSessionDate,
    createdAt: state.createdAt,
  });
  const ledger1 = appendV17ResearchDecisionRecord({
    ledger: ledger0,
    observedAt: '2026-08-31T07:10:00.000Z',
    decisions: observed.researchDecisions,
  });

  assert.equal(verifyV17ResearchDecisionLedger(ledger1), true);
  assert.equal(ledger1.records.length, 1);

  const tampered = JSON.parse(JSON.stringify(ledger1));
  tampered.records[0].decisions[0].label = 'TAMPERED';
  assert.equal(verifyV17ResearchDecisionLedger(tampered), false);

  assert.throws(() => appendV17ResearchDecisionRecord({
    ledger: ledger1,
    observedAt: '2026-08-31T07:10:00.000Z',
    decisions: [],
  }), /NON_MONOTONIC/);
});
