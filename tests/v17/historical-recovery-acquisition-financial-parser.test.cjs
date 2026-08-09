'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFinancialNumber } = require('../../scripts/v17/historical-recovery/acquisition/fundamentals/numeric-parser.cjs');
const { canonicalMetric } = require('../../scripts/v17/historical-recovery/acquisition/normalization/metric-aliases.cjs');
const { validateFinancialPeriod, scopeCurrencyConsistency } = require('../../scripts/v17/historical-recovery/acquisition/normalization/financial-record.cjs');
const { buildDataPoints } = require('../../scripts/v17/historical-recovery/acquisition/orchestration/build.cjs');

test('Arabic and English financial labels map to canonical metrics', () => {
  assert.equal(canonicalMetric('صافي المبيعات'), 'revenue');
  assert.equal(canonicalMetric('Net profit after taxes'), 'netProfit');
  assert.equal(canonicalMetric('صافي التدفقات النقدية من أنشطة التشغيل'), 'operatingCashFlow');
  assert.equal(canonicalMetric('Total shareholders equity'), 'totalEquity');
});
test('Arabic numerals and Arabic separators parse safely', () => assert.equal(parseFinancialNumber('١٬٢٣٤٫٥', { unit: 'THOUSAND' }).value, 1234500));
test('English thousands and decimals parse safely', () => assert.equal(parseFinancialNumber('1,234.50', { unit: 'UNIT' }).value, 1234.5));
test('million and billion scaling is explicit', () => {
  assert.equal(parseFinancialNumber('2.5', { unit: 'MILLION' }).value, 2500000);
  assert.equal(parseFinancialNumber('3', { unit: 'BILLION' }).value, 3000000000);
});
test('parentheses are negative and a dash is missing, never zero', () => {
  assert.equal(parseFinancialNumber('(43.8)', { unit: 'MILLION' }).value, -43800000);
  assert.equal(parseFinancialNumber('—', { unit: 'UNIT' }).value, null);
  assert.equal(parseFinancialNumber('—', { unit: 'UNIT' }).missing, true);
});
test('percentages retain percent metadata without changing magnitude', () => {
  const parsed = parseFinancialNumber('12.5%');
  assert.equal(parsed.value, 12.5);
  assert.equal(parsed.isPercent, true);
});
function period(overrides = {}) { return { periodEnd: '2025-12-31', periodType: 'ANNUAL', statementScope: 'CONSOLIDATED', currency: 'USD', documentId: 'D1', effectiveAvailableDate: '2026-03-01', retrievedAt: '2026-03-02', ...overrides }; }
test('annual, quarterly and 9M YTD records remain distinct', () => {
  assert.equal(validateFinancialPeriod(period()).valid, true);
  assert.equal(validateFinancialPeriod(period({ periodType: 'QUARTERLY' })).valid, true);
  assert.equal(validateFinancialPeriod(period({ periodType: 'YTD', months: 9 })).valid, true);
  assert.ok(validateFinancialPeriod(period({ periodType: 'YTD' })).issues.includes('YTD_MONTHS_REQUIRED'));
});
test('consolidated/standalone and currency conflicts fail closed', () => {
  const result = scopeCurrencyConsistency([period(), period({ statementScope: 'STANDALONE', currency: 'EGP' })]);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('STATEMENT_SCOPE_CONFLICT'));
  assert.ok(result.issues.includes('CURRENCY_CONFLICT'));
});
test('TTM requires an explicit derivation trail', () => assert.ok(validateFinancialPeriod(period({ periodType: 'TTM_DERIVED' })).issues.includes('TTM_DERIVATION_REQUIRED')));
test('normalized datapoints retain reported value, scale, evidence page and point-in-time date', () => {
  const company = { fieldEvidence: { earningsReleaseSummary: { unitScale: 1000000, pages: [2] } }, interimPeriods: [{ periodEnd: '2025-09-30', periodType: 'YTD', months: 9, statementScope: 'CONSOLIDATED', currency: 'USD', documentId: 'D1', effectiveAvailableDate: '2026-08-09', retrievedAt: '2026-08-09', revenue: 5688000 }] };
  const point = buildDataPoints(company)[0];
  assert.equal(point.reportedValue, 5.688);
  assert.equal(point.normalizedValue, 5688000);
  assert.equal(point.unitScale, 1000000);
  assert.deepEqual(point.pageReferences, [2]);
  assert.equal(point.effectiveAvailableDate, '2026-08-09');
});
