const MIN_HISTORY = 90;
const FAST_EMA = 20;
const SLOW_EMA = 50;
const TREND_LOOKBACK = 10;
const HIGH_WINDOW = 20;
const LOW_WINDOW = 5;
const LIQUIDITY_WINDOW = 20;
const MIN_NONZERO_VOLUME_DAYS = 15;
const MIN_PULLBACK_DEPTH = 0.02;
const MAX_PULLBACK_DEPTH = 0.12;
const MIN_CLOSE_LOCATION = 0.60;
const CONFIRMATION_SCORE = 70;

function finite(value, fallback = null) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const i = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function adjustedBars(document) {
  return (document?.sessions || [])
    .map(row => {
      const rawClose = finite(row.close);
      const adjustedClose = finite(row.adjustedClose, rawClose);
      if (!(rawClose > 0) || !(adjustedClose > 0)) return null;
      const factor = adjustedClose / rawClose;
      const open = finite(row.open);
      const high = finite(row.high);
      const low = finite(row.low);
      if (!(open > 0) || !(high > 0) || !(low > 0)) return null;
      return {
        date: String(row.date || '').slice(0, 10),
        open: open * factor,
        high: high * factor,
        low: low * factor,
        close: adjustedClose,
        volume: Math.max(0, finite(row.volume, 0))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function featureRow(document, signalDate) {
  const bars = adjustedBars(document).filter(row => row.date <= signalDate);
  if (bars.length < MIN_HISTORY || bars.at(-1)?.date !== signalDate) return null;

  const closes = bars.map(row => row.close);
  const close = closes.at(-1);
  const previousClose = closes.at(-2);
  const fastEma = ema(closes, FAST_EMA);
  const slowEma = ema(closes, SLOW_EMA);
  const slowEmaPrior = ema(closes.slice(0, -TREND_LOOKBACK), SLOW_EMA);
  const high20 = Math.max(...bars.slice(-HIGH_WINDOW).map(row => row.high));
  const low5 = Math.min(...bars.slice(-LOW_WINDOW).map(row => row.low));
  const last = bars.at(-1);
  const range = Math.max(last.high - last.low, 0);
  const closeLocation = range > 0 ? (last.close - last.low) / range : 0.5;
  const pullbackDepth = high20 > 0 ? 1 - close / high20 : null;
  const recoveryFromLow5 = low5 > 0 ? close / low5 - 1 : null;
  const slowTrend = slowEmaPrior > 0 ? slowEma / slowEmaPrior - 1 : null;
  const liquidityBars = bars.slice(-LIQUIDITY_WINDOW);
  const nonzeroVolumeDays = liquidityBars.filter(row => row.volume > 0).length;
  const medianTradedValue20 = median(liquidityBars.map(row => row.close * row.volume));

  if (![close, previousClose, fastEma, slowEma, slowTrend, pullbackDepth, recoveryFromLow5, medianTradedValue20].every(Number.isFinite)) return null;

  const trendEligible = fastEma > slowEma && slowTrend > 0;
  const pullbackEligible = pullbackDepth >= MIN_PULLBACK_DEPTH && pullbackDepth <= MAX_PULLBACK_DEPTH;
  const recoveryEligible = close > previousClose && closeLocation >= MIN_CLOSE_LOCATION;
  const liquidityEligible = nonzeroVolumeDays >= MIN_NONZERO_VOLUME_DAYS && medianTradedValue20 > 0;

  return {
    ticker: String(document?.ticker || '').toUpperCase(),
    signalDate,
    close,
    fastEma,
    slowEma,
    slowTrend,
    pullbackDepth,
    recoveryFromLow5,
    closeLocation,
    medianTradedValue20,
    nonzeroVolumeDays,
    trendEligible,
    pullbackEligible,
    recoveryEligible,
    liquidityEligible,
    eligible: trendEligible && pullbackEligible && recoveryEligible && liquidityEligible
  };
}

function percentileRank(sortedValues, value) {
  if (!sortedValues.length) return 0.5;
  let count = 0;
  for (const x of sortedValues) if (x <= value) count++;
  return count / sortedValues.length;
}

export function buildRawPullbackSnapshot(documents, signalDate) {
  const featureRows = documents.map(document => featureRow(document, signalDate)).filter(Boolean);
  const eligible = featureRows.filter(row => row.eligible);
  const distributions = {
    slowTrend: eligible.map(row => row.slowTrend).sort((a, b) => a - b),
    recoveryFromLow5: eligible.map(row => row.recoveryFromLow5).sort((a, b) => a - b),
    closeLocation: eligible.map(row => row.closeLocation).sort((a, b) => a - b),
    liquidity: eligible.map(row => row.medianTradedValue20).sort((a, b) => a - b)
  };

  const scored = eligible.map(row => {
    const ranks = {
      slowTrend: percentileRank(distributions.slowTrend, row.slowTrend),
      recoveryFromLow5: percentileRank(distributions.recoveryFromLow5, row.recoveryFromLow5),
      closeLocation: percentileRank(distributions.closeLocation, row.closeLocation),
      liquidity: percentileRank(distributions.liquidity, row.medianTradedValue20)
    };
    const score = 100 * mean(Object.values(ranks));
    return { ...row, ranks, signalScore: Number(score.toFixed(3)), confirms: score >= CONFIRMATION_SCORE };
  }).sort((a, b) => b.signalScore - a.signalScore || a.ticker.localeCompare(b.ticker));

  return {
    engineId: 'RAW_TREND_PULLBACK_RECOVERY_V1',
    signalDate,
    evidenceClass: 'POINT_IN_TIME_RAW_OHLC_RESEARCH',
    lineageStatus: 'INDEPENDENT',
    family: 'RAW_TREND_PULLBACK_RECOVERY',
    policy: {
      minimumHistorySessions: MIN_HISTORY,
      fastEmaSessions: FAST_EMA,
      slowEmaSessions: SLOW_EMA,
      slowTrendLookbackSessions: TREND_LOOKBACK,
      pullbackHighWindowSessions: HIGH_WINDOW,
      pullbackDepthRange: [MIN_PULLBACK_DEPTH, MAX_PULLBACK_DEPTH],
      recoveryLowWindowSessions: LOW_WINDOW,
      minimumCloseLocation: MIN_CLOSE_LOCATION,
      liquidityWindowSessions: LIQUIDITY_WINDOW,
      minimumNonzeroVolumeDays: MIN_NONZERO_VOLUME_DAYS,
      score: 'equal_weight_cross_sectional_percentiles_slowTrend_recoveryFromLow5_closeLocation_liquidity',
      confirmationScoreAtLeast: CONFIRMATION_SCORE,
      outcomeInputs: false
    },
    universe: { documents: documents.length, featureReady: featureRows.length, eligible: eligible.length },
    ranked: scored,
    top3: scored.slice(0, 3)
  };
}

export const RAW_PULLBACK_POLICY = Object.freeze({
  minimumHistorySessions: MIN_HISTORY,
  fastEma: FAST_EMA,
  slowEma: SLOW_EMA,
  slowTrendLookback: TREND_LOOKBACK,
  highWindow: HIGH_WINDOW,
  lowWindow: LOW_WINDOW,
  liquidityWindow: LIQUIDITY_WINDOW,
  minimumNonzeroVolumeDays: MIN_NONZERO_VOLUME_DAYS,
  minimumPullbackDepth: MIN_PULLBACK_DEPTH,
  maximumPullbackDepth: MAX_PULLBACK_DEPTH,
  minimumCloseLocation: MIN_CLOSE_LOCATION,
  confirmationScore: CONFIRMATION_SCORE
});