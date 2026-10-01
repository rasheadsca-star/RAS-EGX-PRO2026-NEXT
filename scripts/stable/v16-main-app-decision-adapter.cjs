#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = relative => path.join(ROOT, relative);

const FILES = {
  v1610: P('data/research/v16-v1610-exposure-challenger.json'),
  v169: P('data/stable/v16-v169-primary-decision.json'),
  priceTruth: P('data/stable/v15-price-truth.json'),
};

const V1610_ENGINE_ID = 'V16_10_EXPOSURE_AWARE_DEGRADATION_GUARD_SHADOW';
const V169_ENGINE_ID = 'V16_9_EQUAL_WEIGHT_BASKET';
const MAX_V1610_AGE_MINUTES = 180;
const MIN_RESEARCH_CANDIDATES = 3;

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function ageMinutes(value, now = Date.now()) {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, now - ts) / 60000;
}
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizeV1610(report, priceTruth, fallback) {
  const currentAction = String(report.currentAction || '');
  const guard = report.currentRiskGuard || {};
  const currentBasket = Array.isArray(report.currentShadowBasket) ? report.currentShadowBasket : [];
  const executable = Array.isArray(report.currentExecutableShadowBasket) ? report.currentExecutableShadowBasket : [];
  const currentSession = report.currentSignalDate || null;
  const expectedSession = priceTruth.expectedSession || fallback.expectedLatestSession || fallback.sessionDate || null;
  const sourceSessionReady = priceTruth.ready === true && report.methodology?.futureLeakageForbidden === true && currentSession === expectedSession;
  const guardPassed = guard.passed === true;
  const shadowReady = currentAction === 'SHADOW_DEPLOY_50_PERCENT' && guardPassed && executable.length >= MIN_RESEARCH_CANDIDATES && sourceSessionReady;
  // V16.10 remains shadow-only: it can expose a watchlist but never grants Main App execution authority.
  const executionAllowed = false;
  const productionRecommendations = [];
  const researchWatchlist = currentBasket.map(item => ({
    ticker: String(item?.ticker || '').trim().toUpperCase(),
    companyNameAr: item?.companyNameAr || null,
    rank: finite(item?.rank, 0),
    portfolioWeightPct: finite(item?.portfolioWeightPct, 0),
    entryLow: item?.entryLow ?? null,
    entryHigh: item?.entryHigh ?? null,
    stopLoss: item?.stopLoss ?? null,
    target1: item?.target1 ?? null,
    probabilityTop10Pct: item?.probabilityTop10Pct ?? null,
    rsi14: item?.rsi14 ?? null,
    volumeRatio20: item?.volumeRatio20 ?? null,
    holdingSessions: item?.holdingSessions ?? 1,
    morningConfirmation: item?.morningConfirmation || null,
  })).filter(item => item.ticker);
  const historicalGate = clone(report.acceptanceGate || {});
  historicalGate.degradationGuardPassed = guardPassed;
  historicalGate.currentSourceSessionReady = sourceSessionReady;
  const status = shadowReady ? 'V16_10_SHADOW_READY' : 'V16_10_CASH_MODE';
  const reasonCodes = guardPassed ? [] : (Array.isArray(guard.reasons) ? guard.reasons : ['DEGRADATION_GUARD_ACTIVE']);
  const memberWeight = executionAllowed && executable.length ? 50 / executable.length : 0;
  return {
    schemaVersion: '16.10.1-main-app-decision-adapter',
    generatedAt: report.generatedAt,
    sessionDate: currentSession,
    expectedLatestSession: expectedSession,
    mode: 'V16_10_EXPOSURE_AWARE_GOVERNANCE',
    practicalReady: false,
    executionAllowed: false,
    professionalEvidenceReady: false,
    evidenceTier: shadowReady ? 'SHADOW_GOVERNANCE' : 'CASH_MODE',
    status,
    statusAr: shadowReady ? 'V16.10 جاهز كقائمة Shadow للمراقبة فقط؛ لا توجد صلاحية تنفيذ إنتاجية.' : 'وضع حماية نقدي: V16.10 منع الدخول لأن نافذة التحقق السابقة متدهورة.',
    selectedModel: {
      id: V1610_ENGINE_ID,
      labelAr: 'محرك V16.10 للتعرض الواعي وحماية رأس المال',
      profile: 'SHADOW_GOVERNANCE',
      watchOnly: true,
      validationPassed: report.shadowEligible === true,
      testPassed: report.championParity?.passed === true,
      pilotPassed: false,
      professionalEvidencePassed: false,
      evidenceTier: shadowReady ? 'SHADOW_GOVERNANCE' : 'CASH_MODE',
      pilotRiskMode: 'NO_TRADE',
      stabilityLabelAr: shadowReady ? 'اجتاز اختبارات الحماية كـShadow فقط' : 'حماية نقدية مفعلة بسبب تدهور نافذة التحقق الأخيرة',
      stabilityReasonsAr: reasonCodes.length ? reasonCodes.map(code => 'Risk Guard: ' + code) : ['لا توجد أسباب حجب حالية في نافذة التحقق السابقة.'],
    },
    validatedModels: [V1610_ENGINE_ID],
    recommendations: productionRecommendations,
    researchWatchlist,
    marketScan: {
      latestDate: expectedSession,
      expectedLatestSession: expectedSession,
      verifiedSessionDataRows: finite(priceTruth.sourceSessionDataRows, 0),
      verifiedSessionDataHash: priceTruth.sourceSessionDataHash || null,
      sourceSessionEvidenceCoveragePct: finite(priceTruth.source?.sourceSessionEvidenceCoveragePct, 0),
    },
    priceTruth: {
      ready: priceTruth.ready === true,
      fetchOk: priceTruth.source?.realFetch === true,
      realFetch: priceTruth.source?.realFetch === true,
      executionGrade: priceTruth.executionGrade === true,
      sessionCurrent: sourceSessionReady,
      recommendationPricesTrusted: sourceSessionReady && executionAllowed,
      originalRecommendationCount: productionRecommendations.length,
      trustedRecommendationCount: sourceSessionReady ? productionRecommendations.length : 0,
      sourceSessionEvidenceCoveragePct: finite(priceTruth.source?.sourceSessionEvidenceCoveragePct, 0),
      sourceSessionDataRows: finite(priceTruth.sourceSessionDataRows, 0),
      sourceSessionDataHash: priceTruth.sourceSessionDataHash || null,
    },
    freshness: {
      checkedAt: new Date().toISOString(),
      expectedSession,
      decisionSession: currentSession,
      priceSession: expectedSession,
      sourceSession: currentSession,
      isFresh: sourceSessionReady,
      currentSessionReady: sourceSessionReady,
      displayMode: sourceSessionReady ? 'CURRENT_VERIFIED_SESSION' : 'SOURCE_SESSION_BLOCKED',
      reasonCodes: sourceSessionReady ? [] : ['V16_10_SESSION_MISMATCH'],
    },
    recommendationsCurrent: executionAllowed,
    currentSessionReady: sourceSessionReady,
    basketPlan: {
      engine: report.schemaVersion,
      passed: false,
      signalDate: currentSession,
      expectedMarketSession: expectedSession,
      sourceSessionReady,
      sourceSessionDataHash: priceTruth.sourceSessionDataHash || null,
      sourceSessionDataRows: finite(priceTruth.sourceSessionDataRows, 0),
      sourceSessionEvidenceCoveragePct: finite(priceTruth.source?.sourceSessionEvidenceCoveragePct, 0),
      sourcePriceTruthGeneratedAt: priceTruth.generatedAt || null,
      basketSize: productionRecommendations.length,
      totalAllocationPct: 0,
      cashReservePct: 100,
      memberPortfolioWeightPct: 0,
      holdingSessions: 1,
      unfilledMemberPolicy: 'KEEP_CASH',
      rebalancePolicyAr: 'لا يُعاد توزيع وزن السهم غير المتفعل؛ يظل نقدًا.',
      blockedWalkForwardMetrics: report.portfolioCapitalMetricsWithoutGuard || report.fullExposureReferenceMetrics || {},
      acceptanceGate: historicalGate,
      currentBasketValidation: report.currentBasketValidationFullExposure || {},
      riskNoticeAr: 'V16.10 لا يصدر توصية تنفيذية عندما تكون نافذة التحقق الأخيرة متدهورة.',
    },
    researchCandidateCount: researchWatchlist.length,
    productionRecommendationCount: productionRecommendations.length,
    currentAction,
    shadowReady,
    riskGuard: {
      active: !guardPassed,
      passed: guardPassed,
      reasons: reasonCodes,
      lookbackSessions: report.methodology?.degradationGuard?.lookbackSessions ?? 8,
      fixedForwardBlockSessions: report.methodology?.degradationGuard?.fixedForwardBlockSessions ?? 5,
      failureAction: report.methodology?.degradationGuard?.failureAction || 'ABSTAIN_AND_HOLD_100_PERCENT_CASH',
    },
    governanceResolution: {
      source: 'V16_10_SHADOW_REPORT',
      engineId: V1610_ENGINE_ID,
      allowedEngines: [V1610_ENGINE_ID, V169_ENGINE_ID],
      fallbackEngineId: V169_ENGINE_ID,
      selectedByResolver: true,
      shadowOnly: true,
      automaticPromotionAllowed: false,
      productionFilesWritten: false,
      reportGeneratedAt: report.generatedAt,
      reportAgeMinutes: ageMinutes(report.generatedAt),
      maxReportAgeMinutes: MAX_V1610_AGE_MINUTES,
    },
    primaryDecisionSource: 'V16_10_EXPOSURE_AWARE_GOVERNANCE_ADAPTER',
  };
}

