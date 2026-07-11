#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const Q = path.join(ROOT, 'data', 'quant');
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-10-tiered-confidence-policy.json'),
  trace: path.join(Q, 'recommendation-gate-trace-v13-9.json'),
  recommendations: path.join(Q, 'daily-recommendations.json'),
  model: path.join(Q, 'recommendation-model.json'),
  walkForward: path.join(Q, 'walk-forward-results.json'),
  freshness: path.join(Q, 'freshness-coverage-v13-10.json'),
  output: path.join(Q, 'tiered-confidence-recommendations-v13-10.json')
};

function readJson(file, required = false) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (required) throw new Error(`Missing or invalid ${path.relative(ROOT, file)}: ${error.message}`);
    return null;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value)));
}
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
function conditionId(condition) {
  return String(condition?.id || condition?.code || '').trim();
}
function classifyFailures(row, policy) {
  const hardIds = new Set(policy.gates.hardConditionIds || []);
  const softIds = new Set(policy.gates.softConditionIds || []);
  const failed = safeArray(row.conditions).filter(condition => condition.pass !== true);
  const hard = [];
  const soft = [];
  for (const condition of failed) {
    const id = conditionId(condition);
    const target = softIds.has(id) ? soft : hard;
    target.push({
      id,
      labelAr: condition.labelAr || id || 'شرط غير معروف',
      detail: condition.detail ?? null,
      classification: target === soft ? 'soft' : 'hard'
    });
  }
  return { hard, soft };
}
function validPlan(plan) {
  return n(plan?.entryLow) > 0 &&
    n(plan?.entryHigh) >= n(plan?.entryLow) &&
    n(plan?.stopLoss) > 0 &&
    n(plan?.entryHigh) > n(plan?.stopLoss) &&
    n(plan?.target1) > n(plan?.entryLow);
}
function dateValue(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function portfolioMetrics(trades, policy) {
  const p = policy.portfolioValidation;
  const riskPct = n(p.riskPerTradePct, 0.25);
  const maxConcurrent = Math.max(1, n(p.maximumConcurrentTrades, 5));
  const startingEquity = n(p.startingEquity, 100000);
  const normalized = safeArray(trades)
    .filter(trade => trade.status === 'CLOSED' && Number.isFinite(Number(trade.rMultiple)))
    .map((trade, index) => ({
      id: `${trade.ticker || 'T'}-${trade.signalDate || index}-${index}`,
      ticker: trade.ticker,
      entryDate: dateValue(trade.entryDate || trade.signalDate),
      exitDate: dateValue(trade.exitDate),
      rMultiple: n(trade.rMultiple),
      netReturnPct: n(trade.netReturnPct)
    }))
    .filter(trade => trade.entryDate && trade.exitDate && trade.exitDate >= trade.entryDate)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.exitDate.localeCompare(b.exitDate));

  const allDates = [...new Set(normalized.flatMap(trade => [trade.entryDate, trade.exitDate]))].sort();
  const active = [];
  const accepted = [];
  let skippedCapacity = 0;
  let equity = startingEquity;
  let peak = startingEquity;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const equityCurve = [{ date: allDates[0] || null, equity }];

  for (const day of allDates) {
    const exiting = active.filter(position => position.exitDate === day);
    for (const position of exiting) {
      const pnl = position.riskAmount * position.rMultiple;
      equity += pnl;
      if (pnl >= 0) grossProfit += pnl; else grossLoss += Math.abs(pnl);
    }
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].exitDate === day) active.splice(index, 1);
    }

    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 100;
    maxDrawdownPct = Math.max(maxDrawdownPct, dd);
    equityCurve.push({ date: day, equity: round(equity, 2) });

    const entering = normalized.filter(trade => trade.entryDate === day);
    for (const trade of entering) {
      if (active.length >= maxConcurrent) {
        skippedCapacity += 1;
        continue;
      }
      const position = {
        ...trade,
        riskAmount: equity * (riskPct / 100)
      };
      active.push(position);
      accepted.push(position);
    }
  }

  const averageR = accepted.length
    ? accepted.reduce((sum, trade) => sum + trade.rMultiple, 0) / accepted.length
    : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  return {
    acceptedTrades: accepted.length,
    skippedCapacity,
    riskPerTradePct: riskPct,
    maximumConcurrentTrades: maxConcurrent,
    startingEquity: round(startingEquity, 2),
    endingEquity: round(equity, 2),
    totalReturnPct: round(((equity / startingEquity) - 1) * 100, 3),
    profitFactor: round(profitFactor, 3),
    averageR: round(averageR, 3),
    maximumDrawdownPct: round(clamp(maxDrawdownPct, 0, 100), 3),
    method: 'fixed_fractional_risk_portfolio_with_concurrency_limit',
    equityCurve: equityCurve.slice(-50)
  };
}
function validationTradesByStrategy(walkForward) {
  const map = new Map();
  for (const fold of safeArray(walkForward?.folds)) {
    for (const selection of safeArray(fold?.selections)) {
      const id = selection.strategyId;
      if (!id) continue;
      const list = map.get(id) || [];
      list.push(...safeArray(selection.validationTrades));
      map.set(id, list);
    }
  }
  return map;
}
function strategyPass(metrics, policy) {
  const p = policy.portfolioValidation;
  return n(metrics.acceptedTrades) >= n(p.minimumAcceptedTrades)
    && n(metrics.profitFactor) >= n(p.minimumProfitFactor)
    && n(metrics.averageR) >= n(p.minimumAverageR)
    && n(metrics.maximumDrawdownPct, 999) <= n(p.maximumDrawdownPct);
}
function mapCandidate(row, classification, strategyValidation, tier, policy) {
  return {
    ticker: row.ticker,
    companyNameAr: row.companyNameAr || '',
    companyNameEn: row.companyNameEn || '',
    sector: row.sector || 'غير مصنف',
    sessionId: row.sessionId,
    tier,
    status: tier === 'TIER_A_EXPERIMENTAL_PAPER' ? 'EXPERIMENTAL_PAPER' : 'PRIORITY_WATCH',
    statusLabelAr: tier === 'TIER_A_EXPERIMENTAL_PAPER'
      ? policy.tierAExperimentalPaper.labelAr
      : policy.tierBPriorityWatch.labelAr,
    strategyId: row.strategyId,
    strategyLabelAr: row.strategyLabelAr,
    variantId: row.variantId,
    recommendationScore: row.recommendationScore,
    rawSignalScore: row.rawSignalScore,
    hardFailureCount: classification.hard.length,
    softFailureCount: classification.soft.length,
    hardFailures: classification.hard,
    softFailures: classification.soft,
    eligibilityDecision: row.eligibilityDecision === true,
    regimeAllowed: row.regimeAllowed === true,
    marketRegime: row.marketRegime,
    exactFreshSession: row.sessionId,
    price: row.price,
    plan: row.plan,
    indicators: row.indicators,
    portfolioValidation: strategyValidation,
    maximumRiskPerTradePct: tier === 'TIER_A_EXPERIMENTAL_PAPER'
      ? policy.tierAExperimentalPaper.maximumRiskPerTradePct
      : 0,
    automaticRegistration: false,
    liveExecutionEnabled: false,
    reasonAr: tier === 'TIER_A_EXPERIMENTAL_PAPER'
      ? `اجتاز كل البوابات الإلزامية وفشل ${classification.soft.length} شرط مرن فقط. مخصص للتداول الورقي التجريبي منخفض المخاطر.`
      : `اجتاز البوابات الإلزامية لكنه يحتاج تحسن ${classification.soft.length} شرط مرن قبل رفعه إلى الطبقة التجريبية.`
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(FILES.policy, true);
  const trace = readJson(FILES.trace, true);
  const recs = readJson(FILES.recommendations, true);
  const model = readJson(FILES.model, true);
  const walkForward = readJson(FILES.walkForward, true);
  const freshness = readJson(FILES.freshness, true);
  const latestSession = freshness.latestMarketSession || trace.latestMarketSession || recs.sessionId || null;
  const exactFresh = new Set(freshness.exactFreshTickers || []);
  const validationTrades = validationTradesByStrategy(walkForward);

  const strategyValidations = safeArray(model.strategies).map(strategy => {
    const metrics = portfolioMetrics(validationTrades.get(strategy.strategyId) || [], policy);
    return {
      strategyId: strategy.strategyId,
      strategyLabelAr: strategy.strategyLabelAr,
      selectedVariantId: strategy.selectedVariantId,
      originalStatus: strategy.status,
      originalResearchValidated: strategy.researchValidated === true,
      originalValidationMetrics: strategy.validationMetrics || {},
      portfolioMetrics: metrics,
      experimentalPortfolioPass: strategyPass(metrics, policy)
    };
  });
  const strategyMap = new Map(strategyValidations.map(item => [item.strategyId, item]));

  const evaluated = safeArray(trace.rows).filter(row =>
    row.stage !== 'HARD_REJECT' &&
    row.sessionId === latestSession &&
    exactFresh.has(row.ticker)
  );

  const classified = evaluated.map(row => ({
    row,
    classification: classifyFailures(row, policy),
    strategyValidation: strategyMap.get(row.strategyId) || null
  }));

  const tierA = classified
    .filter(item => {
      const p = policy.tierAExperimentalPaper;
      return p.enabled === true
        && item.classification.hard.length <= n(p.maximumHardFailures)
        && item.classification.soft.length <= n(p.maximumSoftFailures)
        && n(item.row.recommendationScore) >= n(p.minimumRecommendationScore)
        && item.row.eligibilityDecision === true
        && item.row.regimeAllowed === true
        && validPlan(item.row.plan)
        && item.strategyValidation?.experimentalPortfolioPass === true
        && item.row.strictPaperAllowed !== true;
    })
    .sort((a, b) =>
      n(b.row.recommendationScore) - n(a.row.recommendationScore)
      || a.classification.soft.length - b.classification.soft.length
      || String(a.row.ticker).localeCompare(String(b.row.ticker))
    )
    .slice(0, n(policy.tierAExperimentalPaper.maximumCandidates))
    .map(item => mapCandidate(item.row, item.classification, item.strategyValidation, 'TIER_A_EXPERIMENTAL_PAPER', policy));

  const tierATickers = new Set(tierA.map(item => item.ticker));
  const tierB = classified
    .filter(item => {
      const p = policy.tierBPriorityWatch;
      return p.enabled === true
        && !tierATickers.has(item.row.ticker)
        && item.classification.hard.length <= n(p.maximumHardFailures)
        && item.classification.soft.length <= n(p.maximumSoftFailures)
        && n(item.row.recommendationScore) >= n(p.minimumRecommendationScore)
        && item.row.eligibilityDecision === true
        && item.row.regimeAllowed === true
        && validPlan(item.row.plan);
    })
    .sort((a, b) =>
      a.classification.soft.length - b.classification.soft.length
      || n(b.row.recommendationScore) - n(a.row.recommendationScore)
      || String(a.row.ticker).localeCompare(String(b.row.ticker))
    )
    .slice(0, n(policy.tierBPriorityWatch.maximumCandidates))
    .map(item => mapCandidate(item.row, item.classification, item.strategyValidation, 'TIER_B_PRIORITY_WATCH', policy));

  const strict = safeArray(recs.paperCandidates);
  const hardFailureCounts = new Map();
  const softFailureCounts = new Map();
  for (const item of classified) {
    for (const failure of item.classification.hard) {
      hardFailureCounts.set(failure.labelAr, (hardFailureCounts.get(failure.labelAr) || 0) + 1);
    }
    for (const failure of item.classification.soft) {
      softFailureCounts.set(failure.labelAr, (softFailureCounts.get(failure.labelAr) || 0) + 1);
    }
  }
  const summarize = map => [...map.entries()]
    .map(([labelAr, count]) => ({ labelAr, count }))
    .sort((a, b) => b.count - a.count || a.labelAr.localeCompare(b.labelAr));

  const output = {
    schemaVersion: '13.10.0',
    generatedAt,
    sessionId: latestSession,
    liveExecutionEnabled: false,
    automaticRegistration: false,
    productionThresholdsChanged: false,
    strictProductionCandidatesOverwritten: false,
    freshness: {
      exactFreshCoveragePct: freshness.exactFreshCoveragePct,
      minimumTargetPct: freshness.minimumTargetPct,
      targetPassed: freshness.targetPassed,
      exactFresh: freshness.counts?.exactFresh || 0,
      decisionHistories: freshness.counts?.decisionHistories || 0,
      lagOneTradingDay: freshness.counts?.lagOneTradingDay || 0,
      lagTwoOrMoreTradingDays: freshness.counts?.lagTwoOrMoreTradingDays || 0
    },
    counts: {
      strictPaperCandidates: strict.length,
      tierAExperimentalPaper: tierA.length,
      tierBPriorityWatch: tierB.length,
      exactFreshEvaluated: evaluated.length,
      strategyPortfolioValidated: strategyValidations.filter(item => item.experimentalPortfolioPass).length
    },
    strictPaperCandidates: strict,
    tierAExperimentalPaper: tierA,
    tierBPriorityWatch: tierB,
    strategyPortfolioValidation: strategyValidations,
    gateDiagnostics: {
      hardFailureSummary: summarize(hardFailureCounts),
      softFailureSummary: summarize(softFailureCounts),
      hardConditionIds: policy.gates.hardConditionIds,
      softConditionIds: policy.gates.softConditionIds
    },
    policy: {
      tierAExperimentalPaper: policy.tierAExperimentalPaper,
      tierBPriorityWatch: policy.tierBPriorityWatch,
      portfolioValidation: policy.portfolioValidation
    },
    safety: policy.safety,
    warningAr: 'الطبقة A وB لا تغير حدود الإنتاج ولا تنفذ أو تسجل صفقات تلقائيًا. أي سهم غير محدث حتى آخر جلسة يظل محجوبًا.'
  };

  writeJson(FILES.output, output);
  console.log(`V13.10 strict=${strict.length}, tierA=${tierA.length}, tierB=${tierB.length}, exactFreshEvaluated=${evaluated.length}`);
}

try { main(); }
catch (error) {
  console.error(`V13.10 confidence engine failed: ${error.stack || error.message}`);
  process.exit(1);
}
