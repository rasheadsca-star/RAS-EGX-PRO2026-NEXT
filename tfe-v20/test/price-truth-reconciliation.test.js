import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDataQuality } from '../src/quality.js';

function bars(lastDate = '2026-08-23', lastClose = 9.12) {
  const rows = [];
  const start = Date.UTC(2026, 4, 1);
  for (let i = 0; i < 60; i += 1) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const close = 8 + i * 0.01;
    rows.push({ date, open: close, high: close + 0.1, low: close - 0.1, close, volume: 2_000_000 });
  }
  rows[59] = { date: lastDate, open: 9.05, high: 9.12, low: 9.05, close: lastClose, volume: 9_132_632 };
  return rows;
}

const staleIdentityEvidence = {
  verified: true,
  guardedVerified: false,
  evidence: { localDifferencePct: 61.9273, guardedMaxDifferencePct: 8 },
};

const confirmedTruth = {
  date: '2026-08-23',
  sourceSessionDate: '2026-08-23',
  close: 9.12,
  source: 'mubasher_symbol_pages_precise_enriched',
  validationStatus: 'precise_public_source_session_confirmed',
  confidence: 86,
};

test('session-confirmed latest price truth resolves non-official publication hold', () => {
  const quality = assessDataQuality({
    bars: bars(),
    warnings: ['latest_close_conflict:27.6461%'],
    expectedSessionDate: '2026-08-23',
    symbolVerified: true,
    symbolVerification: staleIdentityEvidence,
    officiallyVerifiedLatestSession: false,
    priceTruthLatest: confirmedTruth,
  });
  assert.equal(quality.publicationHold, false);
  assert.equal(quality.publicationHoldReason, null);
  assert.equal(quality.conflictPct, null);
  assert.equal(quality.reportedConflictPct, 27.6461);
  assert.equal(quality.priceReconciliationResolved, true);
  assert.equal(quality.latestPriceTruth.resolved, true);
  assert.ok(quality.reviewFlags.includes('PRICE_TRUTH_RECONCILIATION_RESOLVED'));
  assert.equal(quality.score, 78);
});

test('stale or mismatched price truth cannot bypass reconciliation hold', () => {
  const quality = assessDataQuality({
    bars: bars(),
    warnings: ['latest_close_conflict:27.6461%'],
    expectedSessionDate: '2026-08-23',
    symbolVerified: true,
    symbolVerification: staleIdentityEvidence,
    officiallyVerifiedLatestSession: false,
    priceTruthLatest: { ...confirmedTruth, sourceSessionDate: '2026-08-20', date: '2026-08-20' },
  });
  assert.equal(quality.publicationHold, true);
  assert.equal(quality.publicationHoldReason, 'PRICE_RECONCILIATION_REQUIRED');
  assert.equal(quality.conflictPct, 27.6461);
  assert.equal(quality.priceReconciliationResolved, false);
});

test('low-confidence or non-independent truth cannot bypass hold', () => {
  for (const priceTruthLatest of [
    { ...confirmedTruth, confidence: 79 },
    { ...confirmedTruth, source: 'internal_derived_cache' },
    { ...confirmedTruth, validationStatus: 'single_source_validated' },
    { ...confirmedTruth, close: 8.6 },
  ]) {
    const quality = assessDataQuality({
      bars: bars(),
      warnings: ['latest_close_conflict:27.6461%'],
      symbolVerified: true,
      symbolVerification: staleIdentityEvidence,
      officiallyVerifiedLatestSession: false,
      priceTruthLatest,
    });
    assert.equal(quality.publicationHold, true);
    assert.equal(quality.priceReconciliationResolved, false);
  }
});

test('review-only conflict below the publication threshold is never auto-resolved', () => {
  const quality = assessDataQuality({
    bars: bars(),
    warnings: ['latest_close_conflict:1.0705%'],
    expectedSessionDate: '2026-08-23',
    symbolVerified: true,
    symbolVerification: staleIdentityEvidence,
    officiallyVerifiedLatestSession: false,
    priceTruthLatest: confirmedTruth,
  });
  assert.equal(quality.publicationHold, false);
  assert.equal(quality.priceReconciliationResolved, false);
  assert.equal(quality.reportedConflictPct, 1.0705);
  assert.equal(quality.conflictPct, 1.0705);
  assert.ok(!quality.reviewFlags.includes('PRICE_TRUTH_RECONCILIATION_RESOLVED'));
});

test('officially verified latest session can never be overridden by secondary price truth', () => {
  const quality = assessDataQuality({
    bars: bars(),
    warnings: ['latest_close_conflict:27.6461%'],
    expectedSessionDate: '2026-08-23',
    symbolVerified: true,
    symbolVerification: staleIdentityEvidence,
    officiallyVerifiedLatestSession: true,
    priceTruthLatest: confirmedTruth,
  });
  assert.equal(quality.priceReconciliationResolved, false);
  assert.equal(quality.publicationHold, true);
  assert.equal(quality.publicationHoldReason, 'PRICE_RECONCILIATION_REQUIRED');
  assert.equal(quality.conflictPct, 27.6461);
});
