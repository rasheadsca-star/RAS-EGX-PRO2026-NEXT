const envNum = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
};

export const POLICY = Object.freeze({
  engineId: 'TFE_V20_FUSION_RC2',
  schemaVersion: '20.tfe.2',
  minBars: 60,
  minCoreScore: envNum('RC2_MIN_CORE_SCORE', 70),
  minResearchScore: envNum('RC2_MIN_RESEARCH_SCORE', 72),
  minLiquidityScore: envNum('RC2_MIN_LIQUIDITY_SCORE', 55),
  minSrScore: envNum('RC2_MIN_SR_SCORE', 55),
  minSrMethods: 2,
  minStructuralNetRR: envNum('RC2_MIN_STRUCTURAL_NET_RR', 0.70),
  precisionTargetR: 0.80,
  maxPullbackDistanceAtr: 0.70,
  entryAtr: 0.38,
  entryPct: 0.45,
  stopAtr: 0.70,
  stopPct: 0.80,
  entryExpirySessions: 3,
  maxHoldSessions: 10,
  roundTripCostPct: 0.60,
  minHistoricalTrades: 5,
  fusionRank: Object.freeze({
    researchWeight: 0.75,
    historicalConfidenceWeight: 0.25,
  }),
  quality: Object.freeze({
    hardBlockWarnings: [
      'corporate_action_review_required',
      'not_officially_verified',
      'historical_seed_not_officially_verified'
    ],
    conflictReviewPct: 5,
    conflictBlockPct: 20,
  }),
  permissions: Object.freeze({
    researchOnly: true,
    executionAllowed: false,
    productionAllocation: false,
    automaticOrders: false,
    automaticChampionPromotion: false,
  }),
});
