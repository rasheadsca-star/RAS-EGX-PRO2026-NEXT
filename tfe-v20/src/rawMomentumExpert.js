const MIN_HISTORY = 80;
const MOMENTUM_SHORT = 20;
const MOMENTUM_LONG = 60;
const TREND_EMA = 50;
const LIQUIDITY_WINDOW = 20;
const MIN_NONZERO_VOLUME_DAYS = 15;
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
      return {
        date: String(row.date || '').slice(0, 10),
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
  const close20 = closes.at(-(MOMENTUM_SHORT + 1));
  const close60 = closes.at(-(MOMENTUM_LONG + 1));
  const ema50 = ema(closes, TREND_EMA);
  const liquidityBars = bars.slice(-LIQUIDITY_WINDOW);
  const nonzeroVolumeDays = liquidityBars.filter(row => row.volume > 0).length;
  const medianTradedValue20 = median(liquidityBars.map(row => row.close * row.volume));

  if (![close, close20, close60, ema50, medianTradedValue20].every(Number.isFinite)) return null;

  const momentum20 = close / close20 - 1;
  const momentum60 = close / close60 - 1;
  const trend50 = close / ema50 - 1;
  const directionEligible = momentum20 > 0 && momentum60 > 0 && trend50 > 0;
  const liquidityEligible = nonzeroVolumeDays >= MIN_NONZERO_VOLUME_DAYS && medianTradedValue20 > 0;

  return {
    ticker: String(document?.ticker || '').toUpperCase(),
    signalDate,
    close,
    momentum20,
    momentum60,
    trend50,
    medianTradedValue20,
    nonzeroVolumeDays,
    directionEligible,
    liquidityEligible,
    eligible: directionEligible && liquidityEligible
  };
}

function percentileRank(sortedValues, value) {
  if (!sortedValues.length) return 0.5;
  let count = 0;
  for (const x of sortedValues) if (x <= value) count++;
  return count / sortedValues.length;
}

export function buildRawMomentumSnapshot(documents, signalDate) {
  const featureRows = documents.map(document => featureRow(document, signalDate)).filter(Boolean);
  const eligible = featureRows.filter(row => row.eligible);

  const distributions = {
    momentum20: eligible.map(row => row.momentum20).sort((a, b) => a - b),
    momentum60: eligible.map(row => row.momentum60).sort((a, b) => a - b),
    trend50: eligible.map(row => row.trend50).sort((a, b) => a - b),
    liquidity: eligible.map(row => row.medianTradedValue20).sort((a, b) => a - b)
  };

  const scored = eligible.map(row => {
    const ranks = {
      momentum20: percentileRank(distributions.momentum20, row.momentum20),
      momentum60: percentileRank(distributions.momentum60, row.momentum60),
      trend50: percentileRank(distributions.trend50, row.trend50),
      liquidity: percentileRank(distributions.liquidity, row.medianTradedValue20)
    };
    const score = 100 * mean(Object.values(ranks));
    return {
      ...row,
      ranks,
      signalScore: Number(score.toFixed(3)),
      confirms: score >= CONFIRMATION_SCORE
    };
  }).sort((a, b) => b.signalScore - a.signalScore || a.ticker.localeCompare(b.ticker));

  return {
    engineId: 'RAW_CROSS_SECTIONAL_MOMENTUM_V1',
    signalDate,
    evidenceClass: 'POINT_IN_TIME_RAW_OHLC_RESEARCH',
    lineageStatus: 'INDEPENDENT',
    family: 'RAW_CROSS_SECTIONAL_MOMENTUM',
    policy: {
      minimumHistorySessions: MIN_HISTORY,
      momentumWindows: [MOMENTUM_SHORT, MOMENTUM_LONG],
      trendEmaSessions: TREND_EMA,
      liquidityWindowSessions: LIQUIDITY_WINDOW,
      minimumNonzeroVolumeDays: MIN_NONZERO_VOLUME_DAYS,
      score: 'equal_weight_cross_sectional_percentiles_mom20_mom60_trend50_liquidity',
      confirmationScoreAtLeast: CONFIRMATION_SCORE,
      outcomeInputs: false
    },
    universe: {
      documents: documents.length,
      featureReady: featureRows.length,
      eligible: eligible.length
    },
    ranked: scored,
    top3: scored.slice(0, 3)
  };
}

export const RAW_MOMENTUM_POLICY = Object.freeze({
  minimumHistorySessions: MIN_HISTORY,
  momentumShort: MOMENTUM_SHORT,
  momentumLong: MOMENTUM_LONG,
  trendEma: TREND_EMA,
  liquidityWindow: LIQUIDITY_WINDOW,
  minimumNonzeroVolumeDays: MIN_NONZERO_VOLUME_DAYS,
  confirmationScore: CONFIRMATION_SCORE
});
