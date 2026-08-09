'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUnit, normalizeCurrency, normalizeDatapoint } = require('../../scripts/v17/historical-recovery/fundamentals/normalization.cjs');
const { scoreFundamentals } = require('../../scripts/v17/historical-recovery/fundamentals/scoring.cjs');
const { integrateStock } = require('../../scripts/v17/historical-recovery/intelligence/integrated-model.cjs');

const asOf = new Date('2026-08-09T12:00:00Z');
function periods(overrides = {}) {
  return [2023, 2024, 2025, 2026].map((year, index) => ({
    periodEnd: `${year}-06-30`, publicationDate: `${year}-08-01`, currency: 'EGP',
    revenue: 800 + index * 120, grossProfit: 300 + index * 50, operatingProfit: 180 + index * 35,
    netProfit: 120 + index * 28, eps: 1.2 + index * 0.3, totalAssets: 1800 + index * 150,
    totalEquity: 900 + index * 100, totalDebt: 180 - index * 10, cash: 220 + index * 20,
    operatingCashFlow: 150 + index * 30, capex: 40, currentAssets: 700 + index * 50,
    currentLiabilities: 300 + index * 20, interestExpense: 25,
    ...overrides,
  }));
}
function company(overrides = {}) {
  return {
    ticker: 'TEST', sector: 'Industrial', sourceConfidence: 'HIGH', currency: 'EGP', periods: periods(),
    valuation: { priceToEarnings: 9, priceToBook: 1.1, evToEbitda: 6, dividendYieldPct: 5 },
    provenance: [{ source: 'OFFICIAL_TEST_FIXTURE', sourceUrl: 'https://example.test/official' }], ...overrides,
  };
}
function market(overrides = {}) {
  return {
    ticker: 'TEST', companyNameAr: 'شركة اختبار', companyNameEn: 'Test Co', dataQualityStatus: 'VALID', dataConfidence: 95,
    corporateActionConfidence: 'HIGH_NO_DETECTED_DISCONTINUITY', recoveryScore: 75, strengthScore: 70, recoveryStage: 'RECOVERY_CONFIRMED', recoveryStageAr: 'تعافٍ مؤكد',
    horizons: { maxAvailable: { available: true, high: 100, current: 60, postPeakLow: 50, currentDrawdownPct: 40, recoveryPositionPct: 20 }, technical: { rsi14: 55, ema20: 58, ema50: 54, ema200: 45 } },
    ...overrides,
  };
}
function coveredNews(overrides = {}) { return { ticker: 'TEST', coverageStatus: 'COVERED_NO_MATERIAL_EVENT', newsImpactScore: 0, newsConfidence: 85, materialEvents: [], ...overrides }; }

