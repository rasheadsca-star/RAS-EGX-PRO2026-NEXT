'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAvailableAsOf, selectEvidenceAsOf } = require('../../scripts/v17/historical-recovery/acquisition/normalization/point-in-time.cjs');
const { resolveActiveVersions } = require('../../scripts/v17/historical-recovery/acquisition/normalization/restatements.cjs');

const report = { documentId: 'ORIGINAL', ticker: 'TEST', reportingPeriodEnd: '2025-12-31', periodType: 'ANNUAL', statementScope: 'CONSOLIDATED', publicationDate: '2026-03-01', effectiveAvailableDate: '2026-03-01', retrievedAt: '2026-03-01' };
test('report published after a decision cannot leak backward', () => assert.equal(isAvailableAsOf(report, '2026-02-28'), false));
test('report available and retrieved before a current decision is eligible', () => assert.equal(isAvailableAsOf(report, '2026-03-02'), true));
test('newly discovered old report does not rewrite history outside reconstruction mode', () => {
  const discoveredLate = { ...report, publicationDate: '2025-03-01', effectiveAvailableDate: '2025-03-01', retrievedAt: '2026-08-09' };
  assert.equal(isAvailableAsOf(discoveredLate, '2025-12-31'), false);
  assert.equal(isAvailableAsOf(discoveredLate, '2025-12-31', { reconstructionMode: true }), true);
});
test('restatement becomes active only after its own effective date', () => {
  const revised = { ...report, documentId: 'RESTATED', publicationDate: '2026-06-01', effectiveAvailableDate: '2026-06-01', retrievedAt: '2026-06-01', restatementDetected: true, restatementReason: 'AUDITOR_REVISION' };
  assert.equal(resolveActiveVersions([report, revised], '2026-04-01').active[0].documentId, 'ORIGINAL');
  const later = resolveActiveVersions([report, revised], '2026-07-01');
  assert.equal(later.active[0].documentId, 'RESTATED');
  assert.equal(later.history[0].supersededBy, 'RESTATED');
});
test('point-in-time selector excludes future documents deterministically', () => assert.deepEqual(selectEvidenceAsOf([report], '2026-02-28'), []));
