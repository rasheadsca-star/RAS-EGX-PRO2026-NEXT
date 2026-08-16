#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fingerprintSession } = require('./v16-session-data-fingerprint.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const reportPath = path.join(root, 'data/research/v16-v169-basket-engine.json');
const legacyDecisionPath = path.join(root, 'data/stable/v15-practical-decision.json');
const primaryDecisionPath = path.join(root, 'data/stable/v16-v169-primary-decision.json');
const priceTruthPath = path.join(root, 'data/stable/v15-price-truth.json');
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

function cairoTimestamp(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(iso)).replace(',', '');
  } catch {
    return null;
  }
}

const report = readJson(reportPath);
if (!report.schemaVersion) {
  throw new Error('Missing V16.9 basket report; refusing to overwrite application decision.');
}

const priceTruth = readJson(priceTruthPath, {});
const expectedSession = priceTruth?.expectedSession || null;
const fingerprint = fingerprintSession(expectedSession);
const minimumExecutionRows = Number(priceTruth?.minimumExecutionRows || 80);
const sourceSessionReady = Boolean(
  priceTruth?.ready === true
  && priceTruth?.executionGrade === true
  && expectedSession
  && report.currentSignalDate === expectedSession
  && fingerprint.sessionDate === expectedSession
  && fingerprint.hash
  && fingerprint.rows >= minimumExecutionRows
);

// The isolated primary file is the authoritative prior state. The shared legacy
// file is only a compatibility mirror because older engines may overwrite it.
const previous = readJson(primaryDecisionPath, readJson(legacyDecisionPath, {}));
const sourceBasket = Array.isArray(report.currentBasket) ? report.currentBasket : [];
const approved = report.productionEligible === true && sourceBasket.length >= 3 && sourceSessionReady;
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
const blockedBySessionTruth = report.productionEligible === true && sourceBasket.length >= 3 && !sourceSessionReady;
const generatedAt = new Date().toISOString();
const sourceSessionEvidenceCoveragePct = Number(priceTruth?.source?.sourceSessionEvidenceCoveragePct || 0);

