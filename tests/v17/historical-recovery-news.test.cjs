'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreEvent, deduplicateEvents, timeRelevance, buildNewsDataset } = require('../../scripts/v17/historical-recovery/news/engine.cjs');
const { integrateStock } = require('../../scripts/v17/historical-recovery/intelligence/integrated-model.cjs');

const asOf = new Date('2026-08-09T12:00:00Z');
function event(overrides = {}) { return { ticker: 'TEST', eventType: 'FINANCIAL_RESULTS', eventDate: '2026-08-08T10:00:00Z', sourceTier: 'TIER_1', sourceUrl: 'https://example.test/disclosure', officialReference: 'EGX-1', sentiment: 'POSITIVE', materiality: 80, sourceConfidence: 95, durationClass: 'STRUCTURAL_EVENT', summaryAr: 'أعلنت الشركة نتائج مالية موثقة.', numericFacts: ['profit:+20%'], ...overrides }; }
function market() { return { ticker: 'TEST', dataQualityStatus: 'VALID', dataConfidence: 95, corporateActionConfidence: 'HIGH', recoveryScore: 75, strengthScore: 70, recoveryStage: 'RECOVERY_CONFIRMED', recoveryStageAr: 'تعافٍ مؤكد', horizons: { maxAvailable: { available: true, currentDrawdownPct: 40, recoveryPositionPct: 20, high: 100, current: 60, postPeakLow: 50 }, technical: { rsi14: 55 } } }; }
function fundamental(overrides = {}) { return { fundamentalDataConfidence: 'HIGH', fundamentalQualityScore: 75, valuation: { status: 'AVAILABLE', score: 70 }, financialRisk: { classification: 'RELATIVELY_LOW', labelAr: 'منخفض نسبيًا', score: 10 }, valueTrapRisk: { classification: 'LOW', labelAr: 'منخفض', score: 5, reasons: [] }, provenance: ['official'], ...overrides }; }

test('verified positive disclosure has positive weighted impact', () => assert.ok(scoreEvent(event(), asOf).newsImpactScore > 0));
test('verified negative disclosure has negative impact', () => assert.ok(scoreEvent(event({ sentiment: 'NEGATIVE' }), asOf).newsImpactScore < 0));
test('major official negative event has materially larger impact', () => {
  const major = scoreEvent(event({ sentiment: 'VERY_NEGATIVE', materiality: 100, sourceConfidence: 100 }), asOf);
  assert.ok(major.newsImpactScore <= -90);
});
test('rumor is visible as unconfirmed but cannot alter a decision', () => {
  const rumor = scoreEvent(event({ sourceTier: 'TIER_4', sourceUrl: 'https://social.example/post' }), asOf);
  assert.equal(rumor.newsImpactScore, 0); assert.equal(rumor.decisionEligible, false); assert.match(rumor.explanationAr, /غير مؤكد/);
});
test('duplicate reporting of one event counts once', () => assert.equal(deduplicateEvents([event(), event({ sourceUrl: 'https://example.test/coverage' })], asOf).length, 1));
test('ordinary stale news decays faster than structural news', () => {
  const oldDate = '2025-08-09T12:00:00Z';
  assert.ok(timeRelevance(event({ eventDate: oldDate, durationClass: 'STRUCTURAL_EVENT' }), asOf) > timeRelevance(event({ eventDate: oldDate, durationClass: 'TEMPORARY_EVENT' }), asOf));
});
test('source provenance is mandatory', () => {
  const missing = scoreEvent(event({ sourceUrl: null, officialReference: null }), asOf);
  assert.equal(missing.decisionEligible, false); assert.ok(missing.validationIssues.includes('SOURCE_PROVENANCE_REQUIRED'));
});
test('low-materiality headline has negligible decision influence', () => assert.ok(Math.abs(scoreEvent(event({ materiality: 2 }), asOf).newsImpactScore) < 2));
test('positive news cannot override severe fundamental weakness', () => {
  const news = buildNewsDataset({ universe: [{ ticker: 'TEST' }], events: [event()], asOf, sourceHealth: 'HEALTHY' }).results[0];
  const weak = fundamental({ fundamentalQualityScore: 25, financialRisk: { classification: 'VERY_HIGH', labelAr: 'مرتفع جدًا', score: 90 }, valueTrapRisk: { classification: 'HIGH', labelAr: 'مرتفع', score: 80, reasons: [] } });
  assert.ok(!['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE'].includes(integrateStock(market(), weak, news).classificationCode));
});
test('severe verified event may force immediate review', () => {
  const news = buildNewsDataset({ universe: [{ ticker: 'TEST' }], events: [event({ sentiment: 'VERY_NEGATIVE', materiality: 100, sourceConfidence: 100 })], asOf, sourceHealth: 'HEALTHY' }).results[0];
  assert.equal(integrateStock(market(), fundamental(), news).classificationCode, 'REVIEW_REQUIRED');
});
test('verified event explanation is natural Arabic', () => assert.match(scoreEvent(event(), asOf).explanationAr, /[؀-ۿ]/));
test('verified sector event applies only to the matching sector model', () => {
  const universe = [{ ticker: 'BANK1', sectorModel: 'BANK' }, { ticker: 'IND1', sectorModel: 'INDUSTRIAL' }];
  const result = buildNewsDataset({ universe, events: [event({ ticker: null, sectorModel: 'BANK', officialReference: 'FRA-SECTOR-1' })], asOf, sourceHealth: 'HEALTHY' });
  assert.equal(result.results.find(x => x.ticker === 'BANK1').materialEvents.length, 1);
  assert.equal(result.results.find(x => x.ticker === 'IND1').materialEvents.length, 0);
});
test('verified macro event can apply market-wide once per stock', () => {
  const universe = [{ ticker: 'A' }, { ticker: 'B' }];
  const result = buildNewsDataset({ universe, events: [event({ ticker: null, marketWide: true, eventType: 'MACROECONOMIC_EVENT', officialReference: 'GOV-MACRO-1' })], asOf, sourceHealth: 'HEALTHY' });
  assert.ok(result.results.every(x => x.materialEvents.length === 1));
});
test('unavailable news source is null rather than fabricated neutral impact', () => {
  const result = buildNewsDataset({ universe: [{ ticker: 'TEST' }], events: [], asOf, sourceHealth: 'FAILED' }).results[0];
  assert.equal(result.coverageStatus, 'SOURCE_COVERAGE_UNAVAILABLE');
  assert.equal(result.newsImpactScore, null);
  assert.equal(result.newsConfidence, null);
});
