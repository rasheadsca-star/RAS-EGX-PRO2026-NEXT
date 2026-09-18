const freeze = (x) => {
  if (!x || typeof x !== 'object' || Object.isFrozen(x)) return x;
  Object.freeze(x);
  for (const v of Object.values(x)) freeze(v);
  return x;
};

export const DEFAULT_CONFIG = freeze({
  engineId: 'SEPA_X_ENGINE_V1',
  schemaVersion: '1.3.0',
  researchOnly: true,
  permissions: {
    executionAllowed: false,
    automaticOrders: false,
    productionAllocation: false,
  },
  market: {
    id: 'EGX',
    currency: 'EGP',
    timeZone: 'Africa/Cairo',
    benchmarkYahooSymbol: '^CASE30',
    // R252 compares the current close with the close 252 sessions ago,
    // therefore at least 253 observations are required.
    requiredHistorySessions: 253,
    longHistoryRange: '10y',
    staleSessionTolerance: 0,
    universeSourceBranch: 'main',
    longHistorySourceBranch: 'main',
    repo: 'rasheadsca-star/RAS-EGX-PRO2026-NEXT',
    liquidity: {
      acceptableMedianTurnover20: 1_000_000,
      highMedianTurnover20: 5_000_000,
      dangerousMedianTurnover20: 250_000,
      minTradedDaysRatio60: 0.70,
      maxZeroVolumeDays60: 18,
    },
  },
  rs: {
    weights: { r63: 0.40, r126: 0.20, r189: 0.20, r252: 0.20 },
    minTop: 70,
    strong: 80,
    elite: 90,
  },
  entry: {
    readyBelowPivotPct: 1.5,
    nearBelowPivotPct: 4,
    maxAbovePivotPct: 3,
    maxAbovePivotAtr: 1,
    breakoutVolumeConfirm: 1.4,
    breakoutVolumeStrong: 1.8,
    breakoutVolumeExceptional: 2.5,
    buyZoneAbovePivotPct: 1.5,
  },
  risk: {
    minInitialRiskPct: 4,
    maxInitialRiskPct: 8,
    preferredRewardRisk: 2,
    eliteRewardRisk: 3,
    defaultRiskPerTradePct: 1,
  },
  concentration: {
    baseCount: 3,
    maxCount: 5,
    requireCleanEngineGates: true,
    minRewardRisk: 2,
    maxRiskPct: 8,
    expansionMinFinalScore: 80,
    expansionMinConfidenceScore: 72,
    expansionMinRewardRisk: 2.25,
    expansionMaxConvictionGap: 6,
    // P1 is a separate conservative profit-taking objective used for precision benchmarking.
    // T1/T2/T3 remain unchanged at 2R/3R/4R.
    precisionTargetR: 0.8,
    targetRMultiples: [2, 3, 4],
    entryExpirySessions: 3,
    maxHoldSessions: 20,
    sameBarAmbiguity: 'STOP_FIRST',
  },
  strategies: {
    // New strategy engines start as challengers: they are measured and surfaced,
    // but do not override the existing eligibility gates until historical validation promotes them.
    challengerMode: true,
    structureRetest: {
      lookbackSessions: 140,
      breakoutSearchSessions: 12,
      retestWindowSessions: 8,
      supportSearchSessions: 10,
      levelTolerancePct: 1.2,
      levelToleranceAtr: 0.45,
      breakoutBufferAtr: 0.15,
      minBreakoutVolumeRatio: 1.2,
      maxRetestCloseBelowPct: 0.5,
      minTouches: 2,
    },
    historicalCycle: {
      maxLookbackSessions: 900,
      swingRadius: 3,
      minBottomSeparationSessions: 15,
      maxCycleSessions: 180,
      minAdvancePct: 8,
      minSamples: 3,
      maxSamples: 12,
      minAlignmentScore: 60,
    },
  },
  gates: {
    minDataConfidence: 60,
    minVcpQualityForTop: 45,
    maxDistributionRisk: 75,
  },
  scoring: {
    trend: 15,
    rs: 15,
    fundamentals: 15,
    vcp: 15,
    tightness: 8,
    volume: 8,
    entry: 8,
    sector: 5,
    catalyst: 4,
    riskReward: 5,
    liquidity: 2,
  },
  cache: {
    ttlMs: 5 * 60 * 1000,
    timeoutMs: 18_000,
    retries: 3,
    concurrency: 4,
  },
});