const output = {
  ...previous,
  schemaVersion: '16.9.2-session-bound-production-basket-pilot',
  generatedAt,
  sessionDate: report.currentSignalDate,
  expectedLatestSession: expectedSession,
  mode: 'EQUAL_WEIGHT_BASKET_PILOT',
  practicalReady: approved,
  professionalEvidenceReady: false,
  evidenceTier: approved ? 'BLOCKED_WALK_FORWARD_PILOT' : 'BASKET_GATE_BLOCKED',
  status: approved
    ? 'V16_9_BASKET_READY_PENDING_OPEN'
    : blockedBySessionTruth
      ? 'V16_9_SOURCE_SESSION_NOT_READY'
      : 'V16_9_BASKET_GATE_BLOCKED',
  statusAr: approved
    ? `سلة Pilot من ${sourceBasket.length} أسهم مبنية على جلسة ${report.currentSignalDate} الموثقة؛ إجمالي التعرض 50% والتنفيذ معلق على تأكيد الافتتاح.`
    : blockedBySessionTruth
      ? 'تم حجب نشر السلة للتنفيذ لأن بيانات جلسة السوق لم تجتز بوابة الجلسة الموثقة بالكامل.'
      : 'لم تجتز سلة V16.9 بوابة الأداء، لذلك لا توجد خطة تنفيذ منشورة.',
  selectedModel: {
    ...(previous.selectedModel || {}),
    id: 'V16_9_EQUAL_WEIGHT_BASKET',
    labelAr: 'محرك السلة الاحتمالية متساوية الأوزان',
    profile: approved ? 'REDUCED_RISK_BASKET_PILOT' : 'RESEARCH_ONLY',
    watchOnly: !approved,
    validationPassed: report.productionEligible === true,
    testPassed: report.productionEligible === true,
    pilotPassed: approved,
    professionalEvidencePassed: false,
    evidenceTier: approved ? 'BLOCKED_WALK_FORWARD_PILOT' : 'BASKET_GATE_BLOCKED',
    pilotRiskMode: approved ? '50_PERCENT_CAPITAL_MAX' : 'NO_TRADE',
    stabilityLabelAr: report.productionEligible === true ? 'اجتاز Blocked Walk-Forward كباقة أسهم' : 'لم يجتز بوابة السلة',
    stabilityReasonsAr: report.productionEligible === true
      ? [
          `متوسط العائد الصافي للجلسة: ${metrics.averageNetReturnPct}% بعد تكلفة 0.60%.`,
          `Profit Factor: ${metrics.profitFactor}، ونسبة الجلسات الرابحة: ${metrics.sessionWinRatePct}%.`,
          `أقصى تراجع تاريخي للسلة كاملة: ${metrics.maximumDrawdownPct}%.`,
          'النتيجة أثبتت أفضلية على مستوى السلة، لا على مستوى سهم منفرد.',
        ]
      : ['لم تثبت أفضلية موجبة خارج العينة.'],
  },
  validatedModels: report.productionEligible === true ? ['V16_9_EQUAL_WEIGHT_BASKET'] : [],
  recommendations,
  marketScan: {
    ...(previous.marketScan || {}),
    latestDate: expectedSession,
    expectedLatestSession: expectedSession,
    verifiedSessionDataRows: fingerprint.rows,
    verifiedSessionDataHash: fingerprint.hash,
    sourceSessionEvidenceCoveragePct,
  },
  priceTruth: {
    ready: priceTruth?.ready === true,
    fetchOk: priceTruth?.source?.realFetch === true,
    realFetch: priceTruth?.source?.realFetch === true,
    executionGrade: priceTruth?.executionGrade === true,
    fetchMode: priceTruth?.acceptanceMode || null,
    fetchGeneratedAt: priceTruth?.generatedAt || null,
    sessionCurrent: report.currentSignalDate === expectedSession,
    recommendationPricesTrusted: sourceSessionReady,
    originalRecommendationCount: sourceBasket.length,
    trustedRecommendationCount: sourceSessionReady ? sourceBasket.length : 0,
    sourceSessionEvidenceCoveragePct,
    sourceSessionDataRows: fingerprint.rows,
    sourceSessionDataHash: fingerprint.hash,
  },
  freshness: {
    checkedAt: generatedAt,
    checkedAtCairo: cairoTimestamp(generatedAt),
    expectedSession,
    decisionSession: report.currentSignalDate,
    priceSession: expectedSession,
    sourceSession: fingerprint.sessionDate,
    isFresh: sourceSessionReady,
    currentSessionReady: sourceSessionReady,
    displayMode: sourceSessionReady ? 'CURRENT_VERIFIED_SESSION' : 'SOURCE_SESSION_BLOCKED',
    reasonCodes: sourceSessionReady ? [] : ['SOURCE_SESSION_NOT_EXECUTION_GRADE'],
  },
  recommendationsCurrent: sourceSessionReady,
  currentSessionReady: sourceSessionReady,
  basketPlan: {
    engine: report.schemaVersion,
    passed: approved,
    signalDate: report.currentSignalDate,
    expectedMarketSession: expectedSession,
    sourceSessionReady,
    sourceSessionDataHash: fingerprint.hash,
    sourceSessionDataRows: fingerprint.rows,
    sourceSessionEvidenceCoveragePct,
    sourcePriceTruthGeneratedAt: priceTruth?.generatedAt || null,
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
  primaryDecisionSource: 'V16_9_ISOLATED_FILE_SESSION_BOUND',
};

// The application reads the isolated file. The shared legacy path remains a
// mirror for old links, but no longer controls what the user sees.
writeJsonAtomic(primaryDecisionPath, output);
writeJsonAtomic(legacyDecisionPath, output);
console.log(JSON.stringify({
  status: output.status,
  sessionDate: output.sessionDate,
  expectedLatestSession: output.expectedLatestSession,
  sourceSessionReady,
  sourceSessionDataHash: fingerprint.hash,
  sourceSessionDataRows: fingerprint.rows,
  basketSize: recommendations.length,
  tickers: recommendations.map(item => item.ticker),
  totalAllocationPct: output.basketPlan.totalAllocationPct,
  memberPortfolioWeightPct,
  primaryDecisionPath: path.relative(root, primaryDecisionPath),
}, null, 2));
