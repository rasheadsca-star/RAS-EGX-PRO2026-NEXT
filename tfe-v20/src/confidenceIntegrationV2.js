import { confidenceV2, classifyOpportunity } from './confidenceV2.js';

// Non-invasive adapter: attaches calibrated confidence without changing eligibility gates.
export function attachConfidenceV2(analysis = {}, historicalConfidence = null, regimeFit = 50) {
  const hc = historicalConfidence ?? {};
  const confidence = confidenceV2({
    t1HitRatePct: hc.target1HitRatePct,
    stopRatePct: hc.stopRatePct,
    profitFactor: hc.profitFactor,
    avgNetPct: hc.avgNetPct,
    tradeCount: hc.historicalTradeCount ?? 0,
    dataQuality: analysis?.scores?.dataQuality ?? 50,
    regimeFit,
  });

  return {
    ...analysis,
    confidenceV2: confidence,
    opportunityClass: classifyOpportunity({
      confidence,
      eligible: Boolean(analysis?.eligible),
    }),
  };
}
