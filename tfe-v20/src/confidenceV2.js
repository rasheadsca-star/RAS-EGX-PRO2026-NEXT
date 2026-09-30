import { round, clamp } from './math.js';

// Confidence V2: evidence-aware calibration layer.
// This module does not bypass hard gates; it only improves confidence reporting.

export function evidenceReliability(tradeCount = 0) {
  if (tradeCount >= 30) return 1;
  if (tradeCount >= 20) return 0.85;
  if (tradeCount >= 10) return 0.65;
  if (tradeCount >= 5) return 0.35;
  return 0;
}

export function confidenceV2({
  t1HitRatePct = null,
  stopRatePct = null,
  profitFactor = null,
  avgNetPct = null,
  tradeCount = 0,
  dataQuality = 100,
  regimeFit = 50,
} = {}) {
  const reliability = evidenceReliability(tradeCount);
  const t1 = Number.isFinite(t1HitRatePct) ? t1HitRatePct : 50;
  const stopPenalty = Number.isFinite(stopRatePct) ? stopRatePct : 50;
  const pf = Number.isFinite(Number(profitFactor)) ? Number(profitFactor) : 1;
  const net = Number.isFinite(avgNetPct) ? avgNetPct : 0;

  const raw =
    (t1 * 0.35) +
    (Math.min(100, Math.max(0, pf * 50)) * 0.20) +
    (Math.min(100, Math.max(0, 50 + net * 5)) * 0.15) +
    (Math.max(0, 100 - stopPenalty) * 0.10) +
    (dataQuality * 0.10) +
    (regimeFit * 0.10);

  const calibrated = 50 + (raw - 50) * reliability;

  return {
    score: round(clamp(calibrated, 0, 100), 1),
    evidenceReliability: round(reliability, 2),
    grade: calibrated >= 75 ? 'HIGH' : calibrated >= 60 ? 'MEDIUM' : 'LOW',
    sampleSize: tradeCount,
    methodology: 'Evidence-weighted calibration; never bypasses hard gates',
  };
}

export function classifyOpportunity({ confidence, eligible = false } = {}) {
  if (eligible && confidence.score >= 75) return 'QUALIFIED_HIGH_CONFIDENCE';
  if (confidence.score >= 60) return 'HIGH_POTENTIAL_MONITOR';
  return 'INSUFFICIENT_EVIDENCE';
}
