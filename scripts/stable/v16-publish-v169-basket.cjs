#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const reportPath = path.join(root, 'data/research/v16-v169-basket-engine.json');
const legacyDecisionPath = path.join(root, 'data/stable/v15-practical-decision.json');
const primaryDecisionPath = path.join(root, 'data/stable/v16-v169-primary-decision.json');
const PILOT_ALLOCATION_PCT = 50;

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

const report = readJson(reportPath);
if (!report.schemaVersion) {
  throw new Error('Missing V16.9 basket report; refusing to overwrite application decision.');
}

// The isolated primary file is the authoritative prior state. The shared legacy
// file is only a compatibility mirror because older engines may overwrite it.
const previous = readJson(primaryDecisionPath, readJson(legacyDecisionPath, {}));
const sourceBasket = Array.isArray(report.currentBasket) ? report.currentBasket : [];
const approved = report.productionEligible === true && sourceBasket.length >= 3;
const memberPortfolioWeightPct = approved
  ? Math.round((PILOT_ALLOCATION_PCT / sourceBasket.length) * 100) / 100
  : 0;

const recommendations = approved
  ? sourceBasket.map((item, index) => ({
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      strategyId: 'V16_9_EQUAL_WEIGHT_BASKET',
      strategyLabelAr: 'سلة احتمالية متساوية الأوزان',
      profile: 'REDUCED_RISK_BASKET_PILOT',
      category: 'BASKET_MEMBER',
      rank: index + 1,
      localRank: index + 1,
      basketSize: sourceBasket.length,
      basketInternalWeightPct: item.weightPct,
      portfolioWeightPct: memberPortfolioWeightPct,
      cashIfNotTriggered: true,
      close: item.close,
      entryLow: item.entryLow,
      entryHigh: item.entryHigh,
      stopLoss: item.stopLoss,
      target1: item.target1,
      holdingSessions: item.holdingSessions || 1,
      estimatedTop10ProbabilityPct: item.probabilityTop10Pct,
      rsi14: item.rsi14,
      volumeRatio20: item.volumeRatio20,
      hotMomentumRisk: Number(item.rsi14 || 0) > 80,
      morningConfirmation: {
        ...(item.morningConfirmation || {}),
        ruleAr: 'يظل السهم مرشحًا فقط. لا يُنفذ إذا افتتح أعلى نطاق الدخول أو ضعفت السيولة أول 10–15 دقيقة، ويظل وزنه نقدًا ولا يُعاد توزيعه.',
      },
      status: 'BASKET_MEMBER_PENDING_OPEN_CONFIRMATION',
      statusAr: 'عضو في سلة Pilot؛ التنفيذ معلق على افتتاح داخل النطاق وسيولة مؤكدة.',
      currentSessionEligible: true,
      referenceOnly: false,
    }))
  : [];

const metrics = report.blockedWalkForwardMetrics || {};
const output = {
  ...previous,
  schemaVersion: '16.9.1-production-basket-pilot',
  generatedAt: new Date().toISOString(),
  sessionDate: report.currentSignalDate,
  mode: 'EQUAL_WEIGHT_BASKET_PILOT',
  practicalReady: approved,
  professionalEvidenceReady: false,
  evidenceTier: approved ? 'BLOCKED_WALK_FORWARD_PILOT' : 'BASKET_GATE_BLOCKED',
  status: approved ? 'V16_9_BASKET_READY_PENDING_OPEN' : 'V16_9_BASKET_GATE_BLOCKED',
  statusAr: approved
    ? `سلة Pilot من ${sourceBasket.length} أسهم جاهزة للمراقبة؛ إجمالي التعرض 50% والتنفيذ معلق على تأكيد الافتتاح.`
    : 'لم تجتز سلة V16.9 بوابة الأداء، لذلك لا توجد خطة تنفيذ منشورة.',
  selectedModel: {
    ...(previous.selectedModel || {}),
    id: 'V16_9_EQUAL_WEIGHT_BASKET',
    labelAr: 'محرك السلة الاحتمالية متساوية الأوزان',
    profile: approved ? 'REDUCED_RISK_BASKET_PILOT' : 'RESEARCH_ONLY',
    watchOnly: !approved,
    validationPassed: approved,
    testPassed: approved,
    pilotPassed: approved,
    professionalEvidencePassed: false,
    evidenceTier: approved ? 'BLOCKED_WALK_FORWARD_PILOT' : 'BASKET_GATE_BLOCKED',
    pilotRiskMode: approved ? '50_PERCENT_CAPITAL_MAX' : 'NO_TRADE',
    stabilityLabelAr: approved ? 'اجتاز Blocked Walk-Forward كباقة أسهم' : 'لم يجتز بوابة السلة',
    stabilityReasonsAr: approved
      ? [
          `متوسط العائد الصافي للجلسة: ${metrics.averageNetReturnPct}% بعد تكلفة 0.60%.`,
          `Profit Factor: ${metrics.profitFactor}، ونسبة الجلسات الرابحة: ${metrics.sessionWinRatePct}%.`,
          `أقصى تراجع تاريخي للسلة كاملة: ${metrics.maximumDrawdownPct}%.`,
          'النتيجة أثبتت أفضلية على مستوى السلة، لا على مستوى سهم منفرد.',
        ]
      : ['لم تثبت أفضلية موجبة خارج العينة.'],
  },
  validatedModels: approved ? ['V16_9_EQUAL_WEIGHT_BASKET'] : [],
  recommendations,
  basketPlan: {
    engine: report.schemaVersion,
    passed: approved,
    signalDate: report.currentSignalDate,
    basketSize: sourceBasket.length,
    totalAllocationPct: approved ? PILOT_ALLOCATION_PCT : 0,
    cashReservePct: approved ? 100 - PILOT_ALLOCATION_PCT : 100,
    memberPortfolioWeightPct,
    holdingSessions: 1,
    unfilledMemberPolicy: 'KEEP_CASH',
    rebalancePolicyAr: 'لا يُعاد توزيع وزن السهم غير المتفعل؛ يظل نقدًا لتجنب زيادة المخاطرة في بقية الأسهم.',
    blockedWalkForwardMetrics: metrics,
    acceptanceGate: report.acceptanceGate,
    currentBasketValidation: report.currentBasketValidation,
    riskNoticeAr: 'السلة اجتازت اختبارًا تاريخيًا محدودًا ولا تضمن الربح. الأسهم ذات RSI أعلى من 80 زخمها ساخن وتتطلب التزامًا صارمًا بنطاق الدخول.',
  },
  researchWatchlist: report.currentResearchBasket || [],
  primaryDecisionSource: 'V16_9_ISOLATED_FILE',
};

// The application reads the isolated file. The shared legacy path remains a
// mirror for old links, but no longer controls what the user sees.
writeJsonAtomic(primaryDecisionPath, output);
writeJsonAtomic(legacyDecisionPath, output);
console.log(JSON.stringify({
  status: output.status,
  basketSize: recommendations.length,
  totalAllocationPct: output.basketPlan.totalAllocationPct,
  memberPortfolioWeightPct,
  primaryDecisionPath: path.relative(root, primaryDecisionPath),
}, null, 2));
