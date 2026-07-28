#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data/stable/v14-policy.json'),
  historySummary: path.join(ROOT, 'data/history-summary.json'),
  historyDirectory: path.join(ROOT, 'data/history'),
  center: path.join(ROOT, 'data/quant/unified-autonomous-center-v13-14.json'),
  workspace: path.join(ROOT, 'data/quant/daily-decision-workspace-v13-11.json'),
  researchV1320: path.join(ROOT, 'data/research/v13-20-multi-session-results.json'),
  quality: path.join(ROOT, 'data/market-quality-acceptance-v13-17-1.json'),
  marketQuality: path.join(ROOT, 'data/market-quality-report.json'),
  readiness: path.join(ROOT, 'data/production-readiness-v13-17-1.json'),
  freshness: path.join(ROOT, 'data/quant/freshness-operating-state-v13-17-1.json'),
  forward: path.join(ROOT, 'data/stable/v14-forward-sessions.json'),
  output: path.join(ROOT, 'data/stable/v14-stable-decision.json'),
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

const arr = value => Array.isArray(value) ? value : [];
const num = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ticker = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
const dateOnly = value => (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const mean = values => {
  const clean = arr(values).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
const median = values => {
  const clean = arr(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
};
const sum = values => arr(values).filter(Number.isFinite).reduce((total, value) => total + value, 0);
const unique = values => [...new Set(arr(values).filter(Boolean))];

function normaliseRows(document) {
  const rows = Array.isArray(document)
    ? document
    : arr(document?.sessions).length
      ? document.sessions
      : arr(document?.rows).length
        ? document.rows
        : arr(document?.history);

  return arr(rows)
    .map(row => ({
      date: dateOnly(row?.date || row?.sessionDate || row?.session),
      open: num(row?.open),
      high: num(row?.high),
      low: num(row?.low),
      close: num(row?.close),
      volume: num(row?.volume, 0),
    }))
    .filter(row => row.date && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function average(values) {
  return mean(values);
}

function sma(rows, endIndex, length, key = 'close') {
  if (endIndex - length + 1 < 0) return null;
  return average(rows.slice(endIndex - length + 1, endIndex + 1).map(row => num(row[key])).filter(Number.isFinite));
}

function rsi(rows, endIndex, length = 14) {
  if (endIndex - length < 0) return null;
  let gains = 0;
  let losses = 0;
  for (let index = endIndex - length + 1; index <= endIndex; index += 1) {
    const change = rows[index].close - rows[index - 1].close;
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const averageGain = gains / length;
  const averageLoss = losses / length;
  if (averageLoss === 0) return 100;
  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

function atr(rows, endIndex, length = 14) {
  if (endIndex - length + 1 < 1) return null;
  const values = [];
  for (let index = endIndex - length + 1; index <= endIndex; index += 1) {
    const current = rows[index];
    const previousClose = rows[index - 1].close;
    values.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    ));
  }
  return average(values);
}

function featureAt(rows, index) {
  if (index < 59) return null;
  const close = rows[index].close;
  const sma20 = sma(rows, index, 20);
  const sma50 = sma(rows, index, 50);
  const rsi14 = rsi(rows, index, 14);
  const atr14 = atr(rows, index, 14);
  const averageVolume20 = sma(rows, index - 1, 20, 'volume');
  const averageTurnover20 = average(
    rows.slice(index - 19, index + 1).map(row => row.close * row.volume),
  );
  const volumeRatio20 = averageVolume20 > 0 ? rows[index].volume / averageVolume20 : null;
  const momentum5Pct = rows[index - 5]?.close > 0
    ? ((close / rows[index - 5].close) - 1) * 100
    : null;
  const return1Pct = rows[index - 1]?.close > 0
    ? ((close / rows[index - 1].close) - 1) * 100
    : null;

  return {
    date: rows[index].date,
    index,
    close,
    sma20,
    sma50,
    rsi14,
    atr14,
    averageVolume20,
    averageTurnover20,
    volumeRatio20,
    momentum5Pct,
    return1Pct,
    bullishTrend: close > sma20 && sma20 > sma50,
  };
}

function loadHistories(summary) {
  if (!fs.existsSync(FILES.historyDirectory)) throw new Error('Missing data/history directory');
  const references = arr(summary?.symbols)
    .filter(item => item?.ticker && item?.sourceFile)
    .map(item => ({ ticker: ticker(item.ticker), sourceFile: item.sourceFile }));

  const fallbackReferences = references.length
    ? []
    : fs.readdirSync(FILES.historyDirectory)
      .filter(name => name.endsWith('.json'))
      .map(name => ({ ticker: ticker(name.replace(/\.json$/i, '')), sourceFile: `data/history/${name}` }));

  const histories = new Map();
  for (const reference of [...references, ...fallbackReferences]) {
    if (!reference.ticker || histories.has(reference.ticker)) continue;
    const rows = normaliseRows(readJson(path.join(ROOT, reference.sourceFile), null));
    if (rows.length >= 20) histories.set(reference.ticker, rows);
  }
  return histories;
}

function buildFeatureStore(histories) {
  const featuresByTicker = new Map();
  const dateStats = new Map();

  for (const [symbol, rows] of histories.entries()) {
    const features = [];
    for (let index = 59; index < rows.length; index += 1) {
      const feature = featureAt(rows, index);
      if (!feature) continue;
      features.push(feature);
      const state = dateStats.get(feature.date) || { total: 0, bullish: 0, positive: 0 };
      state.total += 1;
      if (feature.bullishTrend) state.bullish += 1;
      if (num(feature.return1Pct, 0) > 0) state.positive += 1;
      dateStats.set(feature.date, state);
    }
    featuresByTicker.set(symbol, features);
  }

  const regimes = new Map();
  for (const [date, state] of dateStats.entries()) {
    const breadth = state.total ? state.bullish / state.total * 100 : 0;
    const positive = state.total ? state.positive / state.total * 100 : 0;
    let code = 'SIDEWAYS';
    let labelAr = 'سوق عرضي';
    if (breadth >= 55 && positive >= 52) {
      code = 'BULL';
      labelAr = 'سوق صاعد';
    } else if (breadth <= 35 || positive <= 40) {
      code = 'BEAR';
      labelAr = 'سوق هابط أو دفاعي';
    }
    regimes.set(date, {
      code,
      labelAr,
      breadthPct: round(breadth, 1),
      positiveBreadthPct: round(positive, 1),
      symbols: state.total,
    });
  }

  return { featuresByTicker, regimes };
}

function validPlan(plan) {
  return num(plan?.entryLow, 0) > 0
    && num(plan?.entryHigh, 0) >= num(plan?.entryLow, 0)
    && num(plan?.stopLoss, 0) > 0
    && num(plan?.entryLow, 0) > num(plan?.stopLoss, 0)
    && num(plan?.target1, 0) > num(plan?.entryHigh, 0);
}

function fillPrice(row, plan) {
  if (row.open >= plan.entryLow && row.open <= plan.entryHigh) return row.open;
  if (row.open > plan.entryHigh && row.low <= plan.entryHigh) return plan.entryHigh;
  if (row.open < plan.entryLow && row.high >= plan.entryLow) return plan.entryLow;
  return (plan.entryLow + plan.entryHigh) / 2;
}

function evaluatePlan(rows, signalIndex, plan, policy) {
  const model = policy.historicalModel;
  const costsPct = num(policy.costs?.roundTripPct, 0) + num(policy.costs?.slippagePct, 0);
  const future = rows.slice(signalIndex + 1);
  let entryOffset = -1;
  let entryPrice = null;

  for (let offset = 0; offset < Math.min(model.entryExpirySessions, future.length); offset += 1) {
    const row = future[offset];
    if (row.low <= plan.entryHigh && row.high >= plan.entryLow) {
      entryOffset = offset;
      entryPrice = fillPrice(row, plan);
      break;
    }
  }

  if (entryOffset < 0) {
    return {
      entered: false,
      matured: future.length >= model.entryExpirySessions,
      status: future.length >= model.entryExpirySessions ? 'NOT_ENTERED' : 'PENDING_ENTRY',
      entryDate: null,
      entryPrice: null,
      target1Hit: false,
      stopHit: false,
      target1Session: null,
      stopSession: null,
      horizons: {},
      netReturn5Pct: null,
    };
  }

  const hold = future.slice(entryOffset, entryOffset + model.maximumHoldSessions);
  let firstStop = null;
  let firstTarget = null;
  const path = [];

  for (let offset = 0; offset < hold.length; offset += 1) {
    const row = hold[offset];
    const session = offset + 1;
    const stopHit = row.low <= plan.stopLoss;
    const targetHit = row.high >= plan.target1;

    if (!firstStop && !firstTarget) {
      if (stopHit) firstStop = { session, date: row.date, sameBarTarget: targetHit };
      else if (targetHit) firstTarget = { session, date: row.date };
    }

    const closeReturnPct = ((row.close / entryPrice) - 1) * 100 - costsPct;
    path.push({
      session,
      date: row.date,
      closeReturnPct: round(closeReturnPct, 3),
    });
  }

  const horizons = {};
  for (const horizon of model.horizons) {
    const point = path[horizon - 1];
    if (!point) {
      horizons[horizon] = null;
      continue;
    }
    let event = 'OPEN';
    let realisedReturnPct = point.closeReturnPct;
    if (firstStop && firstStop.session <= horizon) {
      event = 'STOP_HIT';
      realisedReturnPct = ((plan.stopLoss / entryPrice) - 1) * 100 - costsPct;
    } else if (firstTarget && firstTarget.session <= horizon) {
      event = 'TARGET1_HIT';
      realisedReturnPct = ((plan.target1 / entryPrice) - 1) * 100 - costsPct;
    }
    horizons[horizon] = {
      event,
      realisedReturnPct: round(realisedReturnPct, 3),
      closeReturnPct: point.closeReturnPct,
    };
  }

  const primary = horizons[model.primaryHorizonSessions];
  const status = firstStop
    ? 'STOP_HIT'
    : firstTarget
      ? 'TARGET1_HIT'
      : hold.length >= model.maximumHoldSessions
        ? 'EXPIRED'
        : 'OPEN';

  return {
    entered: true,
    matured: Boolean(firstStop || firstTarget || primary),
    status,
    entryDate: hold[0]?.date || null,
    entryPrice: round(entryPrice, 4),
    target1Hit: Boolean(firstTarget),
    stopHit: Boolean(firstStop),
    target1Session: firstTarget?.session || null,
    stopSession: firstStop?.session || null,
    sameBarStopTarget: Boolean(firstStop?.sameBarTarget),
    horizons,
    netReturn5Pct: primary?.realisedReturnPct ?? null,
  };
}

function buildHistoricalEvidence(histories, featureStore, policy) {
  const signals = [];
  const model = policy.historicalModel;

  for (const [symbol, rows] of histories.entries()) {
    const features = featureStore.featuresByTicker.get(symbol) || [];
    let lastSignalIndex = -Infinity;

    for (const feature of features) {
      if (feature.index - lastSignalIndex < model.minimumSpacingSessions) continue;
      if (!feature.bullishTrend) continue;
      if (!(feature.rsi14 >= model.rsiMin && feature.rsi14 <= model.rsiMax)) continue;
      if (!(feature.volumeRatio20 >= model.minimumVolumeRatio20)) continue;
      if (!(feature.momentum5Pct > model.minimumMomentum5Pct)) continue;
      if (!(feature.atr14 > 0)) continue;

      const entryBand = feature.atr14 * model.entryBandAtrMultiple;
      const entryLow = Math.max(0.0001, feature.close - entryBand);
      const entryHigh = feature.close + entryBand;
      const stopLoss = feature.close - feature.atr14 * model.stopAtrMultiple;
      const risk = feature.close - stopLoss;
      const target1 = feature.close + risk * model.targetRiskMultiple;
      const plan = { entryLow, entryHigh, stopLoss, target1 };
      if (!validPlan(plan)) continue;

      const evaluation = evaluatePlan(rows, feature.index, plan, policy);
      const regime = featureStore.regimes.get(feature.date) || {
        code: 'SIDEWAYS', labelAr: 'سوق عرضي', breadthPct: null, positiveBreadthPct: null,
      };

      signals.push({
        id: `hist-${feature.date}-${symbol}`,
        ticker: symbol,
        signalDate: feature.date,
        strategyId: 'v14_trend_liquidity_baseline',
        regimeCode: regime.code,
        rsi14: round(feature.rsi14, 3),
        volumeRatio20: round(feature.volumeRatio20, 3),
        momentum5Pct: round(feature.momentum5Pct, 3),
        averageTurnover20Egp: round(feature.averageTurnover20, 2),
        riskReward1: round((target1 - feature.close) / (feature.close - stopLoss), 3),
        plan: {
          entryLow: round(entryLow, 4),
          entryHigh: round(entryHigh, 4),
          stopLoss: round(stopLoss, 4),
          target1: round(target1, 4),
        },
        ...evaluation,
      });

      lastSignalIndex = feature.index;
    }
  }

  const matured = signals.filter(signal => signal.matured);
  const entered = matured.filter(signal => signal.entered);
  const primary = entered.filter(signal => Number.isFinite(signal.netReturn5Pct));
  const target = primary.filter(signal => signal.horizons?.[policy.historicalModel.primaryHorizonSessions]?.event === 'TARGET1_HIT');
  const stopped = primary.filter(signal => signal.horizons?.[policy.historicalModel.primaryHorizonSessions]?.event === 'STOP_HIT');
  const distinctSessions = unique(matured.map(signal => signal.signalDate));

  const byRegime = {};
  for (const regimeCode of ['BULL', 'SIDEWAYS', 'BEAR']) {
    const subset = primary.filter(signal => signal.regimeCode === regimeCode);
    const successes = subset.filter(signal => signal.horizons?.[5]?.event === 'TARGET1_HIT');
    const stops = subset.filter(signal => signal.horizons?.[5]?.event === 'STOP_HIT');
    byRegime[regimeCode] = {
      sample: subset.length,
      targetRate5Pct: subset.length ? round(successes.length / subset.length * 100, 1) : null,
      stopRate5Pct: subset.length ? round(stops.length / subset.length * 100, 1) : null,
      averageNetReturn5Pct: round(mean(subset.map(signal => signal.netReturn5Pct)), 2),
      medianNetReturn5Pct: round(median(subset.map(signal => signal.netReturn5Pct)), 2),
    };
  }

  return {
    signals,
    summary: {
      generatedSignals: signals.length,
      resolvedSignals: matured.length,
      enteredSignals: entered.length,
      primaryHorizonSample: primary.length,
      distinctHistoricalSessions: distinctSessions.length,
      firstSignalDate: distinctSessions[0] || null,
      lastSignalDate: distinctSessions.at(-1) || null,
      target1Rate5Pct: primary.length ? round(target.length / primary.length * 100, 1) : null,
      stopRate5Pct: primary.length ? round(stopped.length / primary.length * 100, 1) : null,
      averageNetReturn5Pct: round(mean(primary.map(signal => signal.netReturn5Pct)), 2),
      medianNetReturn5Pct: round(median(primary.map(signal => signal.netReturn5Pct)), 2),
      byRegime,
    },
  };
}

function tierOrder(value) {
  const code = String(value || '').toUpperCase();
  if (code.includes('STRICT')) return 0;
  if (code.includes('TIER_A') || code === 'A') return 1;
  if (code.includes('TIER_B') || code === 'B') return 2;
  return 9;
}

function mergeCandidate(existing, incoming) {
  const merged = { ...(existing || {}), ...(incoming || {}) };
  merged.stock = { ...(existing?.stock || {}), ...(incoming?.stock || {}) };
  merged.riskProfile = { ...(existing?.riskProfile || {}), ...(incoming?.riskProfile || {}) };
  merged.plan = { ...(existing?.plan || {}), ...(incoming?.plan || {}) };
  return merged;
}

function collectCandidates(center, workspace) {
  const map = new Map();
  const sources = [
    ...arr(workspace?.candidates),
    ...arr(workspace?.topCandidates),
    workspace?.primaryCandidate,
    ...arr(center?.candidates),
    ...arr(center?.topCandidates),
    center?.primaryCandidate,
  ].filter(Boolean);

  for (const source of sources) {
    const symbol = ticker(source?.ticker || source?.symbol);
    if (!symbol) continue;
    map.set(symbol, mergeCandidate(map.get(symbol), { ...source, ticker: symbol }));
  }

  return [...map.values()];
}

function currentPlan(candidate) {
  const plan = candidate?.plan || candidate?.tradePlan || candidate?.executionPlan || {};
  return {
    entryLow: num(plan.entryLow ?? plan.entryMin ?? candidate?.entryLow),
    entryHigh: num(plan.entryHigh ?? plan.entryMax ?? candidate?.entryHigh),
    stopLoss: num(plan.stopLoss ?? candidate?.stopLoss),
    target1: num(plan.target1 ?? candidate?.target1),
    target2: num(plan.target2 ?? candidate?.target2),
    riskReward1: num(plan.riskReward1 ?? candidate?.riskReward1),
  };
}

function candidateFeatures(candidate, regime) {
  const stock = candidate?.stock || {};
  const plan = currentPlan(candidate);
  const mid = num(plan.entryLow) && num(plan.entryHigh)
    ? (plan.entryLow + plan.entryHigh) / 2
    : num(stock.price ?? candidate?.currentPrice ?? candidate?.price);
  const risk = mid && num(plan.stopLoss) ? mid - plan.stopLoss : null;
  const riskReward1 = num(plan.riskReward1, risk > 0 && num(plan.target1) ? (plan.target1 - mid) / risk : null);

  return {
    regimeCode: regime?.code || 'SIDEWAYS',
    strategyId: String(candidate?.strategyId || 'trend_follow'),
    rsi14: num(stock.rsi14 ?? candidate?.rsi14, 55),
    volumeRatio20: num(stock.volumeRatio20 ?? candidate?.volumeRatio20, 1),
    riskReward1: num(riskReward1, 1.5),
  };
}

function similarityWeight(candidate, signal, policy) {
  const model = policy.historicalModel;
  let weight = 1;
  if (candidate.regimeCode === signal.regimeCode) weight *= model.regimeWeight;
  if (/trend/i.test(candidate.strategyId) && /trend/i.test(signal.strategyId)) weight *= model.strategyWeight;
  weight *= Math.exp(-Math.abs(candidate.rsi14 - signal.rsi14) / model.rsiBandwidth);
  weight *= Math.exp(-Math.abs(Math.log(Math.max(0.05, candidate.volumeRatio20)) - Math.log(Math.max(0.05, signal.volumeRatio20))) / model.volumeRatioBandwidth);
  weight *= Math.exp(-Math.abs(candidate.riskReward1 - signal.riskReward1) / model.riskRewardBandwidth);
  return clamp(weight, 0.02, 8);
}

function estimateCandidate(candidate, historicalSignals, regime, policy) {
  const training = historicalSignals.filter(signal => signal.matured && signal.entered && Number.isFinite(signal.netReturn5Pct));
  const features = candidateFeatures(candidate, regime);
  const weighted = training.map(signal => ({ signal, weight: similarityWeight(features, signal, policy) }));
  const weights = weighted.map(item => item.weight);
  const totalWeight = sum(weights);
  const squaredWeight = sum(weights.map(weight => weight * weight));
  const effectiveSample = squaredWeight > 0 ? (totalWeight * totalWeight) / squaredWeight : 0;
  const globalSuccessRate = training.length
    ? training.filter(signal => signal.horizons?.[5]?.event === 'TARGET1_HIT').length / training.length
    : 0.5;
  const priorStrength = policy.historicalModel.priorStrength;
  const alpha = Math.max(0.5, globalSuccessRate * priorStrength);
  const beta = Math.max(0.5, (1 - globalSuccessRate) * priorStrength);

  let successWeight = 0;
  let stopWeight = 0;
  let weightedReturn = 0;
  let returnWeight = 0;
  const distinctSessions = new Set();

  for (const item of weighted) {
    const event = item.signal.horizons?.[5]?.event;
    if (event === 'TARGET1_HIT') successWeight += item.weight;
    if (event === 'STOP_HIT') stopWeight += item.weight;
    if (Number.isFinite(item.signal.netReturn5Pct)) {
      weightedReturn += item.signal.netReturn5Pct * item.weight;
      returnWeight += item.weight;
    }
    if (item.weight >= 0.25) distinctSessions.add(item.signal.signalDate);
  }

  const probability = (successWeight + alpha) / (totalWeight + alpha + beta);
  const stopProbability = (stopWeight + beta) / (totalWeight + alpha + beta);
  const variance = probability * (1 - probability) / Math.max(1, effectiveSample + priorStrength);
  const margin = 1.96 * Math.sqrt(Math.max(0, variance));
  const expectedNetReturn5Pct = returnWeight > 0 ? weightedReturn / returnWeight : null;

  let confidenceLabelAr = 'منخفضة';
  if (effectiveSample >= 80 && distinctSessions.size >= 40) confidenceLabelAr = 'مرتفعة';
  else if (effectiveSample >= 35 && distinctSessions.size >= 20) confidenceLabelAr = 'متوسطة';

  return {
    targetProbabilityPct: round(probability * 100, 1),
    targetProbabilityLowPct: round(clamp(probability - margin, 0, 1) * 100, 1),
    targetProbabilityHighPct: round(clamp(probability + margin, 0, 1) * 100, 1),
    stopProbabilityPct: round(stopProbability * 100, 1),
    probabilityEdgePct: round((probability - stopProbability) * 100, 1),
    expectedNetReturn5Pct: round(expectedNetReturn5Pct, 2),
    effectiveSample: round(effectiveSample, 1),
    distinctTrainingSessions: distinctSessions.size,
    rawTrainingSignals: training.length,
    confidenceLabelAr,
    modelStatus: training.length ? 'CALIBRATED_HISTORICAL_BASELINE' : 'INSUFFICIENT_HISTORY',
  };
}

function watchScore(candidate) {
  const stock = candidate?.stock || {};
  const risk = candidate?.riskProfile || {};
  const exactFresh = candidate?.exactFresh !== false;
  const hardFailures = num(candidate?.hardFailureCount, arr(candidate?.hardFailures).length || 0);
  const rsi14 = num(stock.rsi14 ?? candidate?.rsi14, 55);
  const overboughtPenalty = Math.max(0, rsi14 - 72) * 2;
  return round(
    (exactFresh ? 40 : -80)
    + (hardFailures === 0 ? 25 : -hardFailures * 35)
    + num(candidate?.decisionScore, 0) * 0.35
    + num(candidate?.recommendationScore, 0) * 0.25
    + num(stock.technicalScore, 0) * 0.18
    + num(risk.liquidityPercentile, 0) * 0.08
    - num(risk.riskScore, 50) * 0.12
    - overboughtPenalty,
    2,
  );
}

function candidateGateReasons(candidate, estimate, context, policy) {
  const reasons = [];
  const qualification = policy.qualification;
  const plan = currentPlan(candidate);
  const stock = candidate?.stock || {};
  const risk = candidate?.riskProfile || {};
  const hardFailures = num(candidate?.hardFailureCount, arr(candidate?.hardFailures).length || 0);
  const allowedTier = policy.allowedRecommendationTiers.includes(candidate?.tier);

  if (!allowedTier) reasons.push('الطبقة B للمراقبة فقط');
  if (qualification.requireExactFresh && candidate?.exactFresh === false) reasons.push('بيانات السهم ليست محدثة لنفس الجلسة');
  if (qualification.requireNoHardFailures && hardFailures > 0) reasons.push(`فشل ${hardFailures} شرط إلزامي`);
  if (qualification.requireValidPlan && !validPlan(plan)) reasons.push('خطة الدخول والوقف والهدف غير مكتملة');
  if (!(estimate.targetProbabilityPct >= qualification.minimumTargetProbabilityPct)) reasons.push(`احتمال الهدف أقل من ${qualification.minimumTargetProbabilityPct}%`);
  if (!(estimate.probabilityEdgePct >= qualification.minimumProbabilityEdgePct)) reasons.push(`أفضلية الهدف على الوقف أقل من ${qualification.minimumProbabilityEdgePct} نقاط`);
  if (!(estimate.stopProbabilityPct <= qualification.maximumStopProbabilityPct)) reasons.push(`احتمال الوقف أعلى من ${qualification.maximumStopProbabilityPct}%`);
  if (!(estimate.expectedNetReturn5Pct >= qualification.minimumExpectedNetReturn5Pct)) reasons.push('العائد المتوقع بعد التكاليف غير موجب بما يكفي');
  if (!(estimate.effectiveSample >= qualification.minimumEffectiveSample)) reasons.push(`العينة الفعالة أقل من ${qualification.minimumEffectiveSample}`);
  if (!(estimate.distinctTrainingSessions >= qualification.minimumDistinctTrainingSessions)) reasons.push(`جلسات التدريب المستقلة أقل من ${qualification.minimumDistinctTrainingSessions}`);
  if (!(num(plan.riskReward1, 0) >= qualification.minimumRiskReward1)) reasons.push(`العائد إلى المخاطرة أقل من ${qualification.minimumRiskReward1}`);
  if (!(num(risk.riskScore, 100) <= qualification.maximumRiskScore)) reasons.push(`درجة المخاطر أعلى من ${qualification.maximumRiskScore}`);
  if (!(num(stock.averageTurnover20Egp ?? risk.averageTurnover20Egp, 0) >= qualification.minimumAverageTurnover20Egp)) reasons.push('متوسط قيمة التداول أقل من الحد التشغيلي');
  if (!(num(risk.liquidityPercentile, 0) >= qualification.minimumLiquidityPercentile)) reasons.push('مرتبة السيولة أقل من الحد التشغيلي');
  if (!context.marketDataReady) reasons.push('بوابة جودة بيانات السوق غير مجتازة');
  if (!context.sessionReady) reasons.push('جلسة السوق غير مؤكدة أو غير متطابقة');
  if (!context.historicalEvidenceReady) reasons.push('قاعدة الاختبار التاريخي لم تصل للحد الأدنى');

  return reasons;
}

function mapWatchCandidate(candidate, estimate, rank) {
  const plan = currentPlan(candidate);
  const stock = candidate?.stock || {};
  const risk = candidate?.riskProfile || {};
  return {
    watchRank: rank,
    ticker: candidate.ticker,
    companyNameAr: candidate.companyNameAr || candidate.nameAr || candidate.companyNameEn || candidate.ticker,
    tier: candidate.tier || 'UNRANKED',
    tierLabelAr: candidate.tierLabelAr || candidate.statusLabelAr || candidate.tier || 'غير مصنف',
    watchScore: watchScore(candidate),
    technicalRank: num(candidate.rank ?? candidate.technicalRank ?? candidate.unifiedRank),
    currentPrice: num(stock.price ?? candidate.currentPrice ?? candidate.price),
    recommendationScore: num(candidate.recommendationScore),
    decisionScore: num(candidate.decisionScore),
    riskScore: num(risk.riskScore),
    riskLabelAr: risk.riskLabelAr || risk.riskCode || 'غير محدد',
    liquidityPercentile: num(risk.liquidityPercentile),
    averageTurnover20Egp: num(stock.averageTurnover20Egp ?? risk.averageTurnover20Egp),
    rsi14: num(stock.rsi14 ?? candidate.rsi14),
    volumeRatio20: num(stock.volumeRatio20 ?? candidate.volumeRatio20),
    exactFresh: candidate.exactFresh !== false,
    planValid: validPlan(plan),
    plan,
    probability: estimate,
    status: 'WATCH_ONLY',
    statusAr: 'تحت المراقبة — ليست أمر شراء',
  };
}

function evaluateForwardSnapshot(snapshot, histories, policy) {
  const results = [];
  for (const recommendation of arr(snapshot?.researchQualified)) {
    const rows = histories.get(ticker(recommendation.ticker)) || [];
    const signalIndex = rows.findIndex(row => row.date === snapshot.sessionDate);
    if (signalIndex < 0 || !validPlan(recommendation.plan)) {
      results.push({ ticker: recommendation.ticker, matured: false, status: 'DATA_PENDING' });
      continue;
    }
    const evaluation = evaluatePlan(rows, signalIndex, recommendation.plan, policy);
    results.push({ ticker: recommendation.ticker, ...evaluation });
  }
  const matured = results.length > 0 && results.every(item => item.matured || item.status === 'NOT_ENTERED');
  return { matured, results };
}

function updateForwardLedger(existing, currentSnapshot, histories, policy) {
  const ledger = existing && typeof existing === 'object'
    ? existing
    : { schemaVersion: '14.0.0', sessions: [] };
  const sessions = arr(ledger.sessions).filter(item => item?.sessionDate);
  const currentIndex = sessions.findIndex(item => item.sessionDate === currentSnapshot.sessionDate);
  if (currentIndex >= 0) sessions[currentIndex] = { ...sessions[currentIndex], ...currentSnapshot };
  else sessions.push(currentSnapshot);
  sessions.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));

  for (const session of sessions) {
    session.evaluation = evaluateForwardSnapshot(session, histories, policy);
  }

  const completed = sessions.filter(session => session.sessionDate !== currentSnapshot.sessionDate && session.evaluation?.matured);
  const recommendations = completed.flatMap(session => arr(session.evaluation?.results));
  const entered = recommendations.filter(item => item.entered);
  const primary = entered.filter(item => item.horizons?.[5]);
  const target = primary.filter(item => item.horizons[5].event === 'TARGET1_HIT');
  const stopped = primary.filter(item => item.horizons[5].event === 'STOP_HIT');

  return {
    schemaVersion: '14.0.0',
    updatedAt: new Date().toISOString(),
    sessions: sessions.slice(-120),
    summary: {
      registeredSessions: sessions.length,
      completedForwardSessions: completed.length,
      evaluatedRecommendations: recommendations.length,
      enteredRecommendations: entered.length,
      targetRate5Pct: primary.length ? round(target.length / primary.length * 100, 1) : null,
      stopRate5Pct: primary.length ? round(stopped.length / primary.length * 100, 1) : null,
      averageNetReturn5Pct: round(mean(primary.map(item => item.netReturn5Pct)), 2),
    },
  };
}

function progress(current, target) {
  return {
    current,
    target,
    pct: target > 0 ? round(clamp(current / target * 100, 0, 100), 1) : 100,
    passed: current >= target,
  };
}

function main() {
  const policy = readJson(FILES.policy);
  if (!policy) throw new Error('Missing data/stable/v14-policy.json');

  const summary = readJson(FILES.historySummary, {});
  const center = readJson(FILES.center, {});
  const workspace = readJson(FILES.workspace, {});
  const researchV1320 = readJson(FILES.researchV1320, {});
  const quality = readJson(FILES.quality, {});
  const marketQuality = readJson(FILES.marketQuality, {});
  const readiness = readJson(FILES.readiness, {});
  const freshness = readJson(FILES.freshness, {});
  const histories = loadHistories(summary);
  const featureStore = buildFeatureStore(histories);
  const historical = buildHistoricalEvidence(histories, featureStore, policy);

  const historyDates = [...featureStore.regimes.keys()].sort();
  const sessionDate = dateOnly(center?.analysisSession)
    || dateOnly(center?.marketDate)
    || dateOnly(workspace?.sessionId)
    || dateOnly(researchV1320?.currentSession?.sessionDate)
    || historyDates.at(-1)
    || null;
  if (!sessionDate) throw new Error('Unable to resolve the current analysis session');

  const currentRegime = featureStore.regimes.get(sessionDate)
    || featureStore.regimes.get(historyDates.filter(date => date <= sessionDate).at(-1))
    || { code: 'SIDEWAYS', labelAr: 'سوق عرضي', breadthPct: null, positiveBreadthPct: null, symbols: 0 };

  const candidates = collectCandidates(center, workspace)
    .filter(candidate => policy.allowedWatchTiers.includes(candidate?.tier));

  const estimates = new Map();
  for (const candidate of candidates) {
    estimates.set(candidate.ticker, estimateCandidate(candidate, historical.signals, currentRegime, policy));
  }

  const sortedWatch = [...candidates].sort((a, b) =>
    tierOrder(a.tier) - tierOrder(b.tier)
    || watchScore(b) - watchScore(a)
    || num(b.decisionScore, 0) - num(a.decisionScore, 0)
    || num(b.recommendationScore, 0) - num(a.recommendationScore, 0)
    || a.ticker.localeCompare(b.ticker)
  );

  const watchlist = sortedWatch
    .slice(0, policy.watchlistSize)
    .map((candidate, index) => mapWatchCandidate(candidate, estimates.get(candidate.ticker), index + 1));

  const marketDataReady = quality?.ok === true
    && quality?.executionGrade === true
    && marketQuality?.accepted !== false;
  const readinessGates = readiness?.gates || {};
  const sessionReady = readinessGates.marketExecutionGrade !== false
    && readinessGates.finalizedCurrentSession !== false
    && readinessGates.sessionIntegrity !== false;
  const targets = policy.evidenceTargets;
  const historicalEvidenceReady = historical.summary.resolvedSignals >= targets.resolvedSignals
    && historical.summary.enteredSignals >= targets.enteredSignals
    && historical.summary.distinctHistoricalSessions >= targets.distinctHistoricalSessions;

  const context = { marketDataReady, sessionReady, historicalEvidenceReady };
  const evaluatedCandidates = sortedWatch
    .filter(candidate => policy.allowedRecommendationTiers.includes(candidate.tier))
    .map(candidate => {
      const estimate = estimates.get(candidate.ticker);
      const reasons = candidateGateReasons(candidate, estimate, context, policy);
      return {
        ...mapWatchCandidate(candidate, estimate, null),
        candidateGatePassed: reasons.length === 0,
        failedGateReasonsAr: reasons,
      };
    })
    .sort((a, b) =>
      num(b.probability?.targetProbabilityPct, 0) - num(a.probability?.targetProbabilityPct, 0)
      || num(b.probability?.expectedNetReturn5Pct, -999) - num(a.probability?.expectedNetReturn5Pct, -999)
      || num(a.probability?.stopProbabilityPct, 100) - num(b.probability?.stopProbabilityPct, 100)
      || num(a.technicalRank, 999) - num(b.technicalRank, 999)
    );

  const researchQualified = evaluatedCandidates
    .filter(candidate => candidate.candidateGatePassed)
    .slice(0, policy.maximumQualifiedRecommendations)
    .map((candidate, index) => ({
      ...candidate,
      recommendationRank: index + 1,
      recommendationLabelAr: ['التوصية الأولى', 'التوصية الثانية', 'التوصية الثالثة'][index],
      status: 'RESEARCH_QUALIFIED',
      statusAr: 'مؤهلة بحثيًا — بانتظار اكتمال الاختبار الأمامي',
    }));

  const currentSnapshot = {
    sessionDate,
    registeredAt: new Date().toISOString(),
    researchQualified: researchQualified.map(item => ({
      ticker: item.ticker,
      recommendationRank: item.recommendationRank,
      plan: item.plan,
      targetProbabilityPct: item.probability?.targetProbabilityPct,
    })),
  };
  const forwardLedger = updateForwardLedger(readJson(FILES.forward, null), currentSnapshot, histories, policy);
  const forwardValidationReady = forwardLedger.summary.completedForwardSessions >= targets.forwardValidationSessions;

  const qualifiedRecommendations = forwardValidationReady
    ? researchQualified.map(item => ({
        ...item,
        status: 'EXECUTION_REVIEW_QUALIFIED',
        statusAr: 'مؤهلة للمراجعة اليدوية المشروطة',
      }))
    : [];

  const nearQualified = evaluatedCandidates
    .filter(candidate => !candidate.candidateGatePassed)
    .slice(0, 5)
    .map(candidate => ({
      ...candidate,
      status: 'NEAR_QUALIFIED',
      statusAr: 'تحت المراقبة — لم تجتز كل البوابات',
    }));

  const evidenceProgress = {
    resolvedSignals: progress(historical.summary.resolvedSignals, targets.resolvedSignals),
    enteredSignals: progress(historical.summary.enteredSignals, targets.enteredSignals),
    historicalSessions: progress(historical.summary.distinctHistoricalSessions, targets.distinctHistoricalSessions),
    forwardSessions: progress(forwardLedger.summary.completedForwardSessions, targets.forwardValidationSessions),
    strongForwardSessions: progress(forwardLedger.summary.completedForwardSessions, targets.strongForwardValidationSessions),
    exactFreshCoverage: progress(num(freshness?.actualExactFreshCoveragePct, 0), targets.exactFreshCoveragePct),
  };

  let modelStage = 'HISTORICAL_EVIDENCE_BUILDING';
  let modelStageAr = 'بناء قاعدة الاختبار التاريخي';
  if (historicalEvidenceReady && !forwardValidationReady) {
    modelStage = 'FORWARD_VALIDATION';
    modelStageAr = 'اختبار أمامي ثابت دون تعديل الأوزان';
  } else if (forwardValidationReady && forwardLedger.summary.completedForwardSessions < targets.strongForwardValidationSessions) {
    modelStage = 'CONTROLLED_PRACTICAL';
    modelStageAr = 'تشغيل عملي مراقب';
  } else if (forwardLedger.summary.completedForwardSessions >= targets.strongForwardValidationSessions) {
    modelStage = 'STABLE_EVIDENCE';
    modelStageAr = 'دليل أمامي مستقر';
  }

  const noTrade = qualifiedRecommendations.length === 0;
  const output = {
    schemaVersion: '14.0.0',
    generatedAt: new Date().toISOString(),
    sessionDate,
    titleAr: 'EGX Pro V14.0 — نظام القرار المستقر',
    mode: 'STABLE_DECISION_SUPPORT',
    system: {
      technicallyStable: true,
      modelStage,
      modelStageAr,
      marketDataReady,
      sessionReady,
      historicalEvidenceReady,
      forwardValidationReady,
      automaticBrokerOrders: false,
      manualBrokerConfirmationRequired: true,
      manualPriceVerificationRequired: true,
    },
    decision: {
      noTrade,
      status: noTrade ? 'NO_QUALIFIED_TRADE' : 'QUALIFIED_RECOMMENDATIONS_AVAILABLE',
      statusAr: noTrade
        ? 'لا توجد توصية شراء مؤهلة حاليًا — الاحتفاظ بالسيولة هو القرار الآمن'
        : `توجد ${qualifiedRecommendations.length} توصية مؤهلة للمراجعة اليدوية المشروطة`,
      qualifiedCount: qualifiedRecommendations.length,
      researchQualifiedCount: researchQualified.length,
      watchlistCount: watchlist.length,
    },
    marketRegime: currentRegime,
    topFiveWatchlist: watchlist,
    qualifiedRecommendations,
    researchQualified,
    nearQualified,
    evidence: {
      historical: historical.summary,
      forward: forwardLedger.summary,
      progress: evidenceProgress,
      methodology: {
        futureLeakageForbidden: true,
        walkForward: true,
        sameBarRule: policy.historicalModel.sameBarRule,
        primaryHorizonSessions: policy.historicalModel.primaryHorizonSessions,
        costsPct: round(num(policy.costs.roundTripPct, 0) + num(policy.costs.slippagePct, 0), 2),
        baselineStrategyAr: 'اتجاه صاعد + زخم إيجابي + سيولة نسبية، مع هدف ووقف متغيرين حسب ATR',
        noteAr: 'القاعدة التاريخية الموسعة للمعايرة والبحث، ولا تفتح التنفيذ الآلي. الاعتماد العملي يتطلب الاختبار الأمامي الثابت.',
      },
    },
    health: {
      qualityGeneratedAt: quality?.generatedAt || marketQuality?.generatedAt || null,
      qualityStatus: quality?.gatewayStatus || marketQuality?.status || null,
      marketRows: num(quality?.marketRows ?? marketQuality?.marketRows),
      ohlcValidPct: num(quality?.quality?.ohlcValidPct ?? marketQuality?.quality?.ohlcValidPct),
      exactFreshCoveragePct: num(freshness?.actualExactFreshCoveragePct),
      exactFreshSymbols: num(freshness?.exactFreshSymbols),
      blockedLaggingSymbols: num(freshness?.blockedLaggingSymbols),
      historySymbols: histories.size,
      historyLatestSession: summary?.latestMarketSession || historyDates.at(-1) || null,
      sourceV1320Session: researchV1320?.currentSession?.sessionDate || null,
    },
    policy: {
      watchlistSize: policy.watchlistSize,
      maximumQualifiedRecommendations: policy.maximumQualifiedRecommendations,
      qualification: policy.qualification,
      evidenceTargets: policy.evidenceTargets,
    },
  };

  writeJsonAtomic(FILES.forward, forwardLedger);
  writeJsonAtomic(FILES.output, output);
  console.log(JSON.stringify({
    version: output.schemaVersion,
    sessionDate,
    histories: histories.size,
    historicalSignals: historical.summary.generatedSignals,
    resolvedSignals: historical.summary.resolvedSignals,
    forwardCompleted: forwardLedger.summary.completedForwardSessions,
    watchlist: watchlist.map(item => item.ticker),
    qualified: qualifiedRecommendations.map(item => item.ticker),
    noTrade,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`V14 stable decision system failed: ${error.stack || error.message}`);
  process.exit(1);
}
