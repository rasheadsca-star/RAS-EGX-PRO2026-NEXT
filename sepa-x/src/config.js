const freeze = (x) => {
  if (!x || typeof x !== 'object' || Object.isFrozen(x)) return x;
  Object.freeze(x);
  for (const v of Object.values(x)) freeze(v);
  return x;
};

export const DEFAULT_CONFIG = freeze({
  engineId: 'SEPA_X_ENGINE_V1',
  schemaVersion: '1.0.0',
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
    requiredHistorySessions: 252,
    staleSessionTolerance: 0,
    universeSourceBranch: 'main',
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
    timeoutMs: 12_000,
    retries: 2,
    concurrency: 10,
  },
});
