import { confidenceV2, classifyOpportunity } from './confidenceV2.js';

// Presentation-only adapter. Does not change eligibility or execution permissions.
export function attachConfidenceV2(candidate = {}) {
  const history = candidate.historicalConfidence ?? {};
  const confidence = confidenceV2({
    t1HitRatePct: history.t1HitRatePct ?? history.confidenceWilsonLower95Pct,
    stopRatePct: history.stopRatePct,
    profitFactor: history.profitFactor,
    avgNetPct: history.avgNetPct,
    tradeCount: history.sampleSize ?? history.trades ?? 0,
    dataQuality: candidate.quality?.score ?? candidate.scores?.dataQuality ?? 0,
    regimeFit: candidate.regimeFit ?? 50,
  });

  return {
    ...candidate,
    confidenceV2: confidence,
    opportunityClass: classifyOpportunity({
      confidence,
      eligible: candidate.recommendation === true && candidate.executionAllowed === true,
    }),
    confidenceMethodology: 'Evidence weighted calibration; presentation only; does not bypass hard gates',
  };
}
