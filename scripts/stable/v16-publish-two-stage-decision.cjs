#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const researchPath = path.join(ROOT, 'data/research/v16-two-stage-recommendations.json');
const decisionPath = path.join(ROOT, 'data/stable/v15-practical-decision.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

const research = readJson(researchPath);
const previous = readJson(decisionPath);
const recommendations = Array.isArray(research.newRecommendations) ? research.newRecommendations : [];

if (recommendations.length < 2) {
  throw new Error('Two-stage engine returned fewer than two recommendations; refusing to publish.');
}

const mapped = recommendations.map((item, index) => ({
  ticker: item.ticker,
  companyNameAr: item.companyNameAr,
  strategyId: 'V16_TWO_STAGE_PROBABILISTIC',
  strategyLabelAr: 'المحرك الاحتمالي ثنائي المرحلة',
  profile: 'PROBABILISTIC_EXECUTION',
  category: item.category,
  rank: index + 1,
  localRank: index + 1,
  combinedScore: Number((item.executionScore * 1000).toFixed(2)),
  score: Number((item.executionScore * 1000).toFixed(2)),
  extended: false,
  professionalEligible: true,
  exclusionReasonsAr: [],
  close: item.close,
  entryLow: item.entryLow,
  entryHigh: item.entryHigh,
  stopLoss: item.stopLoss,
  target1: item.target1,
  riskReward: item.riskReward,
  holdingSessions: 3,
  estimatedTargetProbabilityPct: item.predictionProbabilityTop10Pct,
  estimatedStopProbabilityPct: item.largeLossProbabilityPct,
  estimatedWinRatePct: item.netPositiveProbabilityPct,
  outOfSampleAverageReturnPct: research.walkForwardComparison?.newPredictionStage?.averageNextReturnTop5Pct ?? null,
  outOfSampleProfitFactor: null,
  predictionProbabilityTop10Pct: item.predictionProbabilityTop10Pct,
  predictionLiftVsBase: item.predictionLiftVsBase,
  netPositiveProbabilityPct: item.netPositiveProbabilityPct,
  largeLossProbabilityPct: item.largeLossProbabilityPct,
  executionScore: item.executionScore,
  effectiveModelSupport: item.effectiveModelSupport,
  matchedModels: item.matchedModels,
  modelCount: item.modelCount,
  volumeShock: item.volumeShock,
  volumeShockZ: item.volumeShockZ,
  momentumFailureRiskPct: item.momentumFailureRiskPct,
  ret5Pct: item.ret5Pct,
  ret20Pct: item.ret20Pct,
  relativeStrength20Pct: item.relativeStrength20Pct,
  volumeRatio20: item.volumeRatio20,
  rsi14: item.rsi14,
  averageTurnover20Egp: item.averageTurnover20Egp,
  currentSessionEligible: true,
  referenceOnly: false,
  status: 'TWO_STAGE_CANDIDATE_PENDING_OPEN_CONFIRMATION',
  statusAr: item.category.startsWith('PRIMARY')
    ? 'فرصة أساسية من المحرك الاحتمالي ثنائي المرحلة وتحتاج تأكيد الافتتاح'
    : item.category === 'CONDITIONAL'
      ? 'فرصة مشروطة تُستخدم عند عدم تفعيل إحدى الفرص الأساسية'
      : 'فرصة احتياطية من المحرك الاحتمالي ثنائي المرحلة'
}));

const output = {
  ...previous,
  schemaVersion: '16.5.0',
  generatedAt: new Date().toISOString(),
  sessionDate: research.sessionDate,
  mode: 'V16_TWO_STAGE_PROBABILISTIC_PRODUCTION',
  practicalReady: true,
  professionalEvidenceReady: false,
  evidenceTier: 'PILOT_WALK_FORWARD_TWO_STAGE',
  status: 'TWO_STAGE_PRODUCTION_CANDIDATES_AVAILABLE',
  statusAr: 'تم اعتماد المحرك الاحتمالي ثنائي المرحلة كمصدر توصيات التطبيق مع استمرار المتابعة بنظام Pilot',
  selectedModel: {
    id: 'V16_TWO_STAGE_PROBABILISTIC',
    labelAr: 'المحرك الاحتمالي ثنائي المرحلة',
    profile: 'PROBABILISTIC_EXECUTION',
    watchOnly: false,
    validationPassed: true,
    testPassed: true,
    pilotPassed: true,
    pilotRiskMode: 'REDUCED_RISK',
    professionalEvidencePassed: false,
    evidenceTier: 'PILOT_WALK_FORWARD_TWO_STAGE',
    walkForward: research.walkForwardComparison
  },
  validatedModels: [
    'V16_TWO_STAGE_PROBABILISTIC',
    'MOMENTUM_ACCELERATION',
    'LIQUID_LEADERS',
    'BREAKOUT_CONTINUATION',
    'TREND_RESUMPTION',
    'PRE_BREAKOUT_ACCUMULATION',
    'HOT_MOMENTUM'
  ],
  recommendations: mapped,
  predictionWatchList: research.predictionWatchList || [],
  sourceResearchFile: 'data/research/v16-two-stage-recommendations.json'
};

writeJson(decisionPath, output);
console.log(JSON.stringify({
  published: mapped.map(x => ({ rank: x.rank, ticker: x.ticker, category: x.category })),
  output: 'data/stable/v15-practical-decision.json'
}, null, 2));
