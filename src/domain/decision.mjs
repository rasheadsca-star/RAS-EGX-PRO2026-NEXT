import { buildFeatures, labelFromScore, WEIGHTS } from './indicators.mjs';
import { runBacktest } from './backtest.mjs';

export const DISCLAIMER = 'Research only. Not investment advice. The application is not a licensed broker and never places trades.';

export function evaluateDecision(history, {
  horizon = 'short',
  fundamentals = null,
  backtestOptions = {},
} = {}) {
  const backtest = runBacktest(history, backtestOptions);
  const features = buildFeatures(history);
  const rawLabel = labelFromScore(features.finalScore);
  const reasonCodes = [];

  if (!backtest.validated) reasonCodes.push(...backtest.reasonCodes);
  if ((horizon === 'medium' || horizon === 'long') && fundamentals?.verified !== true) {
    reasonCodes.push('VERIFIED_FUNDAMENTALS_REQUIRED');
  }
  if ((rawLabel === 'BUY' || rawLabel === 'SELL') && !backtest.confidenceInterval95Pct) {
    reasonCodes.push('CONFIDENCE_INTERVAL_REQUIRED');
  }

  const blocked = reasonCodes.length > 0;
  const decision = blocked ? 'NO_RECOMMENDATION' : rawLabel;

  return {
    status: blocked ? 'BLOCKED_FAIL_CLOSED' : 'VALIDATED',
    decision,
    rawTechnicalLabel: rawLabel,
    horizon,
    reasonCodes: [...new Set(reasonCodes)],
    score: features.finalScore,
    features,
    methodology: {
      weights: WEIGHTS,
      thresholds: { buy: 35, sell: -35 },
      formula: '0.30*SMA + 0.25*RSI + 0.20*ATR-risk + 0.25*Momentum20',
    },
    backtest,
    confidenceInterval95Pct: decision === 'BUY' || decision === 'SELL'
      ? backtest.confidenceInterval95Pct
      : null,
    fundamentalsGate: {
      required: horizon === 'medium' || horizon === 'long',
      verified: fundamentals?.verified === true,
    },
    disclaimer: DISCLAIMER,
  };
}
