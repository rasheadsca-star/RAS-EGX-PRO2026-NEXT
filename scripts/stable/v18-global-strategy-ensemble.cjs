#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const POLICY_PATH = path.join(ROOT, 'data/v18-global-strategy-policy.json');
const STOCK_DIR = path.join(ROOT, 'data/quant/stocks');
const OUT_PATH = path.join(ROOT, 'data/stable/v18-global-strategy-ensemble.json');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(value, 0)));
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}
function latestSession(...docs) {
  return docs
    .map(doc => doc?.sessionDate || doc?.sessionId || doc?.latestMarketSession || doc?.metrics?.sessionDate || null)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

const SOURCE_WEIGHTS = {
  V16_9_BASKET: 40,
  V13_5_PAPER: 34,
  V13_4_PAPER: 32,
  V13_5_WATCH: 27,
  V13_4_WATCH: 25,
  V15_EXTENDED: 22,
  EMA_MACD_CONTINUATION_SHADOW: 24
};

function familyFromStrategy(strategyId) {
  const id = String(strategyId || '').toUpperCase();
  if (id.includes('BREAKOUT')) return 'BREAKOUT';
  if (id.includes('MOMENTUM')) return 'MOMENTUM';
  if (id.includes('TREND') || id.includes('LIQUID_LEADERS')) return 'TREND_CONTINUATION';
  if (id.includes('PULLBACK')) return 'PULLBACK';
  if (id.includes('REVERSAL')) return 'REVERSAL';
  if (id.includes('EMA') || id.includes('MACD')) return 'EMA_MACD';
  if (id.includes('BASKET')) return 'PORTFOLIO_BASKET';
  return 'OTHER';
}

function loadStockDetails() {
  const map = new Map();
  if (!fs.existsSync(STOCK_DIR)) return map;
  for (const file of fs.readdirSync(STOCK_DIR).filter(name => name.endsWith('.json'))) {
    const detail = readJson(path.join(STOCK_DIR, file), null);
    const ticker = safeTicker(detail?.ticker || file.replace(/\.json$/i, ''));
    if (ticker && detail) map.set(ticker, detail);
  }
  return map;
}

function addCandidate(store, raw) {
  const ticker = safeTicker(raw.ticker);
  if (!ticker) return;
  const current = store.get(ticker) || {
    ticker,
    companyNameAr: raw.companyNameAr || '',
    sources: [],
    strategies: [],
    sourceEvidence: [],
    rawScores: [],
    plans: []
  };
  if (!current.companyNameAr && raw.companyNameAr) current.companyNameAr = raw.companyNameAr;
  current.sources.push(raw.source);
  current.strategies.push(raw.strategyId || raw.source);
  current.sourceEvidence.push({
    source: raw.source,
    sourceWeight: SOURCE_WEIGHTS[raw.source] || 15,
    strategyId: raw.strategyId || null,
    strategyLabelAr: raw.strategyLabelAr || null,
    status: raw.status || null,
    score: round(raw.score, 2),
    noteAr: raw.noteAr || null
  });
  if (Number.isFinite(num(raw.score))) current.rawScores.push(num(raw.score));
  if (raw.plan && typeof raw.plan === 'object') current.plans.push(raw.plan);
  store.set(ticker, current);
}

function evaluateEmaMacdContinuation(detail, policy) {
  const i = detail?.indicators || {};
  const latest = detail?.latest || {};
  const cfg = policy.emaMacdContinuation || {};
  const close = num(i.close, num(latest.close));
  const sma20 = num(i.sma20);
  const sma50 = num(i.sma50);
  const macd = num(i.macd);
  const signal = num(i.macdSignal);
  const rsi = num(i.rsi14);
  const atrPct = num(i.atrPct);
  const volumeRatio = num(i.volumeRatio20);
  const turnover = num(i.averageTurnover20Egp);
  const distanceSma20Pct = close > 0 && sma20 > 0 ? (close / sma20 - 1) * 100 : null;

  const conditions = [
    ['closeAboveSma20', 'السعر أعلى SMA20', close > sma20, round(distanceSma20Pct)],
    ['sma20AboveSma50', 'SMA20 أعلى SMA50', sma20 > sma50, `${round(sma20, 3)} > ${round(sma50, 3)}`],
    ['macdAboveSignal', 'MACD أعلى Signal', macd > signal, `${round(macd, 3)} > ${round(signal, 3)}`],
    ['rsiRange', 'RSI داخل النطاق', rsi >= num(cfg.minimumRsi14, 45) && rsi <= num(cfg.maximumRsi14, 72), round(rsi, 1)],
    ['atrRange', 'ATR% داخل النطاق', atrPct >= num(cfg.minimumAtrPct, 1) && atrPct <= num(cfg.maximumAtrPct, 6.5), round(atrPct, 2)],
    ['volumeRatio', 'Relative Volume كافٍ', volumeRatio >= num(cfg.minimumVolumeRatio20, 0.6), round(volumeRatio, 2)],
    ['turnover', 'متوسط قيمة التداول كافٍ', turnover >= num(cfg.minimumAverageTurnover20Egp, 20000000), round(turnover, 0)],
    ['notExtended', 'السهم غير ممتد بعيدًا عن SMA20', distanceSma20Pct <= num(cfg.maximumDistanceAboveSma20Pct, 8), round(distanceSma20Pct, 2)]
  ].map(([id, labelAr, pass, detailValue]) => ({ id, labelAr, pass: Boolean(pass), detail: detailValue }));

  const required = conditions.every(row => row.pass);
  const score = clamp(
    30
      + (close > sma20 && sma20 > sma50 ? 18 : 0)
      + (macd > signal ? 12 : 0)
      + clamp(12 - Math.abs((rsi || 58) - 58) * 0.7, 0, 12)
      + clamp((volumeRatio || 0) * 8, 0, 12)
      + clamp(Math.log10(Math.max(turnover || 1, 1)) * 3 - 16, 0, 8)
      + clamp(8 - Math.max(0, (distanceSma20Pct || 0) - 3), 0, 8),
    0,
    100
  );

  return {
    passed: required,
    score: round(score, 1),
    conditions,
    failedConditions: conditions.filter(row => !row.pass).map(row => row.labelAr),
    snapshot: {
      close: round(close, 3),
      sma20: round(sma20, 3),
      sma50: round(sma50, 3),
      macd: round(macd, 3),
      macdSignal: round(signal, 3),
      rsi14: round(rsi, 1),
      atrPct: round(atrPct, 2),
      volumeRatio20: round(volumeRatio, 2),
      averageTurnover20Egp: round(turnover, 0),
      distanceSma20Pct: round(distanceSma20Pct, 2)
    }
  };
}

function main() {
  const policy = readJson(POLICY_PATH, {});
  const regime = readJson(path.join(ROOT, 'data/stable/v16-market-regime.json'), {});
  const practical = readJson(path.join(ROOT, 'data/stable/v15-practical-decision.json'), {});
  const daily = readJson(path.join(ROOT, 'data/quant/daily-recommendations.json'), {});
  const adaptive = readJson(path.join(ROOT, 'data/quant/adaptive-daily-recommendations.json'), {});
  const stocks = loadStockDetails();
  const store = new Map();

  for (const item of practical.recommendations || []) {
    addCandidate(store, {
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      source: 'V16_9_BASKET',
      strategyId: item.strategyId,
      strategyLabelAr: item.strategyLabelAr,
      status: item.status,
      score: item.estimatedTop10ProbabilityPct ? 70 + item.estimatedTop10ProbabilityPct : 80,
      plan: {
        entryLow: item.entryLow,
        entryHigh: item.entryHigh,
        stopLoss: item.stopLoss,
        target1: item.target1,
        portfolioWeightPct: item.portfolioWeightPct,
        morningConfirmation: item.morningConfirmation
      },
      noteAr: 'عضو في سلة V16.9 Pilot مع تأكيد افتتاح إلزامي.'
    });
  }

  for (const item of practical.extendedMomentumWatch || []) {
    addCandidate(store, {
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      source: 'V15_EXTENDED',
      strategyId: item.strategyId,
      strategyLabelAr: item.strategyLabelAr,
      status: 'EXTENDED_MOMENTUM_WATCH',
      score: 60 + Math.min(20, num(item.volumeRatio20, 0) * 3),
      noteAr: item.reasonAr || 'فرصة مراقبة من ماسح V15.'
    });
  }

  for (const item of daily.paperCandidates || []) {
    addCandidate(store, {
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      source: 'V13_4_PAPER',
      strategyId: item.strategyId,
      strategyLabelAr: item.strategyLabelAr,
      status: item.status,
      score: item.recommendationScore,
      plan: item.plan,
      noteAr: item.reasonAr
    });
  }
  for (const item of daily.watchCandidates || []) {
    addCandidate(store, {
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      source: 'V13_4_WATCH',
      strategyId: item.strategyId,
      strategyLabelAr: item.strategyLabelAr,
      status: item.status,
      score: item.recommendationScore,
      plan: item.plan,
      noteAr: item.reasonAr
    });
  }
  for (const item of adaptive.paperCandidates || []) {
    addCandidate(store, {
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      source: 'V13_5_PAPER',
      strategyId: item.strategyId,
      strategyLabelAr: item.strategyLabelAr,
      status: item.status,
      score: item.recommendationScore,
      plan: item.plan,
      noteAr: item.reasonAr
    });
  }
  for (const item of adaptive.conditionalWatch || []) {
    addCandidate(store, {
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      source: 'V13_5_WATCH',
      strategyId: item.strategyId,
      strategyLabelAr: item.strategyLabelAr,
      status: item.status,
      score: item.recommendationScore,
      plan: item.plan,
      noteAr: item.reasonAr
    });
  }

  let emaMacdEligibleCount = 0;
  for (const [ticker, detail] of stocks.entries()) {
    const ema = evaluateEmaMacdContinuation(detail, policy);
    if (!ema.passed) continue;
    emaMacdEligibleCount += 1;
    addCandidate(store, {
      ticker,
      companyNameAr: detail.companyNameAr,
      source: 'EMA_MACD_CONTINUATION_SHADOW',
      strategyId: 'EMA_MACD_TREND_CONTINUATION',
      strategyLabelAr: 'استمرار اتجاه EMA–MACD',
      status: 'NEXT_SESSION_CONDITIONAL_SHADOW',
      score: ema.score,
      noteAr: 'ليس شرطه تقاطعًا حديثًا؛ يلتقط استمرار الاتجاه القائم مع سيولة ومخاطرة مقبولتين.'
    });
  }

  const sessionId = latestSession(practical, daily, adaptive, regime);
  const regimeRiskOn = ['RISK_ON', 'BULLISH'].includes(String(regime.regime || regime.code || daily.marketRegime?.code || '').toUpperCase());
  const results = [];

  for (const row of store.values()) {
    const detail = stocks.get(row.ticker) || {};
    const i = detail.indicators || {};
    const quality = detail.dataQuality || {};
    const uniqueSources = uniq(row.sources);
    const uniqueStrategies = uniq(row.strategies);
    const maxSourceWeight = Math.max(...row.sourceEvidence.map(x => x.sourceWeight || 0), 0);
    const technicalScore = num(detail.technical?.score, 50);
    const turnover = num(i.averageTurnover20Egp, 0);
    const volumeRatio = num(i.volumeRatio20, 0);
    const historyConfidence = num(quality.averageConfidence, 0);
    const sameSession = !sessionId || detail.sessionId === sessionId;
    const ema = evaluateEmaMacdContinuation(detail, policy);

    const confluenceBonus = Math.min(16, Math.max(0, uniqueSources.length - 1) * 5 + Math.max(0, uniqueStrategies.length - 1) * 2);
    const technicalComponent = clamp(technicalScore * 0.22, 0, 22);
    const liquidityComponent = turnover >= 20000000 ? clamp(Math.log10(Math.max(turnover, 1)) * 4 - 22, 4, 10) : 0;
    const volumeComponent = clamp(volumeRatio * 2.5, 0, 6);
    const regimeComponent = regimeRiskOn ? 8 : String(regime.regime || '').toUpperCase() === 'NEUTRAL' ? 4 : 0;
    const freshnessPenalty = sameSession ? 0 : 15;
    const qualityPenalty = historyConfidence >= 65 ? 0 : historyConfidence > 0 ? 8 : 12;
    const decisionScore = clamp(maxSourceWeight + technicalComponent + liquidityComponent + volumeComponent + confluenceBonus + regimeComponent - freshnessPenalty - qualityPenalty, 0, 100);

    let tier = 'TIER_C_WATCH';
    let decisionLabelAr = 'مراقبة فقط';
    if (uniqueSources.includes('V16_9_BASKET') && sameSession) {
      tier = 'TIER_A_PILOT_NEXT_SESSION';
      decisionLabelAr = 'مرشح Pilot للجلسة التالية — تأكيد الافتتاح إلزامي';
    } else if (
      decisionScore >= num(policy.decision?.tierBConfluenceMinimumScore, 72)
      && uniqueSources.length >= num(policy.decision?.minimumIndependentSourcesForConfluence, 2)
    ) {
      tier = 'TIER_B_CONFLUENCE';
      decisionLabelAr = 'فرصة مشروطة بتوافق أكثر من محرك';
    } else if (ema.passed && decisionScore >= num(policy.decision?.tierBMinimumScore, 65)) {
      tier = 'TIER_B_EMA_MACD_CONTINUATION';
      decisionLabelAr = 'استمرار اتجاه EMA–MACD مشروط';
    }

    const preferredPlan = row.plans.find(plan => plan && (plan.entryLow || plan.entryHigh || plan.stopLoss)) || null;
    results.push({
      rank: null,
      ticker: row.ticker,
      companyNameAr: row.companyNameAr || detail.companyNameAr || row.ticker,
      sessionId: detail.sessionId || sessionId,
      tier,
      decisionLabelAr,
      decisionScore: round(decisionScore, 1),
      sources: uniqueSources,
      strategyFamilies: uniq(uniqueStrategies.map(familyFromStrategy)),
      strategies: uniqueStrategies,
      technical: {
        score: round(technicalScore, 1),
        trendCode: detail.technical?.trendCode || null,
        price: round(detail.latest?.close, 3),
        rsi14: round(i.rsi14, 1),
        macd: round(i.macd, 3),
        macdSignal: round(i.macdSignal, 3),
        volumeRatio20: round(volumeRatio, 2),
        averageTurnover20Egp: round(turnover, 0),
        atrPct: round(i.atrPct, 2)
      },
      emaMacdContinuation: ema,
      dataQuality: {
        sameSession,
        historyConfidence: round(historyConfidence, 1),
        eligibilityStatus: quality.eligibilityStatus || null
      },
      execution: {
        automaticOrders: false,
        nextSessionOpenConfirmationRequired: true,
        preferredPlan,
        noteAr: tier === 'TIER_A_PILOT_NEXT_SESSION'
          ? 'لا تنفيذ إذا خرج الافتتاح من النطاق أو ضعفت السيولة. المرشح غير المنفذ يبقى نقدًا.'
          : 'إشارة دعم قرار/Shadow وليست أمر شراء تلقائي.'
      },
      evidence: row.sourceEvidence
    });
  }

  results.sort((a, b) => b.decisionScore - a.decisionScore || b.sources.length - a.sources.length || a.ticker.localeCompare(b.ticker));
  results.forEach((row, index) => { row.rank = index + 1; });

  const publishLimit = num(policy.decision?.maximumPublishedCandidates, 25);
  const actionable = results.filter(row => row.tier !== 'TIER_C_WATCH').slice(0, publishLimit);
  const watch = results.filter(row => row.tier === 'TIER_C_WATCH').slice(0, publishLimit);
  const zeroSignalWarning = regimeRiskOn && emaMacdEligibleCount >= 2 && actionable.length === 0;

  const output = {
    schemaVersion: '18.0.0-shadow',
    generatedAt: new Date().toISOString(),
    sessionId,
    mode: 'GLOBAL_STRATEGY_ENSEMBLE_SHADOW',
    productionExecutionEnabled: false,
    marketRegime: {
      code: regime.regime || regime.code || daily.marketRegime?.code || null,
      score: regime.score || null,
      labelAr: regime.labelAr || daily.marketRegime?.labelAr || null,
      riskMultiplier: regime.riskMultiplier ?? null
    },
    architecture: {
      principle: 'strategy competition + regime routing + evidence gate + canonical data truth',
      activeFamilies: uniq(results.flatMap(row => row.strategyFamilies)),
      independentSources: uniq(results.flatMap(row => row.sources)),
      emaMacdRole: 'one strategy family inside the ensemble, not the sole market gate'
    },
    counts: {
      canonicalStocksLoaded: stocks.size,
      candidatesMerged: results.length,
      actionableOrConditional: actionable.length,
      watchOnly: results.filter(row => row.tier === 'TIER_C_WATCH').length,
      emaMacdContinuationEligible: emaMacdEligibleCount
    },
    diagnostics: {
      zeroSignalWarning,
      zeroSignalWarningAr: zeroSignalWarning
        ? 'السوق داعم للمخاطرة ويوجد أكثر من سهم يجتاز استمرار EMA–MACD؛ خروج صفر فرص يعني مشكلة في الدمج أو البوابات ويجب ألا يُعرض كحقيقة سوقية.'
        : null,
      canonicalLiquidityTruth: 'Average turnover is read from data/quant/stocks canonical intelligence; no duplicate unit conversion is allowed.',
      evidenceSeparation: 'Backtest/validation/test/forward/pilot states are kept distinct. No historical metric is presented as a guaranteed probability.'
    },
    actionable,
    watch,
    allCandidates: results.slice(0, publishLimit),
    guardrails: policy.risk || {}
  };

  writeJson(OUT_PATH, output);
  console.log(JSON.stringify({
    sessionId: output.sessionId,
    regime: output.marketRegime,
    counts: output.counts,
    top: output.actionable.slice(0, 8).map(row => ({ ticker: row.ticker, tier: row.tier, score: row.decisionScore, sources: row.sources }))
  }, null, 2));
}

main();
