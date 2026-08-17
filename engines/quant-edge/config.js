'use strict';

module.exports = Object.freeze({
  engine: Object.freeze({
    name: 'QUANT EDGE',
    version: '1.0.0-shadow',
    shadowMode: true,
    allowExecution: false,
    minBars: 60,
    minLiquidityScore: 0.45,
    minCoreConfidence: 68,
    highConvictionConfidence: 80,
    maxRecommendations: 5,
  }),
  broker: Object.freeze({
    maxInfluencePoints: 15,
    minSourcesForConsensus: 2,
    sourceQuality: Object.freeze({
      OFFICIAL_RESEARCH_REPORT: 1.00,
      OFFICIAL_BROKER_APP_OR_SITE: 0.95,
      OFFICIAL_BROKER_SOCIAL: 0.80,
      TRUSTED_MEDIA_QUOTE: 0.60,
      AGGREGATOR_NAMED_ANALYST: 0.50,
      UNKNOWN: 0.00,
    }),
    freshness: Object.freeze([
      { maxSessions: 2, weight: 1.00 },
      { maxSessions: 5, weight: 0.75 },
      { maxSessions: 10, weight: 0.40 },
      { maxSessions: Infinity, weight: 0.00 },
    ]),
  }),
  risk: Object.freeze({
    atrStopMultiplier: 1.35,
    tp1R: 1.6,
    tp2R: 2.6,
    maxRiskPct: 0.055,
    entryAtrBand: 0.20,
    defaultTimeStopSessions: 10,
  }),
});
