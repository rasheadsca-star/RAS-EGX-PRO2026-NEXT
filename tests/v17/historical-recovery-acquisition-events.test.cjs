'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDisclosureEvent, canonicalizeEvents } = require('../../scripts/v17/historical-recovery/acquisition/disclosures/events.cjs');
const { scoreEvent, deduplicateEvents } = require('../../scripts/v17/historical-recovery/news/engine.cjs');

function official(overrides = {}) { return { ticker: 'SKPC', company: 'SIDPEC', title: 'Annual results', eventType: 'FINANCIAL_RESULTS', publicationTimestamp: '2026-04-01T10:00:00Z', eventDate: '2026-04-01T10:00:00Z', sourceId: 'SIDPEC_IR', sourceTier: 'TIER_1', sourceUrl: 'https://www.sidpec.com/report.pdf', officialReference: 'SKPC-2026-RESULTS', identityConfidence: 'HIGH', sourceConfidence: 95, materiality: 80, sentiment: 'NEGATIVE', durationClass: 'MEDIUM_TERM_EVENT', facts: [{ metric: 'netProfit', value: 100 }], numericFacts: ['netProfit=100'], ...overrides }; }
test('official disclosure passes event validation', () => assert.equal(validateDisclosureEvent(official()).valid, true));
test('missing publication timestamp remains in review', () => assert.ok(validateDisclosureEvent(official({ publicationTimestamp: null })).issues.includes('PUBLICATION_TIMESTAMP_REQUIRED')));
test('wrong-company identity is rejected', () => assert.ok(validateDisclosureEvent(official({ identityConfidence: 'REJECTED' })).issues.includes('IDENTITY_CONFIDENCE_INSUFFICIENT')));
test('official disclosure and article referring to same official reference deduplicate', () => {
  const article = official({ sourceId: 'NEWS', sourceTier: 'TIER_2', sourceUrl: 'https://news.example/story' });
  const canonical = canonicalizeEvents([official(), article]);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].secondaryEvidence.length, 1);
});
test('duplicate news articles collapse to one scored event', () => assert.equal(deduplicateEvents([official(), official({ sourceTier: 'TIER_2', sourceConfidence: 80 })], new Date('2026-04-02')).length, 1));
test('rumor is visible but never decision eligible', () => {
  const result = scoreEvent(official({ sourceTier: 'TIER_4' }), new Date('2026-04-02'));
  assert.equal(result.decisionEligible, false);
  assert.equal(result.newsImpactScore, 0);
});
test('structural event decays more slowly than a temporary event', () => {
  const structural = scoreEvent(official({ sentiment: 'POSITIVE', durationClass: 'STRUCTURAL_EVENT' }), new Date('2026-07-01'));
  const temporary = scoreEvent(official({ sentiment: 'POSITIVE', durationClass: 'TEMPORARY_EVENT' }), new Date('2026-07-01'));
  assert.ok(structural.timeRelevance > temporary.timeRelevance);
});
test('negative and positive official events preserve factual direction', () => {
  assert.ok(scoreEvent(official(), new Date('2026-04-02')).newsImpactScore < 0);
  assert.ok(scoreEvent(official({ sentiment: 'POSITIVE' }), new Date('2026-04-02')).newsImpactScore > 0);
});
test('neutral capital action remains zero impact absent verified directional facts', () => assert.equal(scoreEvent(official({ eventType: 'BONUS_SHARES', sentiment: 'NEUTRAL' }), new Date('2026-04-02')).newsImpactScore, 0));
