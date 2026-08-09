'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSameCurrencyValuation } = require('../../scripts/v17/historical-recovery/acquisition/fundamentals/valuation.cjs');
const { scoreFundamentals } = require('../../scripts/v17/historical-recovery/fundamentals/scoring.cjs');
const { integrateStock } = require('../../scripts/v17/historical-recovery/intelligence/integrated-model.cjs');
const { buildDecisionSnapshot } = require('../../scripts/v17/historical-recovery/intelligence/decisions.cjs');

function periods(overrides = {}) { return [2024, 2025].map((year, i) => ({ periodEnd: `${year}-12-31`, periodType: 'ANNUAL', statementScope: 'CONSOLIDATED', comparable: true, currency: 'EGP', revenue: 1000 + i * 200, grossProfit: 400 + i * 80, operatingProfit: 220 + i * 50, netProfit: 160 + i * 40, eps: 1.6 + i * .4, totalAssets: 2000 + i * 100, currentAssets: 900 + i * 50, cash: 300 + i * 20, totalEquity: 1100 + i * 100, currentLiabilities: 400, totalDebt: 200, operatingCashFlow: 190 + i * 30, capex: 50, interestExpense: 20, ...overrides })); }
function company(overrides = {}) { return { ticker: 'TEST', sector: 'Industrial', currency: 'EGP', identityConfidence: 'HIGH', sourceConfidence: 'HIGH', periods: periods(), shareEvidence: { sharesOutstanding: 100, currency: 'EGP', corporateActionReview: false, documentId: 'SHARES' }, provenance: [{ source: 'OFFICIAL', sourceUrl: 'https://example.test/report' }], ...overrides }; }
function market(overrides = {}) { return { ticker: 'TEST', companyNameAr: 'اختبار', dataQualityStatus: 'VALID', dataConfidence: 95, corporateActionConfidence: 'HIGH_NO_DETECTED_DISCONTINUITY', recoveryScore: 85, strengthScore: 80, recoveryStage: 'EARLY_RECOVERY', recoveryStageAr: 'بداية تعافٍ', coverageEnd: '2026-08-06', horizons: { maxAvailable: { current: 20, currentDrawdownPct: 45, recoveryPositionPct: 25, postPeakLow: 15 }, technical: { rsi14: 55 } }, ...overrides }; }
const news = { ticker: 'TEST', coverageStatus: 'COVERED_NO_MATERIAL_EVENT', newsImpactScore: 0, newsConfidence: 0, materialEvents: [] };
function scored(c = company(), m = market()) { const valuation = calculateSameCurrencyValuation(c, m, new Date('2026-08-09')); return scoreFundamentals({ ...c, valuation }, { asOf: new Date('2026-08-09') }); }

test('insufficient data can become a positive candidate only after complete verified evidence', () => {
  const complete = integrateStock(market(), scored(), news);
  assert.ok(['POSITIVE_WATCH', 'STAGED_INVESTMENT_CANDIDATE', 'STRONG_CONFIRMED_CANDIDATE'].includes(complete.classificationCode));
  const previous = { snapshotId: 'BASE', decisions: [{ ticker: 'TEST', currentDecision: 'INSUFFICIENT_FINANCIAL_DATA', currentDecisionAr: 'بيانات مالية غير كافية', investmentResearchScore: null, detail: { ...complete, classificationCode: 'INSUFFICIENT_FINANCIAL_DATA', fundamental: { fundamentalDataConfidence: 'UNAVAILABLE' }, dataCompleteness: 'PARTIAL' } }] };
  const snapshot = buildDecisionSnapshot([complete], previous, new Date('2026-08-09T12:00:00Z'));
  assert.ok(snapshot.decisions[0].changeTypes.includes('NEW_EVIDENCE'));
  assert.ok(snapshot.decisions[0].changeReasonsAr.some(reason => reason.includes('اكتمال دليل مالي جديد')));
});
test('complete evidence with recurring losses activates value-trap or risk block, never positive candidate', () => {
  const weak = company({ periods: periods({ revenue: 500, operatingProfit: -100, netProfit: -100, eps: -1, totalDebt: 2500, totalEquity: 300, currentAssets: 100, currentLiabilities: 800, operatingCashFlow: -80 }) });
  const result = integrateStock(market(), scored(weak), news);
  assert.ok(!['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE'].includes(result.classificationCode));
});
test('strong fundamentals plus weak technical confirmation remains watch/wait', () => {
  const weakTechnical = market({ recoveryStage: 'NO_RECOVERY', recoveryScore: 20, strengthScore: 25 });
  const result = integrateStock(weakTechnical, scored(company(), weakTechnical), news);
  assert.ok(!['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE'].includes(result.classificationCode));
});
test('major verified negative official disclosure forces review', () => {
  const negativeNews = { ticker: 'TEST', coverageStatus: 'EVENT_COVERED', newsImpactScore: -80, newsConfidence: 95, materialEvents: [{ decisionEligible: true, newsImpactScore: -80, materiality: 90 }] };
  assert.equal(integrateStock(market(), scored(), negativeNews).classificationCode, 'REVIEW_REQUIRED');
});
