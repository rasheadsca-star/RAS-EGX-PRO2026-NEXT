'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateSourceState } = require('../../scripts/v17/historical-recovery/acquisition/quality/source-state.cjs');
const { compareMetric } = require('../../scripts/v17/historical-recovery/acquisition/quality/cross-source.cjs');
const { calculateSameCurrencyValuation } = require('../../scripts/v17/historical-recovery/acquisition/fundamentals/valuation.cjs');
const { validateAcquisition } = require('../../scripts/v17/historical-recovery/acquisition/orchestration/validate.cjs');

test('source failure retains last known valid evidence', () => {
  const previous = { sourceId: 'IR', lastKnownValid: { documentId: 'D1' }, lastSuccessfulAt: '2026-08-01', consecutiveFailures: 0 };
  const result = updateSourceState(previous, { sourceId: 'IR', status: 'FAILED', checkedAt: '2026-08-09', message: 'HTTP_503' });
  assert.deepEqual(result.lastKnownValid, previous.lastKnownValid);
  assert.equal(result.consecutiveFailures, 1);
});
for (const message of ['TIMEOUT', 'HTTP_500', 'INVALID_DOCUMENT', 'PARSER_FAILURE', 'PARTIAL_DOCUMENT']) test(`${message} cannot erase valid evidence`, () => {
  const result = updateSourceState({ sourceId: 'IR', lastKnownValid: { value: 10 } }, { sourceId: 'IR', status: 'FAILED', message });
  assert.deepEqual(result.lastKnownValid, { value: 10 });
});
test('currency, scope and value discrepancies are quarantined and never averaged', () => {
  const primary = { metric: 'revenue', value: 100, currency: 'EGP', statementScope: 'CONSOLIDATED', reportingPeriodEnd: '2025-12-31' };
  const secondary = { ...primary, value: 70, currency: 'USD', statementScope: 'STANDALONE' };
  const result = compareMetric(primary, secondary);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.ok(result.issues.includes('CURRENCY_CONFLICT'));
  assert.ok(result.issues.includes('STATEMENT_SCOPE_CONFLICT'));
  assert.ok(result.issues.includes('VALUE_DISCREPANCY'));
});
test('valuation fails closed for unresolved corporate action in share count', () => {
  const company = { currency: 'EGP', periods: [{ periodType: 'ANNUAL', comparable: true, periodEnd: '2025-12-31', netProfit: 100, totalEquity: 500 }], shareEvidence: { sharesOutstanding: 100, currency: 'EGP', corporateActionReview: true } };
  const market = { coverageEnd: '2026-08-06', horizons: { maxAvailable: { current: 5 } } };
  const result = calculateSameCurrencyValuation(company, market, new Date('2026-08-09'));
  assert.equal(result.status, 'VALUATION_DATA_INSUFFICIENT');
  assert.ok(result.issues.includes('SHARE_COUNT_CORPORATE_ACTION_REVIEW'));
});
test('acquisition validator rejects low-confidence identity entering financial input', () => {
  const result = validateAcquisition({
    current: { companies: ['SKPC','ELEC','SUGR','SPMD','IRON','AREH','NAHO','ODIN','CFGH'].map(ticker => ({ ticker })), summary: { financialCoverage: { HIGH: 0, MEDIUM: 0, LOW: 0, UNAVAILABLE: 9 } }, rawDocumentsGitTracked: false },
    verifiedInput: { companies: [{ ticker: 'AREH', identityConfidence: 'LOW', provenance: [{ source: 'X' }], periods: [] }] },
    verifiedEvents: { events: [] },
  });
  assert.ok(result.issues.includes('LOW_IDENTITY_ENTERED_MODEL:AREH'));
});
