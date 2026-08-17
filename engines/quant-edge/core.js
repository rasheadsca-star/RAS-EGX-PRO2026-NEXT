'use strict';

const config = require('./config');

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (a, b) => b ? (a / b) - 1 : 0;
const last = xs => xs[xs.length - 1];

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function atr(bars, period = 14) {
  if (bars.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
  }
  return mean(trs.slice(-period));
}

function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}

function returns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) out.push(pct(bars[i].close, bars[i - 1].close));
  return out;
}

function validateBars(bars) {
  if (!Array.isArray(bars) || bars.length < config.engine.minBars) {
    throw new Error(`QUANT_EDGE_INSUFFICIENT_BARS:${Array.isArray(bars) ? bars.length : 0}`);
  }
  for (const b of bars) {
    for (const k of ['open', 'high', 'low', 'close', 'volume']) {
      if (!Number.isFinite(Number(b[k]))) throw new Error(`QUANT_EDGE_INVALID_BAR:${k}`);
    }
  }
}

function computeFeatures(bars, benchmarkBars = null, sectorBars = null) {
  validateBars(bars);
  const closes = bars.map(b => Number(b.close));
  const vols = bars.map(b => Number(b.volume));
  const r = returns(bars);
  const a = atr(bars, 14);
  const c = last(closes);
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const mom5 = pct(c, closes[closes.length - 6]);
  const mom20 = pct(c, closes[closes.length - 21]);
  const accel = mom5 - pct(closes[closes.length - 6], closes[closes.length - 11]);
  const vol20 = stdev(r.slice(-20)) * Math.sqrt(252);
  const vol5 = stdev(r.slice(-5)) * Math.sqrt(252);
  const avgVol20 = mean(vols.slice(-20));
  const volumeRatio = avgVol20 ? last(vols) / avgVol20 : 0;
  const turnoverProxy = c * avgVol20;
  const trend = c > e20 && e20 > e50 ? 1 : c < e20 && e20 < e50 ? -1 : 0;

  const rel = (ref, lookback = 20) => {
    if (!Array.isArray(ref) || ref.length < lookback + 1) return 0;
    const rr = pct(last(ref).close, ref[ref.length - 1 - lookback].close);
    return mom20 - rr;
  };

  const compression = vol20 > 0 ? clamp(1 - (vol5 / vol20), -1, 1) : 0;
  const liquidityScore = clamp(Math.log10(Math.max(turnoverProxy, 1)) / 9);

  return {
    close: c, atr: a, atrPct: c ? a / c : 0, ema20: e20, ema50: e50,
    momentum5: mom5, momentum20: mom20, acceleration: accel,
    annualizedVol20: vol20, annualizedVol5: vol5, volatilityCompression: compression,
    volumeRatio, liquidityScore, trend,
    relativeStrengthMarket: rel(benchmarkBars),
    relativeStrengthSector: rel(sectorBars),
  };
}

function detectRegime(benchmarkBars) {
  validateBars(benchmarkBars);
  const f = computeFeatures(benchmarkBars);
  const highVol = f.annualizedVol20 > 0.42 || f.atrPct > 0.035;
  if (f.trend < 0 && f.momentum20 < -0.06) return { code: 'RISK_OFF', riskMultiplier: 0.55 };
  if (highVol && f.trend <= 0) return { code: 'HIGH_VOLATILITY', riskMultiplier: 0.60 };
  if (f.trend > 0 && f.momentum20 > 0.04) return { code: 'BULL_TREND', riskMultiplier: 1.00 };
  if (f.trend < 0) return { code: 'BEAR_TREND', riskMultiplier: 0.60 };
  if (f.momentum5 > 0.025 && f.momentum20 <= 0.04) return { code: 'RECOVERY', riskMultiplier: 0.80 };
  return { code: 'SIDEWAYS', riskMultiplier: 0.75 };
}

function scoreStrategies(f, regime) {
  const rs = clamp(0.5 + f.relativeStrengthMarket * 5 + f.relativeStrengthSector * 3);
  const momentum = clamp(0.5 + f.momentum20 * 4 + f.momentum5 * 4 + f.acceleration * 3);
  const volume = clamp((f.volumeRatio - 0.7) / 1.3);
  const trend = f.trend > 0 ? 1 : f.trend === 0 ? 0.45 : 0;
  const volatilityExpansion = clamp((f.volumeRatio - 1) * 0.7 + Math.max(0, -f.volatilityCompression) * 0.4 + 0.35);
  const smartPullback = clamp((f.trend > 0 ? 0.45 : 0) + (f.close <= f.ema20 * 1.025 && f.close >= f.ema20 * 0.965 ? 0.30 : 0) + (f.relativeStrengthMarket > 0 ? 0.15 : 0) + (f.volumeRatio < 1.15 ? 0.10 : 0));
  const scores = [
    { name: 'RELATIVE_STRENGTH_MOMENTUM', score: 100 * (0.32 * rs + 0.30 * momentum + 0.18 * volume + 0.20 * trend) },
    { name: 'VOLATILITY_EXPANSION', score: 100 * (0.28 * rs + 0.30 * volatilityExpansion + 0.22 * volume + 0.20 * trend) },
    { name: 'SMART_PULLBACK', score: 100 * (0.32 * smartPullback + 0.26 * rs + 0.22 * trend + 0.20 * clamp(0.5 + f.momentum20 * 3)) },
  ];
  const penalty = ['RISK_OFF', 'BEAR_TREND'].includes(regime.code) ? 12 : regime.code === 'HIGH_VOLATILITY' ? 8 : 0;
  return scores.map(s => ({ ...s, score: clamp((s.score - penalty) / 100) * 100 })).sort((a, b) => b.score - a.score);
}

function constructTrade(f, regime) {
  const entryLow = f.close - f.atr * config.risk.entryAtrBand;
  const entryHigh = f.close + f.atr * config.risk.entryAtrBand;
  const mid = (entryLow + entryHigh) / 2;
  const rawStop = mid - f.atr * config.risk.atrStopMultiplier;
  const maxRiskStop = mid * (1 - config.risk.maxRiskPct);
  const stop = Math.max(rawStop, maxRiskStop);
  const risk = Math.max(mid - stop, f.close * 0.005);
  return {
    entryZone: [entryLow, entryHigh], stop,
    tp1: mid + risk * config.risk.tp1R,
    tp2: mid + risk * config.risk.tp2R,
    timeStopSessions: Math.max(5, Math.round(config.risk.defaultTimeStopSessions / regime.riskMultiplier)),
    invalidation: stop,
    riskRewardTp1: config.risk.tp1R,
    riskRewardTp2: config.risk.tp2R,
  };
}

module.exports = { clamp, mean, pct, ema, atr, returns, validateBars, computeFeatures, detectRegime, scoreStrategies, constructTrade };
