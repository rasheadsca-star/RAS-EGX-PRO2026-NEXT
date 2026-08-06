#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const championPath = path.join(root, 'data/research/v16-v169-basket-engine.json');
const candidatePath = path.join(root, 'data/v17/challenger-candidate.json');
const outputPath = path.join(root, 'data/v17/challenger-status.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${path.relative(root, filePath)}: ${error.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, filePath);
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const championReport = readJson(championPath);
const championMetrics = championReport.blockedWalkForwardMetrics || {};
const champion = {
  engineId: 'V16_9_EQUAL_WEIGHT_BASKET',
  status: 'ACTIVE_CHAMPION',
  sessions: finite(championMetrics.sessions, 0),
  averageNetReturnPct: finite(championMetrics.averageNetReturnPct),
  sessionWinRatePct: finite(championMetrics.sessionWinRatePct),
  profitFactor: finite(championMetrics.profitFactor),
  maximumDrawdownPct: finite(championMetrics.maximumDrawdownPct),
  transactionCostsPct: 0.6,
  source: 'data/research/v16-v169-basket-engine.json',
};

const candidate = fs.existsSync(candidatePath) ? readJson(candidatePath) : null;
const generatedAt = new Date().toISOString();
const criteria = {
  methodology: 'BLOCKED_WALK_FORWARD_WITH_INDEPENDENT_HOLDOUT',
  minimumSessions: Math.max(30, champion.sessions),
  minimumIndependentHoldoutSessions: 20,
  minimumAverageNetImprovementPctPoints: 0.15,
  minimumProfitFactor: champion.profitFactor,
  minimumSessionWinRatePct: champion.sessionWinRatePct,
  maximumDrawdownMustNotBeWorse: champion.maximumDrawdownPct,
  minimumTransactionCostPct: champion.transactionCostsPct,
  currentSessionResultCannotBeSelectionInput: true,
  futureLeakageForbidden: true,
  automaticPromotionForbidden: true,
};

let result;
if (!candidate) {
  result = {
    schemaVersion: '17.0.0-challenger-gate',
    generatedAt,
    status: 'NO_ELIGIBLE_CHALLENGER',
    statusAr: 'لا يوجد محرك منافس مكتمل الاختبار؛ يظل V16.9 هو المحرك الأساسي دون تعديل.',
    activeEngine: champion.engineId,
    champion,
    challenger: null,
    criteria,
    checks: [],
    promotionAllowed: false,
    nextAction: 'CONTINUE_CHAMPION_AND_COLLECT_NATIVE_V17_EVIDENCE',
  };
} else {
  const metrics = candidate.metrics || {};
  const checks = [
    {
      code: 'VERSIONED_CANDIDATE',
      passed: Boolean(candidate.engineId && candidate.version && candidate.engineId !== champion.engineId),
      actual: `${candidate.engineId || 'missing'}@${candidate.version || 'missing'}`,
    },
    {
      code: 'BLOCKED_WALK_FORWARD_METHOD',
      passed: candidate.methodology === criteria.methodology,
      actual: candidate.methodology || null,
    },
    {
      code: 'MINIMUM_SESSIONS',
      passed: finite(metrics.sessions, 0) >= criteria.minimumSessions,
      actual: finite(metrics.sessions, 0),
      required: criteria.minimumSessions,
    },
    {
      code: 'INDEPENDENT_HOLDOUT',
      passed: finite(candidate.independentHoldoutSessions, 0) >= criteria.minimumIndependentHoldoutSessions,
      actual: finite(candidate.independentHoldoutSessions, 0),
      required: criteria.minimumIndependentHoldoutSessions,
    },
    {
      code: 'AVERAGE_NET_IMPROVEMENT',
      passed: finite(metrics.averageNetReturnPct, -Infinity) >= champion.averageNetReturnPct + criteria.minimumAverageNetImprovementPctPoints,
      actual: finite(metrics.averageNetReturnPct),
      required: round(champion.averageNetReturnPct + criteria.minimumAverageNetImprovementPctPoints),
    },
    {
      code: 'PROFIT_FACTOR_NOT_WORSE',
      passed: finite(metrics.profitFactor, -Infinity) >= criteria.minimumProfitFactor,
      actual: finite(metrics.profitFactor),
      required: criteria.minimumProfitFactor,
    },
    {
      code: 'WIN_RATE_NOT_WORSE',
      passed: finite(metrics.sessionWinRatePct, -Infinity) >= criteria.minimumSessionWinRatePct,
      actual: finite(metrics.sessionWinRatePct),
      required: criteria.minimumSessionWinRatePct,
    },
    {
      code: 'DRAWDOWN_NOT_WORSE',
      passed: finite(metrics.maximumDrawdownPct, -Infinity) >= criteria.maximumDrawdownMustNotBeWorse,
      actual: finite(metrics.maximumDrawdownPct),
      required: criteria.maximumDrawdownMustNotBeWorse,
    },
    {
      code: 'REALISTIC_COSTS',
      passed: finite(candidate.transactionCostsPct, 0) >= criteria.minimumTransactionCostPct,
      actual: finite(candidate.transactionCostsPct, 0),
      required: criteria.minimumTransactionCostPct,
    },
    {
      code: 'NO_FUTURE_LEAKAGE',
      passed: candidate.futureLeakageForbidden === true && candidate.futureLeakageDetected !== true,
      actual: candidate.futureLeakageDetected === true ? 'detected' : candidate.futureLeakageForbidden === true ? 'forbidden' : 'unverified',
    },
    {
      code: 'CURRENT_SESSION_EXCLUDED_FROM_SELECTION',
      passed: candidate.currentSessionUsedForSelection !== true,
      actual: candidate.currentSessionUsedForSelection === true,
    },
  ];
  const passed = checks.every(check => check.passed === true);
  result = {
    schemaVersion: '17.0.0-challenger-gate',
    generatedAt,
    status: passed ? 'CHALLENGER_ELIGIBLE_FOR_SEPARATE_RELEASE_REVIEW' : 'CHALLENGER_REJECTED',
    statusAr: passed
      ? 'المحرك المنافس اجتاز البوابة البحثية، لكنه لن يستبدل المحرك الأساسي تلقائيًا؛ يلزم إصدار منفصل ومراجعة جديدة.'
      : 'المحرك المنافس لم يتفوق بصورة مستقلة وآمنة؛ يظل V16.9 هو المحرك الأساسي.',
    activeEngine: champion.engineId,
    champion,
    challenger: {
      engineId: candidate.engineId || null,
      version: candidate.version || null,
      metrics,
      source: 'data/v17/challenger-candidate.json',
    },
    criteria,
    checks,
    promotionAllowed: false,
    nextAction: passed ? 'CREATE_SEPARATE_VERSIONED_RELEASE_FOR_REVIEW' : 'REJECT_AND_CONTINUE_CHAMPION',
  };
}

writeJsonAtomic(outputPath, result);
console.log(JSON.stringify(result, null, 2));
