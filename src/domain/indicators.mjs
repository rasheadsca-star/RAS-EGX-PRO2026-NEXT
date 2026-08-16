import { clamp, mean, round } from './math.mjs';

function closes(history) {
  return history.map((bar) => Number(bar.close));
}

export function sma(values, period) {
  if (values.length < period) return null;
  return mean(values.slice(-period));
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  const slice = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const delta = slice[i] - slice[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(history, period = 14) {
  if (history.length < period + 1) return null;
  const rows = history.slice(-(period + 1));
  const ranges = [];
  for (let i = 1; i < rows.length; i += 1) {
    const current = rows[i];
    const previousClose = Number(rows[i - 1].close);
    const high = Number(current.high ?? current.close);
    const low = Number(current.low ?? current.close);
    ranges.push(Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ));
  }
  return mean(ranges);
}

export function rsiRegimeScore(value) {
  if (value < 30) return -60;
  if (value < 50) return -60 + ((value - 30) / 20) * 60;
  if (value <= 65) return ((value - 50) / 15) * 100;
  if (value <= 75) return 100 - ((value - 65) / 10) * 100;
  return -Math.min(100, (value - 75) * 10);
}

export const WEIGHTS = Object.freeze({
  smaTrend: 0.30,
  rsi14: 0.25,
  atr14Risk: 0.20,
  momentum20: 0.25,
});

export function buildFeatures(history) {
  if (!Array.isArray(history) || history.length < 60) {
    throw new Error('INSUFFICIENT_HISTORY_FOR_FEATURES');
  }

  const values = closes(history);
  const close = values.at(-1);
  const sma20 = sma(values, 20);
  const sma50 = sma(values, 50);
  const rsi14 = rsi(values, 14);
  const atr14 = atr(history, 14);
  const close20 = values.at(-21);
  const momentum20 = close / close20 - 1;
  const atrPct = atr14 / close;

  const componentScores = {
    smaTrend: clamp(((sma20 / sma50) - 1) / 0.05, -1, 1) * 100,
    rsi14: clamp(rsiRegimeScore(rsi14), -100, 100),
    atr14Risk: clamp((0.08 - atrPct) / 0.06, -1, 1) * 100,
    momentum20: clamp(momentum20 / 0.15, -1, 1) * 100,
  };

  const finalScore = Object.entries(WEIGHTS).reduce(
    (sum, [key, weight]) => sum + componentScores[key] * weight,
    0,
  );

  return {
    close: round(close),
    sma20: round(sma20),
    sma50: round(sma50),
    rsi14: round(rsi14, 2),
    atr14: round(atr14),
    atrPct: round(atrPct * 100, 2),
    momentum20Pct: round(momentum20 * 100, 2),
    componentScores: Object.fromEntries(
      Object.entries(componentScores).map(([k, v]) => [k, round(v, 2)]),
    ),
    weights: WEIGHTS,
    finalScore: round(finalScore, 2),
  };
}

export function labelFromScore(score) {
  if (score >= 35) return 'BUY';
  if (score <= -35) return 'SELL';
  return 'HOLD';
}
