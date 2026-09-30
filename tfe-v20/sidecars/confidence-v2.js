import { clamp, round, sma, atr } from '../src/math.js';

export const CONFIDENCE_V2_POLICY = Object.freeze({
  priorTargetMean: 0.50,
  priorPositiveMean: 0.50,
  priorStrength: 12,
  fullSampleTrades: 30,
  moderateSampleTrades: 15,
  minimumEvaluatedTrades: 5,
  regimeFullSampleTrades: 15,
  minimumWalkForwardTrades: 8,
  maxWalkForwardFolds: 4,
  weights: Object.freeze({
    dataQuality: 0.25,
    setupQuality: 0.25,
    historicalEvidence: 0.30,
    regimeFit: 0.10,
    walkForwardStability: 0.10,
  }),
});

const finite = (v) => Number.isFinite(Number(v));
const num = (v) => finite(v) ? Number(v) : null;
const pct = (v) => round(clamp(v), 1);

function mean(values = []) {
  const xs = values.filter(finite).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function stdev(values = []) {
  const xs = values.filter(finite).map(Number);
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function bayesianRate(hits, n, priorMean = 0.5, priorStrength = 12) {
  const h = Math.max(0, Number(hits) || 0);
  const total = Math.max(0, Number(n) || 0);
  return (h + priorMean * priorStrength) / (total + priorStrength);
}

function profitFactorScore(value) {
  if (value === 'INF') return 100;
  const v = num(value);
  if (v === null) return 50;
  if (v <= 0.5) return 20;
  if (v <= 1) return 20 + (v - 0.5) * 60;
  if (v <= 1.5) return 50 + (v - 1) * 50;
  if (v <= 2.5) return 75 + (v - 1.5) * 20;
  return 95;
}

function expectancyScore(avgNetPct) {
  const v = num(avgNetPct);
  return v === null ? 50 : clamp(50 + v * 12);
}

function setupQuality(analysis = {}) {
  const s = analysis.scores || {};
  const rr = num(analysis.tradePlan?.structuralNetRR);
  const alignment = analysis.tradePlan?.alignmentState;
  const alignScore = ({
    IN_ENTRY_RANGE: 100,
    NEAR_ENTRY_PULLBACK: 88,
    PENDING_PULLBACK: 72,
    DO_NOT_CHASE: 20,
    BELOW_ENTRY_WAIT: 18,
  })[alignment] ?? 45;
  const rrScore = rr === null ? 40 : clamp(rr / 1.5 * 100);
  const values = {
    research: num(s.research) ?? 0,
    core: num(s.core) ?? 0,
    liquidity: num(s.liquidity) ?? 0,
    supportResistance: num(s.supportResistance) ?? 0,
  };
  return pct(
    0.30 * values.research
    + 0.20 * values.core
    + 0.15 * values.liquidity
    + 0.15 * values.supportResistance
    + 0.10 * rrScore
    + 0.10 * alignScore
  );
}

export function classifyRegime(bars = []) {
  const closes = bars.map((x) => Number(x.close)).filter(Number.isFinite);
  const close = closes.at(-1);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const a = atr(bars, 14);
  if (!(close > 0)) return { trend: 'UNKNOWN', volatility: 'UNKNOWN', label: 'UNKNOWN', atrPct: null };

  let trend = 'NEUTRAL';
  if (ma50 && ma200 && close > ma50 && ma50 > ma200) trend = 'BULL';
  else if (ma50 && ma200 && close < ma50 && ma50 < ma200) trend = 'BEAR';
  else if (ma20 && ma50 && close > ma20 && ma20 > ma50) trend = 'BULL_EARLY';
  else if (ma20 && ma50 && close < ma20 && ma20 < ma50) trend = 'BEAR_EARLY';

  const atrPct = a > 0 ? a / close * 100 : null;
  const volatility = atrPct === null ? 'UNKNOWN' : atrPct >= 4 ? 'HIGH' : atrPct <= 1.5 ? 'LOW' : 'NORMAL';
  return { trend, volatility, label: `${trend}_${volatility}`, atrPct: atrPct === null ? null : round(atrPct, 2) };
}

function tradeRegime(trade, bars, indexByDate) {
  const i = indexByDate.get(String(trade.signalDate || '').slice(0, 10));
  if (!Number.isInteger(i) || i < 19) return null;
  return classifyRegime(bars.slice(0, i + 1));
}

function regimeEvidence({ trades, bars, currentRegime }) {
  if (!trades.length || !bars.length || currentRegime.trend === 'UNKNOWN') {
    return { score: 50, status: 'INSUFFICIENT_SAMPLE', matchedTrades: 0, matchMode: 'NONE', target1PosteriorPct: null, positivePosteriorPct: null };
  }
  const indexByDate = new Map(bars.map((x, i) => [String(x.date || '').slice(0, 10), i]));
  const enriched = trades.map((t) => ({ trade: t, regime: tradeRegime(t, bars, indexByDate) })).filter((x) => x.regime);
  let matched = enriched.filter((x) => x.regime.label === currentRegime.label);
  let matchMode = 'EXACT_TREND_VOLATILITY';
  if (matched.length < 3) {
    matched = enriched.filter((x) => x.regime.trend === currentRegime.trend);
    matchMode = 'TREND_ONLY';
  }
  const n = matched.length;
  if (!n) return { score: 50, status: 'INSUFFICIENT_SAMPLE', matchedTrades: 0, matchMode, target1PosteriorPct: null, positivePosteriorPct: null };
  const t1 = matched.filter((x) => x.trade.outcome === 'TARGET1').length;
  const positive = matched.filter((x) => Number(x.trade.netPct) > 0).length;
  const targetPosterior = bayesianRate(t1, n, CONFIDENCE_V2_POLICY.priorTargetMean, CONFIDENCE_V2_POLICY.priorStrength);
  const positivePosterior = bayesianRate(positive, n, CONFIDENCE_V2_POLICY.priorPositiveMean, CONFIDENCE_V2_POLICY.priorStrength);
  const reliability = Math.min(1, n / CONFIDENCE_V2_POLICY.regimeFullSampleTrades);
  const evidence = (0.65 * targetPosterior + 0.35 * positivePosterior) * 100;
  const score = 50 * (1 - reliability) + evidence * reliability;
  return {
    score: pct(score),
    status: n >= 5 ? 'EVALUATED' : 'DEVELOPING',
    matchedTrades: n,
    matchMode,
    reliability: round(reliability, 2),
    target1PosteriorPct: round(targetPosterior * 100, 1),
    positivePosteriorPct: round(positivePosterior * 100, 1),
  };
}

function walkForwardEvidence(trades = []) {
  const ordered = [...trades].sort((a, b) => String(a.signalDate).localeCompare(String(b.signalDate)));
  const n = ordered.length;
  if (n < CONFIDENCE_V2_POLICY.minimumWalkForwardTrades) {
    return { score: 50, status: 'INSUFFICIENT_SAMPLE', folds: [], tradeCount: n };
  }
  const foldCount = Math.min(CONFIDENCE_V2_POLICY.maxWalkForwardFolds, Math.max(2, Math.floor(n / 4)));
  const folds = [];
  for (let f = 0; f < foldCount; f += 1) {
    const start = Math.floor(f * n / foldCount);
    const end = Math.floor((f + 1) * n / foldCount);
    const xs = ordered.slice(start, end);
    const t1 = xs.filter((x) => x.outcome === 'TARGET1').length;
    const positive = xs.filter((x) => Number(x.netPct) > 0).length;
    folds.push({
      fold: f + 1,
      trades: xs.length,
      target1Pct: xs.length ? round(t1 / xs.length * 100, 1) : null,
      positivePct: xs.length ? round(positive / xs.length * 100, 1) : null,
      avgNetPct: xs.length ? round(xs.reduce((s, x) => s + Number(x.netPct || 0), 0) / xs.length, 2) : null,
    });
  }
  const targetRates = folds.map((x) => x.target1Pct / 100);
  const positiveRates = folds.map((x) => x.positivePct / 100);
  const volatilityPenalty = 100 * (0.65 * stdev(targetRates) + 0.35 * stdev(positiveRates));
  const driftPenalty = folds.length > 1 ? Math.abs((folds.at(-1).target1Pct ?? 50) - (folds[0].target1Pct ?? 50)) * 0.35 : 0;
  const stability = clamp(100 - volatilityPenalty * 1.6 - driftPenalty);
  const level = mean(folds.map((x) => 0.65 * x.target1Pct + 0.35 * x.positivePct)) ?? 50;
  const score = 0.70 * stability + 0.30 * level;
  return { score: pct(score), status: 'EVALUATED', tradeCount: n, foldCount, stabilityPct: pct(stability), folds };
}

function historicalEvidence(historicalConfidence = {}) {
  const trades = Array.isArray(historicalConfidence.trades) ? historicalConfidence.trades : [];
  const n = trades.length || Number(historicalConfidence.historicalTradeCount || 0);
  const t1 = trades.length ? trades.filter((x) => x.outcome === 'TARGET1').length : Math.round((Number(historicalConfidence.target1HitRatePct || 0) / 100) * n);
  const positive = trades.length ? trades.filter((x) => Number(x.netPct) > 0).length : Math.round((Number(historicalConfidence.positivePct || 0) / 100) * n);
  const targetPosterior = bayesianRate(t1, n, CONFIDENCE_V2_POLICY.priorTargetMean, CONFIDENCE_V2_POLICY.priorStrength);
  const positivePosterior = bayesianRate(positive, n, CONFIDENCE_V2_POLICY.priorPositiveMean, CONFIDENCE_V2_POLICY.priorStrength);
  const reliability = Math.min(1, n / CONFIDENCE_V2_POLICY.fullSampleTrades);
  const raw = 0.45 * targetPosterior * 100
    + 0.25 * positivePosterior * 100
    + 0.20 * expectancyScore(historicalConfidence.avgNetPct)
    + 0.10 * profitFactorScore(historicalConfidence.profitFactor);
  const score = 50 * (1 - reliability) + raw * reliability;
  return {
    score: pct(score),
    tradeCount: n,
    sampleReliability: round(reliability, 2),
    target1PosteriorPct: round(targetPosterior * 100, 1),
    positivePosteriorPct: round(positivePosterior * 100, 1),
    wilsonLower95Pct: num(historicalConfidence.confidenceWilsonLower95Pct),
    avgNetPct: num(historicalConfidence.avgNetPct),
    profitFactor: historicalConfidence.profitFactor ?? null,
    stopRatePct: num(historicalConfidence.stopRatePct),
  };
}

function evidenceLevel(n, regimeN, walkForwardStatus) {
  if (n >= 30 && regimeN >= 5 && walkForwardStatus === 'EVALUATED') return 'STRONG';
  if (n >= 15 && walkForwardStatus === 'EVALUATED') return 'MODERATE';
  if (n >= 5) return 'DEVELOPING';
  return 'THIN';
}

function confidenceGrade(score) {
  if (score >= 80) return 'HIGH';
  if (score >= 70) return 'MEDIUM_HIGH';
  if (score >= 60) return 'MEDIUM';
  return 'LOW';
}

export function buildConfidenceV2({ analysis = {}, bars = [], historicalConfidence = null, mode = 'OFFICIAL_CANDIDATE' } = {}) {
  const history = historicalConfidence || {};
  const trades = Array.isArray(history.trades) ? history.trades : [];
  const historical = historicalEvidence(history);
  const currentRegime = classifyRegime(bars);
  const regime = regimeEvidence({ trades, bars, currentRegime });
  const walkForward = walkForwardEvidence(trades);
  const dataQuality = pct(num(analysis.quality?.score) ?? num(analysis.scores?.dataQuality) ?? 50);
  const setup = setupQuality(analysis);
  const w = CONFIDENCE_V2_POLICY.weights;
  const rawOverall = w.dataQuality * dataQuality
    + w.setupQuality * setup
    + w.historicalEvidence * historical.score
    + w.regimeFit * regime.score
    + w.walkForwardStability * walkForward.score;
  const level = evidenceLevel(historical.tradeCount, regime.matchedTrades, walkForward.status);
  const cap = level === 'STRONG' ? 100 : level === 'MODERATE' ? 88 : level === 'DEVELOPING' ? 80 : 72;
  const overall = pct(Math.min(rawOverall, cap));
  return {
    version: 'CONFIDENCE_ENGINE_V2',
    mode,
    scoringImpact: 'NONE',
    recommendationMutationAllowed: false,
    executionAllowed: false,
    overallConfidenceScore: overall,
    confidenceGrade: confidenceGrade(overall),
    evidenceLevel: level,
    evidenceCap: cap,
    calibratedTarget1ProbabilityPct: historical.target1PosteriorPct,
    conservativeTarget1WilsonLower95Pct: historical.wilsonLower95Pct,
    components: {
      dataQuality,
      setupQuality: setup,
      historicalEvidence: historical.score,
      regimeFit: regime.score,
      walkForwardStability: walkForward.score,
    },
    historical,
    regime: { current: currentRegime, ...regime },
    walkForward,
    methodology: {
      smallSampleControl: 'BETA_BINOMIAL_SHRINKAGE_TO_50_PERCENT_PRIOR',
      fullSampleTrades: CONFIDENCE_V2_POLICY.fullSampleTrades,
      probabilityMeaning: 'CALIBRATED_HISTORICAL_T1_RATE_NOT_A_GUARANTEE',
      regimeMethod: 'CURRENT_TREND_VOLATILITY_MATCH_WITH_TREND_ONLY_FALLBACK',
      walkForwardMethod: 'CHRONOLOGICAL_FOLD_STABILITY_OVER_NO_LOOKAHEAD_TRADES',
      officialHardGatesChanged: false,
    },
  };
}
