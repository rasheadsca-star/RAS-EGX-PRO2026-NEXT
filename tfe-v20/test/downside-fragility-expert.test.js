import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOWNSIDE_FRAGILITY_POLICY,
  assessSignalTimeFragility,
  assessNextOpenRecoveryTrap,
} from '../src/downsideFragilityExpert.js';

function barsWithGaps(gaps, future = []) {
  let prevClose = 100;
  const bars = [{ date: '2026-07-01', open: 100, close: 100 }];
  for (let i = 0; i < gaps.length; i++) {
    const day = String(i + 2).padStart(2, '0');
    const open = prevClose * (1 + gaps[i] / 100);
    const close = 100 + i * 0.1;
    bars.push({ date: `2026-07-${day}`, open, close });
    prevClose = close;
  }
  return [...bars, ...future];
}

test('expert is hard locked to zero authority', () => {
  assert.equal(DOWNSIDE_FRAGILITY_POLICY.scoringImpact, 'NONE');
  assert.equal(DOWNSIDE_FRAGILITY_POLICY.alphaWeight, 0);
  assert.equal(DOWNSIDE_FRAGILITY_POLICY.productionAuthority, false);
  assert.equal(DOWNSIDE_FRAGILITY_POLICY.promotionEligible, false);
  assert.equal(DOWNSIDE_FRAGILITY_POLICY.retuningAllowedAfterAudit, false);
});

test('signal-time fragility uses only bars at or before signal date', () => {
  const gaps = [-2, -2, -2, ...Array(17).fill(0)];
  const base = barsWithGaps(gaps);
  const signalDate = base.at(-1).date;
  const clean = assessSignalTimeFragility({ bars: base, signalDate });
  const poisonedFuture = assessSignalTimeFragility({
    bars: [...base, { date: '2026-08-30', open: 1, close: 999 }],
    signalDate,
  });
  assert.equal(clean.decision, 'FRAGILE_WATCH');
  assert.deepEqual(poisonedFuture, clean);
  assert.equal(clean.latestUsedDate, signalDate);
});

test('fixed signal rule does not become fragile from one isolated gap', () => {
  const gaps = [-2, ...Array(19).fill(0)];
  const bars = barsWithGaps(gaps);
  const verdict = assessSignalTimeFragility({ bars, signalDate: bars.at(-1).date });
  assert.equal(verdict.decision, 'PASS');
});

test('next-open structural guard vetoes only an open below frozen entry low', () => {
  assert.equal(assessNextOpenRecoveryTrap({ frozenEntryLow: 100, nextOpen: 99.99 }).decision, 'VETO_GAP_DOWN_RECOVERY_ENTRY');
  assert.equal(assessNextOpenRecoveryTrap({ frozenEntryLow: 100, nextOpen: 100 }).decision, 'PASS');
  assert.equal(assessNextOpenRecoveryTrap({ frozenEntryLow: 100, nextOpen: 101 }).decision, 'PASS');
});

test('outcome fields cannot change the structural decision', () => {
  const a = assessNextOpenRecoveryTrap({ frozenEntryLow: 100, nextOpen: 99 });
  const b = assessNextOpenRecoveryTrap({ frozenEntryLow: 100, nextOpen: 99, stopTouched: false, targetTouched: true, nextCloseReturnPct: 50 });
  assert.deepEqual(a, b);
});

test('missing next-open data cannot silently veto', () => {
  assert.equal(assessNextOpenRecoveryTrap({ frozenEntryLow: 100 }).decision, 'UNAVAILABLE');
});
