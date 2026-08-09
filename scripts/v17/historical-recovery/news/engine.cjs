'use strict';
const crypto = require('crypto');

const SENTIMENT_VALUE = Object.freeze({ VERY_POSITIVE: 1, POSITIVE: 0.55, NEUTRAL: 0, NEGATIVE: -0.55, VERY_NEGATIVE: -1 });
const VALID_TIERS = new Set(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

function eventFingerprint(event) {
  const facts = Array.isArray(event.numericFacts) ? event.numericFacts.slice().sort().join('|') : String(event.numericFacts || '');
  const identity = [event.ticker || 'MARKET', event.eventType, String(event.eventDate || '').slice(0, 10), facts, event.officialReference || ''].join('::').toUpperCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function timeRelevance(event, asOf = new Date()) {
  const date = new Date(event.eventDate);
  if (!Number.isFinite(date.getTime())) return 0;
  const days = Math.max(0, (asOf.getTime() - date.getTime()) / 86400000);
  const structural = event.durationClass === 'STRUCTURAL_EVENT';
  const halfLife = structural ? 365 : 30;
  return Number(clamp(100 * (0.5 ** (days / halfLife)), 0, 100).toFixed(2));
}

function validateEvent(event) {
  const issues = [];
  if (!event?.eventType) issues.push('EVENT_TYPE_REQUIRED');
  if (!event?.eventDate || !Number.isFinite(new Date(event.eventDate).getTime())) issues.push('EVENT_DATE_REQUIRED');
  if (!VALID_TIERS.has(event?.sourceTier)) issues.push('SOURCE_TIER_INVALID');
  if (!event?.sourceUrl && !event?.officialReference) issues.push('SOURCE_PROVENANCE_REQUIRED');
  if (!(event?.sentiment in SENTIMENT_VALUE)) issues.push('SENTIMENT_INVALID');
  for (const field of ['materiality', 'sourceConfidence']) {
    if (!Number.isFinite(Number(event?.[field])) || Number(event[field]) < 0 || Number(event[field]) > 100) issues.push(`${field.toUpperCase()}_INVALID`);
  }
  return issues;
}

function scoreEvent(event, asOf = new Date()) {
  const issues = validateEvent(event);
  const rumor = event.sourceTier === 'TIER_4';
  const relevance = timeRelevance(event, asOf);
  const impact = issues.length || rumor ? 0 : SENTIMENT_VALUE[event.sentiment]
    * Number(event.materiality) * (Number(event.sourceConfidence) / 100) * (relevance / 100);
  return {
    ...event,
    fingerprint: eventFingerprint(event),
    timeRelevance: relevance,
    newsImpactScore: Number(clamp(impact, -100, 100).toFixed(2)),
    decisionEligible: issues.length === 0 && !rumor,
    unconfirmed: rumor,
    validationIssues: issues,
    explanationAr: arabicExplanation(event, rumor, issues),
  };
}

function arabicExplanation(event, rumor = event.sourceTier === 'TIER_4', issues = validateEvent(event)) {
  if (issues.includes('SOURCE_PROVENANCE_REQUIRED')) return 'لا يمكن استخدام الخبر لغياب مرجع مصدر قابل للتحقق.';
  if (rumor) return 'خبر غير مؤكد؛ يظهر للوعي فقط ولا يغير التصنيف البحثي.';
  const direction = ['VERY_POSITIVE', 'POSITIVE'].includes(event.sentiment) ? 'إيجابيًا'
    : ['VERY_NEGATIVE', 'NEGATIVE'].includes(event.sentiment) ? 'سلبيًا' : 'بصورة محايدة';
  const duration = event.durationClass === 'STRUCTURAL_EVENT' ? 'وقد يمتد أثره على المدى الطويل' : 'ويرجح أن يكون أثره مؤقتًا';
  return `${event.summaryAr || 'تم تسجيل حدث موثق.'} يُقيّم الحدث ${direction} ${duration}، وفق أهميته وثقة مصدره.`;
}

function deduplicateEvents(events, asOf = new Date()) {
  const byFingerprint = new Map();
  for (const event of events) {
    const scored = scoreEvent(event, asOf);
    const previous = byFingerprint.get(scored.fingerprint);
    if (!previous || scored.sourceConfidence > previous.sourceConfidence || scored.sourceTier < previous.sourceTier) byFingerprint.set(scored.fingerprint, scored);
  }
  return [...byFingerprint.values()];
}

function buildNewsDataset({ universe, events = [], asOf = new Date(), sourceHealth = 'FAILED' }) {
  const scored = deduplicateEvents(events, asOf);
  const results = universe.map(stock => {
    const ticker = String(stock.ticker).toUpperCase();
    const relevant = scored.filter(event => String(event.ticker || '').toUpperCase() === ticker
      || event.marketWide === true
      || (event.sector && event.sector === stock.sector)
      || (event.sectorModel && event.sectorModel === stock.sectorModel));
    const eligible = relevant.filter(event => event.decisionEligible);
    const coverageStatus = relevant.length ? 'EVENT_COVERED' : sourceHealth === 'HEALTHY' ? 'COVERED_NO_MATERIAL_EVENT' : 'SOURCE_COVERAGE_UNAVAILABLE';
    const netImpact = eligible.length ? clamp(eligible.reduce((sum, event) => sum + event.newsImpactScore, 0), -100, 100)
      : coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE' ? null : 0;
    const confidence = eligible.length ? Math.max(...eligible.map(event => Number(event.sourceConfidence)))
      : coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE' ? null : 0;
    return {
      ticker,
      newsImpactScore: netImpact === null ? null : Number(netImpact.toFixed(2)),
      newsConfidence: confidence,
      coverageStatus,
      materialEvents: relevant.sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate))),
      latestMaterialEvent: relevant[0] || null,
    };
  });
  return {
    schemaVersion: '17.4.0-news-1',
    generatedAt: asOf.toISOString(),
    researchOnly: true,
    sourceHealth,
    summary: {
      universe: universe.length,
      suppliedEvents: events.length,
      uniqueEvents: scored.length,
      verifiedDecisionEligibleEvents: scored.filter(x => x.decisionEligible).length,
      coveredSymbols: results.filter(x => x.coverageStatus !== 'SOURCE_COVERAGE_UNAVAILABLE').length,
    },
    events: scored,
    results,
  };
}

module.exports = { SENTIMENT_VALUE, eventFingerprint, timeRelevance, validateEvent, scoreEvent, deduplicateEvents, buildNewsDataset, arabicExplanation };