function resolveDecision() {
  const fallback = readJson(FILES.v169, {});
  const report = readJson(FILES.v1610, null);
  const priceTruth = readJson(FILES.priceTruth, {});
  const reportAge = report ? ageMinutes(report.generatedAt) : null;
  const expectedSession = priceTruth.expectedSession || fallback.expectedLatestSession || fallback.sessionDate || null;
  const schemaOk = Boolean(report && String(report.schemaVersion || '').startsWith('16.10.1-') && report.engine === V1610_ENGINE_ID && report.shadowOnly === true);
  const sessionOk = Boolean(report?.currentSignalDate && report.currentSignalDate === expectedSession);
  const freshOk = reportAge !== null && reportAge <= MAX_V1610_AGE_MINUTES;
  const parityOk = report?.championParity?.passed === true;
  if (schemaOk && sessionOk && freshOk && parityOk) return normalizeV1610(report, priceTruth, fallback);
  const fallbackDecision = clone(fallback);
  fallbackDecision.governanceResolution = {
    source: 'V16_9_FALLBACK',
    engineId: V169_ENGINE_ID,
    allowedEngines: [V1610_ENGINE_ID, V169_ENGINE_ID],
    fallbackEngineId: V169_ENGINE_ID,
    selectedByResolver: false,
    shadowOnly: false,
    automaticPromotionAllowed: false,
    fallbackReason: !report ? 'V16_10_REPORT_MISSING' : !schemaOk ? 'V16_10_SCHEMA_INVALID' : !sessionOk ? 'V16_10_SESSION_MISMATCH' : !freshOk ? 'V16_10_REPORT_STALE' : 'V16_10_PARITY_FAILED',
    reportGeneratedAt: report?.generatedAt || null,
    reportAgeMinutes: reportAge,
    maxReportAgeMinutes: MAX_V1610_AGE_MINUTES,
  };
  return fallbackDecision;
}

module.exports = { resolveDecision, V1610_ENGINE_ID, V169_ENGINE_ID, MAX_V1610_AGE_MINUTES };

if (require.main === module) {
  const decision = resolveDecision();
  console.log(JSON.stringify({
    engineId: decision?.selectedModel?.id || null,
    mode: decision?.mode || null,
    status: decision?.status || null,
    productionRecommendationCount: decision?.productionRecommendationCount ?? decision?.recommendations?.length ?? 0,
    researchCandidateCount: decision?.researchCandidateCount ?? decision?.researchWatchlist?.length ?? 0,
    governanceResolution: decision?.governanceResolution || null,
  }, null, 2));
}