const MIN_HISTORY = 60;
const MIN_UNIVERSE = 60;
const EMA20 = 20;
const EMA50 = 50;
const RETURN_LOOKBACK = 20;

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
        close: adjustedClose
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
  const e20 = ema(closes, EMA20);
  const e50 = ema(closes, EMA50);
  const prior20 = closes.at(-(RETURN_LOOKBACK + 1));
  if (![close, e20, e50, prior20].every(Number.isFinite) || !(prior20 > 0)) return null;
  return {
    ticker: String(document?.ticker || '').toUpperCase(),
    close,
    aboveEma20: close > e20,
    aboveEma50: close > e50,
    return20Pct: (close / prior20 - 1) * 100
  };
}

export function buildBreadthRegimeSnapshot(documents, signalDate) {
  const rows = documents.map(document => featureRow(document, signalDate)).filter(Boolean);
  if (rows.length < MIN_UNIVERSE) {
    return {
      engineId: 'RAW_BREADTH_REGIME_EXPOSURE_V1',
      signalDate,
      evidenceClass: 'POINT_IN_TIME_RAW_OHLC_RESEARCH',
      lineageStatus: 'INDEPENDENT',
      featureReady: rows.length,
      regime: 'UNKNOWN',
      supportiveScore: null,
      exposure: 0.5,
      metrics: null
    };
  }

  const breadth20 = rows.filter(row => row.aboveEma20).length / rows.length * 100;
  const breadth50 = rows.filter(row => row.aboveEma50).length / rows.length * 100;
  const positive20 = rows.filter(row => row.return20Pct > 0).length / rows.length * 100;
  const medianReturn20 = median(rows.map(row => row.return20Pct));

  const supportiveScore = [
    breadth20 >= 55,
    breadth50 >= 50,
    positive20 >= 55,
    medianReturn20 >= 0
  ].filter(Boolean).length;

  let regime = 'RISK_OFF';
  let exposure = 0;
  if (supportiveScore >= 3) {
    regime = 'RISK_ON';
    exposure = 1;
  } else if (supportiveScore === 2) {
    regime = 'NEUTRAL';
    exposure = 0.5;
  }

  return {
    engineId: 'RAW_BREADTH_REGIME_EXPOSURE_V1',
    signalDate,
    evidenceClass: 'POINT_IN_TIME_RAW_OHLC_RESEARCH',
    lineageStatus: 'INDEPENDENT',
    featureReady: rows.length,
    regime,
    supportiveScore,
    exposure,
    metrics: {
      breadth20: Number(breadth20.toFixed(3)),
      breadth50: Number(breadth50.toFixed(3)),
      positive20: Number(positive20.toFixed(3)),
      medianReturn20: Number(medianReturn20.toFixed(3))
    }
  };
}

export const BREADTH_REGIME_POLICY = Object.freeze({
  minimumHistorySessions: MIN_HISTORY,
  minimumFeatureReadyUniverse: MIN_UNIVERSE,
  ema20: EMA20,
  ema50: EMA50,
  returnLookback: RETURN_LOOKBACK,
  supportiveThresholds: Object.freeze({ breadth20: 55, breadth50: 50, positive20: 55, medianReturn20: 0 }),
  exposureBySupportiveScore: Object.freeze({ '0': 0, '1': 0, '2': 0.5, '3': 1, '4': 1, unknown: 0.5 }),
  outcomeInputs: false
});