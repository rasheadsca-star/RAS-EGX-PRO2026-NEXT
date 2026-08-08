'use strict';

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assessAdjustment(item, config = {}) {
  const reasons = [...(item.loaderReasons || [])];
  const threshold = Number(config.splitLikeRawJumpPct || 35);
  let splitLikeDiscontinuity = false;
  for (let i = 1; i < item.sessions.length; i += 1) {
    const previous = item.sessions[i - 1];
    const current = item.sessions[i];
    const rawMove = (Number(current.close) / Number(previous.close) - 1) * 100;
    const adjustedMove = (Number(current.adjustedClose) / Number(previous.adjustedClose) - 1) * 100;
    if (Number.isFinite(rawMove) && Math.abs(rawMove) >= threshold && Number.isFinite(adjustedMove)) {
      splitLikeDiscontinuity = true;
      reasons.push(`split_like_discontinuity:${round(rawMove, 2)}:${round(adjustedMove, 2)}`);
      break;
    }
  }
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    adjustedPriceField: 'adjustedClose',
    adjustedOhlcStatus: 'DERIVED_IF_USED',
    corporateActionEvidence: 'NON_AUTHORITATIVE_SOURCE_REQUIRES_REVIEW',
    splitLikeDiscontinuity,
  };
}

function deriveAdjustedOhlc(session) {
  const close = Number(session.close);
  const adjustedClose = Number(session.adjustedClose);
  if (!(close > 0) || !(adjustedClose > 0)) return null;
  const factor = adjustedClose / close;
  return {
    open: round(Number(session.open) * factor),
    high: round(Number(session.high) * factor),
    low: round(Number(session.low) * factor),
    close: round(adjustedClose),
    adjustmentFactor: round(factor, 8),
    provenance: 'DERIVED',
  };
}

module.exports = { assessAdjustment, deriveAdjustedOhlc };
