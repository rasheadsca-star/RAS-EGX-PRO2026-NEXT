'use strict';

const { clamp } = require('./core');

class EmpiricalProbabilityCalibrator {
  constructor(buckets = []) { this.buckets = buckets.slice().sort((a, b) => a.minScore - b.minScore); }
  calibrate(score) {
    const b = this.buckets.find(x => score >= x.minScore && score <= x.maxScore && x.samples >= 30);
    if (!b) return { calibrated: false, tp1BeforeSl: null, tp2BeforeSl: null, samples: 0 };
    return { calibrated: true, tp1BeforeSl: b.tp1BeforeSl, tp2BeforeSl: b.tp2BeforeSl, samples: b.samples };
  }
}

function confidenceProxy(features, strategyScore, regime) {
  const regimeQuality = ({ BULL_TREND: 1, RECOVERY: 0.80, SIDEWAYS: 0.65, HIGH_VOLATILITY: 0.45, BEAR_TREND: 0.35, RISK_OFF: 0.20 })[regime.code] ?? 0.5;
  const structure = features.trend > 0 ? 1 : features.trend === 0 ? 0.50 : 0.15;
  const rel = clamp(0.5 + features.relativeStrengthMarket * 5);
  return 100 * clamp(0.48 * (strategyScore / 100) + 0.18 * regimeQuality + 0.14 * structure + 0.12 * rel + 0.08 * features.liquidityScore);
}

function probabilityView(coreConfidence, calibrator) {
  const proxy = clamp(coreConfidence / 100) * 100;
  if (!calibrator) return { calibrated: false, confidenceProxy: proxy, tp1BeforeSl: null, tp2BeforeSl: null, note: 'Requires walk-forward/out-of-sample calibration.' };
  return { confidenceProxy: proxy, ...calibrator.calibrate(coreConfidence) };
}

module.exports = { EmpiricalProbabilityCalibrator, confidenceProxy, probabilityView };
