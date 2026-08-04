#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const reportPath = path.join(root, 'data/research/v16-v166-triple-barrier.json');
const decisionPath = path.join(root, 'data/stable/v15-practical-decision.json');

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tempPath, 'utf8'));
  fs.renameSync(tempPath, filePath);
}

function mapCandidate(candidate, rank, report) {
  return {
    ticker: candidate.ticker,
    companyNameAr: candidate.companyNameAr,
    strategyId: 'V16_6_TRIPLE_BARRIER',
    strategyLabelAr: 'محرك Triple-Barrier الاحتمالي',
    profile: 'PRODUCTION_GATED',
    productionEngine: 'V16.6_TRIPLE_BARRIER',
    category: rank === 1 ? 'PRIMARY_1' : 'PRIMARY_2',
    rank,
    localRank: rank,
    combinedScore: Math.round((candidate.qualityScore || 0) * 1000) / 10,
    score: Math.round((candidate.qualityScore || 0) * 1000) / 10,
    extended: false,
    professionalEligible: true,
    exclusionReasonsAr: [],
    close: candidate.close,
    entryLow: candidate.entryLow,
    entryHigh: candidate.entryHigh,
    stopLoss: candidate.stopLoss,
    target1: candidate.target1,
    riskReward: candidate.targetStopRatio,
    holdingSessions: report.methodology?.tripleBarrierHorizonSessions || 3,
    estimatedTargetProbabilityPct: candidate.probabilityTargetPct,
    estimatedStopProbabilityPct: candidate.probabilityStopPct,
    estimatedWinRatePct: candidate.probabilityPositivePct,
    probabilityEntryPct: candidate.probabilityEntryPct,
    probabilityTimeExitPct: candidate.probabilityTimeExitPct,
    expectedValuePct: candidate.expectedValuePct,
    targetStopRatio: candidate.targetStopRatio,
    matchedModels: candidate.matchedModels || [],
    modelCount: (candidate.matchedModels || []).length,
    rsi14: candidate.rsi14,
    volumeRatio20: candidate.volumeRatio20,
    momentumFailureRiskPct: candidate.momentumFailureRiskPct,
    marketRegime: candidate.marketRegime,
    morningConfirmation: candidate.morningConfirmation,
    status: `V16_6_PRIMARY_${rank}_PENDING_OPEN_CONFIRMATION`,
    statusAr: 'اجتاز بوابة الأداء التاريخية؛ التنفيذ فقط بعد تأكيد الافتتاح داخل نطاق الدخول.',
    currentSessionEligible: true,
    referenceOnly: false,
  };
}

const report = readJson(reportPath);
if (!report.schemaVersion) {
  throw new Error('Missing V16.6 report; refusing to overwrite application decision.');
}

const previous = readJson(decisionPath);
const approved = report.productionEligible === true && Array.isArray(report.currentRecommendations);
const recommendations = approved
  ? report.currentRecommendations.slice(0, 2).map((item, index) => mapCandidate(item, index + 1, report))
  : [];

const selectedModel = {
  ...(previous.selectedModel || {}),
  id: 'V16_6_TRIPLE_BARRIER',
  labelAr: 'محرك Triple-Barrier الاحتمالي ببوابة إنتاج',
  profile: approved ? 'PRODUCTION_GATED' : 'CALIBRATION_UNDER_REVIEW',
  watchOnly: !approved,
  validationPassed: approved,
  testPassed: approved,
  pilotPassed: approved,
  professionalEvidencePassed: false,
  evidenceTier: approved ? 'PURGED_WALK_FORWARD_PILOT' : 'MODEL_CALIBRATION_REVIEW',
  pilotRiskMode: approved ? 'REDUCED_RISK_MAX_TWO' : 'RESEARCH_ONLY',
  stabilityLabelAr: approved ? 'اجتاز بوابة الإنتاج التجريبية' : 'المعايرة قيد التصحيح — لا يعني غياب الفرص من السوق',
  stabilityReasonsAr: approved
    ? ['عائد خارج العينة موجب.', 'Profit Factor والتراجع ونسبة الهدف/الوقف اجتازت الحدود المطلوبة.']
    : [
        'التشخيص أثبت وجود فرص رابحة فعلية في كل جلسات الاختبار.',
        'شروط الاحتمال والهدف/الوقف الحالية رفضت جميع الأسهم بسبب خلل في المعايرة.',
        'المرشحون معروضون للبحث فقط إلى أن يتم تصحيح النموذج وإعادة الاختبار.',
      ],
};

const output = {
  ...previous,
  schemaVersion: '16.6.1-calibration-review',
  generatedAt: new Date().toISOString(),
  sessionDate: report.currentSignalDate,
  mode: approved ? 'TRIPLE_BARRIER_PRODUCTION_GATE' : 'TRIPLE_BARRIER_CALIBRATION_REVIEW',
  practicalReady: approved && recommendations.length > 0,
  professionalEvidenceReady: false,
  evidenceTier: approved ? 'PURGED_WALK_FORWARD_PILOT' : 'MODEL_CALIBRATION_REVIEW',
  status: approved ? 'V16_6_GATED_CANDIDATES_AVAILABLE' : 'MODEL_CALIBRATION_UNDER_REVIEW',
  statusAr: approved
    ? 'توجد فرص اجتازت بوابة Triple-Barrier؛ التنفيذ معلق على تأكيد الافتتاح.'
    : 'يوجد في السوق فرص محتملة، لكن معايرة V16.6 الحالية غير صالحة لاختيارها بثقة؛ النتائج معروضة للمراقبة فقط لحين التصحيح.',
  selectedModel,
  validatedModels: approved ? ['V16_6_TRIPLE_BARRIER'] : [],
  recommendations,
  researchWatchlist: (report.currentResearchCandidates || []).slice(0, 10),
  productionGate: {
    engine: report.schemaVersion,
    passed: approved,
    interpretation: approved
      ? 'PRODUCTION_ELIGIBLE'
      : 'MODEL_FAILED_TO_DISCRIMINATE; THIS IS NOT EVIDENCE THAT THE MARKET HAS NO OPPORTUNITIES',
    acceptanceGate: report.acceptanceGate,
    walkForwardMetrics: report.walkForwardMetrics,
    currentSelectionMeta: report.currentSelectionMeta,
  },
};

writeJsonAtomic(decisionPath, output);
console.log(JSON.stringify({
  status: output.status,
  recommendationCount: recommendations.length,
  productionGatePassed: approved,
}, null, 2));