test('profitable low-debt company receives transparent strong quality components', () => {
  const result = scoreFundamentals(company(), { asOf });
  assert.ok(result.fundamentalQualityScore >= 65);
  assert.equal(result.financialRisk.classification, 'RELATIVELY_LOW');
  assert.ok(Object.values(result.components).every(part => Object.hasOwn(part, 'score')));
});
test('high-debt company is independently high risk', () => {
  const result = scoreFundamentals(company({ periods: periods({ totalDebt: 3000, totalEquity: 500, interestExpense: 250, operatingProfit: 100 }) }), { asOf });
  assert.ok(['HIGH', 'VERY_HIGH'].includes(result.financialRisk.classification));
});
test('recurring losses are explicit financial-risk evidence', () => {
  const result = scoreFundamentals(company({ periods: periods({ netProfit: -80, eps: -0.8 }) }), { asOf });
  assert.ok(result.financialRisk.evidence.some(x => x.code === 'RECURRING_LOSSES'));
});
test('persistent negative operating cash flow is detected', () => {
  const result = scoreFundamentals(company({ periods: periods({ operatingCashFlow: -40 }) }), { asOf });
  assert.ok(result.financialRisk.evidence.some(x => x.code === 'PERSISTENT_NEGATIVE_CFO'));
});
test('deteriorating equity is detected', () => {
  const custom = periods().map((p, index) => ({ ...p, totalEquity: 1000 - index * 220 }));
  const result = scoreFundamentals(company({ periods: custom }), { asOf });
  assert.ok(result.financialRisk.evidence.some(x => x.code === 'DETERIORATING_EQUITY'));
});
test('strong earnings can coexist with expensive valuation', () => {
  const result = scoreFundamentals(company({ valuation: { priceToEarnings: 60, priceToBook: 8, evToEbitda: 35, dividendYieldPct: 0 } }), { asOf });
  assert.ok(result.fundamentalQualityScore >= 65);
  assert.ok(result.valuation.score < 25);
});
test('cheap valuation with poor quality raises value-trap risk', () => {
  const weak = periods({ revenue: 500, operatingProfit: -100, netProfit: -120, eps: -1, operatingCashFlow: -100, totalDebt: 2400, totalEquity: 400, currentAssets: 200, currentLiabilities: 600 });
  const result = scoreFundamentals(company({ periods: weak, valuation: { priceToEarnings: 5, priceToBook: 0.5, evToEbitda: 3, dividendYieldPct: 10 } }), { asOf });
  assert.equal(result.valueTrapRisk.classification, 'HIGH');
  assert.ok(result.valueTrapRisk.reasons.length >= 2);
});
test('missing fundamentals produce unavailable rather than neutral scores', () => {
  const result = scoreFundamentals(company({ periods: [] }), { asOf });
  assert.equal(result.fundamentalDataConfidence, 'UNAVAILABLE');
  assert.equal(result.fundamentalQualityScore, null);
  assert.equal(result.valuation.score, null);
});
test('stale financial statements lower confidence and create risk evidence', () => {
  const result = scoreFundamentals(company({ periods: periods().map(p => ({ ...p, periodEnd: '2023-12-31' })) }), { asOf });
  assert.equal(result.staleFinancialStatements, true);
  assert.equal(result.fundamentalDataConfidence, 'LOW');
  assert.ok(result.financialRisk.evidence.some(x => x.code === 'STALE_FINANCIAL_STATEMENTS'));
});
test('unit normalization is deterministic', () => {
  assert.equal(normalizeUnit(2.5, 'MILLION'), 2_500_000);
  assert.equal(normalizeUnit(3, 'BILLION'), 3_000_000_000);
});
test('currency normalization requires an explicit rate and preserves provenance', () => {
  assert.equal(normalizeCurrency(100, 'USD', 'EGP', { USD_EGP: 50 }), 5000);
  assert.equal(normalizeCurrency(100, 'USD', 'EGP', {}), null);
  const point = normalizeDatapoint({ value: 2, unit: 'MILLION', currency: 'USD', source: 'OFFICIAL', reportingPeriod: '2025' }, 'EGP', { USD_EGP: 50 });
  assert.equal(point.value, 100_000_000);
  assert.equal(point.sourceCurrency, 'USD');
});
test('bank model does not use industrial leverage logic', () => {
  const bankPeriods = periods({ totalDebt: 10_000, totalEquity: 1000, capitalAdequacyPct: 20, nonPerformingLoansPct: 3, roePct: 18, roaPct: 2 });
  const result = scoreFundamentals(company({ sector: 'Bank', periods: bankPeriods, valuation: { priceToEarnings: 8, priceToBook: 1, dividendYieldPct: 4 } }), { asOf });
  assert.equal(result.sectorModel, 'BANK');
  assert.ok(!result.financialRisk.evidence.some(x => x.code === 'EXCESSIVE_LEVERAGE'));
});
test('severe fundamental risk blocks positive integrated classification', () => {
  const highRisk = scoreFundamentals(company({ periods: periods({ totalDebt: 4000, totalEquity: 400, currentAssets: 100, currentLiabilities: 700, interestExpense: 300, operatingProfit: 100 }) }), { asOf });
  const result = integrateStock(market(), highRisk, coveredNews());
  assert.ok(!['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE'].includes(result.classificationCode));
});
