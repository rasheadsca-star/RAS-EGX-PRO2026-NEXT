'use strict';

const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const pctChange = (current, prior) => prior > 0 ? (current / prior - 1) * 100 : null;

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  const slice = values.slice(-(period + 1));
  let gains = 0; let losses = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const delta = slice[i] - slice[i - 1];
    if (delta > 0) gains += delta; else losses -= delta;
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  return 100 - 100 / (1 + gains / losses);
}

function localLows(values) {
  const lows = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (values[i] <= values[i - 1] && values[i] <= values[i + 1]) lows.push({ index: i, value: values[i] });
  }
  return lows;
}

function maximumPeakToTroughDrawdown(values) {
  let peak = values[0]; let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, pctChange(value, peak));
  }
  return Math.abs(worst);
}

function calculateIndicators(sessions, config = {}) {
  const prices = sessions.map(row => Number(row.adjustedClose));
  const volumes = sessions.map(row => Number(row.volume)).filter(Number.isFinite);
  const current = prices.at(-1);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const lowIndex = prices.lastIndexOf(low);
  const lows = localLows(prices);
  const tolerance = Number(config.repeatedLowTolerancePct || 5) / 100;
  const repeatedLowCount = prices.filter(value => value <= low * (1 + tolerance)).length;
  const recentLow = Math.min(...prices.slice(-15));
  const priorLow = Math.min(...prices.slice(-40, -15));
  const higherLowPct = pctChange(recentLow, priorLow);
  const sma20 = average(prices.slice(-20));
  const sma50 = average(prices.slice(-50));
  const currentRsi = rsi(prices, 14);
  const priorRsi = rsi(prices.slice(0, -5), 14);
  const recentVolume = average(volumes.slice(-5));
  const baselineVolume = average(volumes.slice(-25, -5));
  const dated = sessions.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')));
  const coverageDays = dated.length > 1 ? Math.round((new Date(`${dated.at(-1).date}T00:00:00Z`) - new Date(`${dated[0].date}T00:00:00Z`)) / 86400000) : 0;
  const week52Available = sessions.length >= Number(config.minimum52WeekSessions || 200) && coverageDays >= Number(config.minimum52WeekCalendarDays || 330);
  const week52Prices = week52Available ? prices.slice(-252) : [];
  const week52High = week52Available ? Math.max(...week52Prices) : null;
  const week52Low = week52Available ? Math.min(...week52Prices) : null;
  const metrics = {
    availableWindowSessions: prices.length,
    availableWindowAdjustedHigh: round(high),
    availableWindowAdjustedLow: round(low),
    currentAdjustedPrice: round(current),
    drawdownFromAvailableWindowAdjustedHighPct: round((high - current) / high * 100),
    maximumPeakToTroughDrawdownPct: round(maximumPeakToTroughDrawdown(prices)),
    distanceFromAvailableWindowAdjustedLowPct: round(pctChange(current, low)),
    bottomDurationSessions: prices.length - 1 - lowIndex,
    repeatedLowCount,
    localLowCount: lows.length,
    higherLowConfirmation: Number.isFinite(higherLowPct) && higherLowPct >= Number(config.higherLowMinimumPct || 2),
    higherLowPct: round(higherLowPct),
    momentum5Pct: round(pctChange(current, prices.at(-6))),
    momentum20Pct: round(pctChange(current, prices.at(-21))),
    momentum60Pct: round(pctChange(current, prices.at(-61))),
    sma20: round(sma20),
    sma50: round(sma50),
    aboveSma20: current > sma20,
    aboveSma50: current > sma50,
    trendRecovery20Over50: sma20 > sma50,
    rsi14: round(currentRsi, 2),
    rsiRecovery: Number.isFinite(currentRsi) && Number.isFinite(priorRsi) && currentRsi > priorRsi && priorRsi < 50,
    rsiChange5: round(currentRsi - priorRsi, 2),
    volumeExpansionRatio: baselineVolume > 0 ? round(recentVolume / baselineVolume) : null,
    volumeConfirmation: baselineVolume > 0 && recentVolume / baselineVolume >= Number(config.volumeExpansionMinimum || 1.2),
  };
  metrics.horizons = {
    shortWindow: { available: true, sessions: prices.length, high: metrics.availableWindowAdjustedHigh, low: metrics.availableWindowAdjustedLow, drawdownFromHighPct: metrics.drawdownFromAvailableWindowAdjustedHighPct, distanceFromLowPct: metrics.distanceFromAvailableWindowAdjustedLowPct },
    week52: { available: week52Available, sessions: week52Prices.length, high: round(week52High), low: round(week52Low), drawdownFromHighPct: week52Available ? round((week52High - current) / week52High * 100) : null, distanceFromLowPct: week52Available ? round(pctChange(current, week52Low)) : null, unavailableReason: week52Available ? null : 'INSUFFICIENT_52_WEEK_COVERAGE' },
    year3: { available: false, high: null, low: null, unavailableReason: 'PENDING_V17_LONG_HORIZON_STORE' },
    year5: { available: false, high: null, low: null, unavailableReason: 'PENDING_V17_LONG_HORIZON_STORE' },
    fullHistory: { available: false, high: null, low: null, unavailableReason: 'PENDING_V17_LONG_HORIZON_STORE' },
  };
  return metrics;
}

module.exports = { calculateIndicators, rsi };
