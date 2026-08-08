'use strict';
const clamp = value => Math.max(0, Math.min(100, value));
const round = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null;

function classifyBottomLocation(distanceFromLowPct) {
  if (distanceFromLowPct <= 5) return 'EXTREME_BOTTOM';
  if (distanceFromLowPct <= 15) return 'NEAR_BOTTOM';
  if (distanceFromLowPct <= 30) return 'BOTTOM_ZONE';
  return 'ABOVE_BOTTOM_ZONE';
}

function scoreMetrics(metrics, context = {}) {
  const currentDrawdown = Math.max(0, metrics.drawdownFromAvailableWindowAdjustedHighPct);
  const maximumDecline = Math.max(0, metrics.maximumPeakToTroughDrawdownPct);
  const distanceFromLow = Math.max(0, metrics.distanceFromAvailableWindowAdjustedLowPct);
  const bottomClassification = classifyBottomLocation(distanceFromLow);
  const bottomProximity = clamp(100 - distanceFromLow * 2.8);
  const declineContext = clamp(currentDrawdown * 1.6 + maximumDecline * 0.8);
  const stabilization = clamp(metrics.repeatedLowCount * 12 + Math.min(metrics.bottomDurationSessions, 20) + (metrics.higherLowConfirmation ? 25 : 0));
  const recoveryEvidence = clamp(Math.max(0, metrics.momentum5Pct) * 2 + Math.max(0, metrics.momentum20Pct) * 1.2 + (metrics.higherLowConfirmation ? 25 : 0) + (metrics.rsiRecovery ? 18 : 0) + (metrics.aboveSma20 ? 12 : 0) + (metrics.trendRecovery20Over50 ? 12 : 0) + (metrics.volumeConfirmation ? 10 : 0));
  const strengthScore = clamp(40 + metrics.momentum5Pct * 1.2 + metrics.momentum20Pct * 0.8 + metrics.momentum60Pct * 0.35 + (metrics.aboveSma20 ? 10 : -8) + (metrics.aboveSma50 ? 8 : -5) + (metrics.volumeConfirmation ? 8 : 0) + Number(context.relativeRecoveryStrength || 0) * 0.15);
  let recoveryScore = declineContext * 0.2 + bottomProximity * 0.28 + stabilization * 0.22 + recoveryEvidence * 0.25 + strengthScore * 0.05;
  const warnings = [];
  if (metrics.rsi14 > 80) { recoveryScore -= 8; warnings.push('rsi_extension_above_80'); }
  if (metrics.rsi14 > 90) { recoveryScore -= 17; warnings.push('strong_rsi_extension_above_90'); }
  recoveryScore = clamp(recoveryScore);
  const reversalSignals = [metrics.higherLowConfirmation, metrics.rsiRecovery, metrics.aboveSma20 && metrics.momentum20Pct > 0, metrics.volumeConfirmation].filter(Boolean).length;
  const stabilizationEvidence = metrics.repeatedLowCount >= 2 || metrics.bottomDurationSessions >= 5 || metrics.higherLowConfirmation;
  let recoveryStage = 'NO_RECOVERY';
  if (bottomClassification === 'ABOVE_BOTTOM_ZONE' && reversalSignals >= 2) recoveryStage = 'RECOVERY_EXTENDED';
  else if (recoveryScore >= 72 && reversalSignals >= 3 && metrics.higherLowConfirmation && metrics.trendRecovery20Over50) recoveryStage = 'RECOVERY_CONFIRMED';
  else if (recoveryScore >= 52 && reversalSignals >= 2 && metrics.aboveSma20) recoveryStage = 'EARLY_RECOVERY';
  else if (bottomClassification !== 'ABOVE_BOTTOM_ZONE' && stabilizationEvidence) recoveryStage = 'BOTTOMING';
  const reasons = [`drawdown:${round(currentDrawdown)}%`, `distance_from_low:${round(distanceFromLow)}%`, `maximum_peak_to_trough_decline:${round(maximumDecline)}%`, metrics.higherLowConfirmation ? 'higher_low_confirmed' : 'higher_low_not_confirmed', metrics.rsiRecovery ? 'rsi_recovering' : 'rsi_not_recovering', metrics.volumeConfirmation ? 'volume_confirmed' : 'volume_not_confirmed', metrics.trendRecovery20Over50 ? 'trend_20_over_50' : 'trend_20_not_over_50', ...warnings];
  return { bottomClassification, strengthScore: round(strengthScore), recoveryScore: round(recoveryScore), recoveryStage, reasons };
}
module.exports = { classifyBottomLocation, scoreMetrics };
