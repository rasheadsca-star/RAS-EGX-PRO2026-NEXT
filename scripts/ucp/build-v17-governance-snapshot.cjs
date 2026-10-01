#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); }
  catch (error) { if (fallback !== null) return fallback; throw error; }
};
const write = (p, value) => {
  const out = path.join(root, p);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(value, null, 2) + '\n');
};
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const decision = read('data/stable/v16-v169-primary-decision.json');
const regime = read('data/stable/v16-market-regime.json');
const priceTruth = read('data/stable/v15-price-truth.json', {});
const fetchStatus = read('data/fetch-status.json', {});
const previousV17 = read('data/v17/current.json', {});

const engineId = decision?.selectedModel?.id;
if (engineId !== 'V16_9_EQUAL_WEIGHT_BASKET') {
  throw new Error(`UCP_V17_UNEXPECTED_ENGINE:${engineId || 'missing'}`);
}

const sessionDate = decision.sessionDate || priceTruth.expectedSession || null;
const regimeSession = regime?.metrics?.sessionDate || regime?.sessionDate || null;
const priceSession = priceTruth.expectedSession || null;
const sourceSession = fetchStatus.lastSession || fetchStatus.sessionDate || priceSession || sessionDate;
const sessionAligned = Boolean(
  sessionDate && regimeSession === sessionDate && sourceSession === sessionDate &&
  (!priceSession || priceSession === sessionDate)
);
const executionGrade = Boolean(
  priceTruth.executionGrade === true ||
  decision?.priceTruth?.executionGrade === true ||
  fetchStatus.executionGrade === true ||
  fetchStatus.mode === 'v15_precise_public_execution_grade'
);

const sourceRecommendations = Array.isArray(decision.recommendations) ? decision.recommendations : [];
const validBasketCardinality = sourceRecommendations.length === 0 ||
  (sourceRecommendations.length >= 3 && sourceRecommendations.length <= 5);
if (!validBasketCardinality) {
  throw new Error(`UCP_V17_INVALID_BASKET_CARDINALITY:${sourceRecommendations.length}`);
}

const recommendations = sourceRecommendations.map((row, index) => ({
  ticker: String(row.ticker || '').trim().toUpperCase(),
  rank: index + 1,
  entryLow: finite(row.entryLow),
  entryHigh: finite(row.entryHigh),
  target: finite(row.target1),
  stop: finite(row.stopLoss),
  referenceClose: finite(row.close),
  portfolioWeightPct: finite(row.portfolioWeightPct),
  state: 'PENDING_MORNING_CONFIRMATION',
  executionAllowed: false,
  cashIfNotTriggered: true
}));
for (const row of recommendations) {
  if (!row.ticker || ![row.entryLow, row.entryHigh, row.target, row.stop].every(Number.isFinite)) {
    throw new Error(`UCP_V17_INCOMPLETE_TRADE_PLAN:${row.ticker || 'unknown'}`);
  }
  if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) {
    throw new Error(`UCP_V17_INVALID_TRADE_PLAN:${row.ticker}`);
  }
}

let status = 'BLOCKED_STALE_OR_UNVERIFIED_DATA';
if (sessionAligned && executionGrade && recommendations.length > 0) status = 'READY_FOR_NEXT_SESSION_REVIEW';
if (sessionAligned && executionGrade && recommendations.length === 0) status = 'RESEARCH_READY_EXECUTION_BLOCKED';

const previousEvidence = previousV17?.evidence || null;
const snapshot = {
  schemaVersion: '17.0.0-ucp-governance-v1',
  generatedAt: new Date().toISOString(),
  status,
  statusAr: status === 'READY_FOR_NEXT_SESSION_REVIEW'
    ? 'الجلسة متطابقة وتوجد سلة بحثية؛ التنفيذ الآلي محظور وتأكيد الصباح مطلوب.'
    : status === 'RESEARCH_READY_EXECUTION_BLOCKED'
      ? 'الجلسة متطابقة، لكن البوابة الحالية لم تُصدر سلة؛ لا يتم اختلاق توصية ويظل التنفيذ محظورًا.'
      : 'حوكمة UCP أوقفت الجلسة لعدم تطابق المصدر أو عدم اكتمال درجة التنفيذ.',
  sessionDate,
  engine: {
    id: 'V17_GOVERNANCE_SPINE',
    sourceSelectionEngine: engineId,
    role: 'DATA_RISK_GOVERNANCE',
    selectionMethodFrozen: true,
    executionAllowed: false
  },
  championChallenger: {
    activeEngine: engineId,
    promotionAllowed: false,
    automaticChampionPromotionAllowed: false,
    status: 'UCP_MANUAL_PROMOTION_ONLY'
  },
  market: {
    sessionDate: regimeSession,
    regime: regime.regime || null,
    labelAr: regime.labelAr || null,
    score: finite(regime.score),
    riskMultiplier: finite(regime.riskMultiplier),
    maxTradeRiskPct: finite(regime.maxTradeRiskPct),
    guidanceAr: regime.guidanceAr || null,
    metrics: regime.metrics || {}
  },
  readiness: {
    releaseStage: 'UCP_CURRENT_SESSION_GOVERNANCE',
    professionalEvidenceReady: previousV17?.readiness?.professionalEvidenceReady === true,
    sessionAligned,
    executionGrade,
    recommendationCount: recommendations.length
  },
  portfolioPolicy: {
    maximumTotalAllocationPct: 50,
    plannedAllocationPct: recommendations.reduce((sum, row) => sum + (row.portfolioWeightPct || 0), 0),
    automaticOrders: false,
    automaticExecution: false,
    automaticPromotion: false,
    unfilledMemberPolicy: 'KEEP_CASH'
  },
  recommendations,
  evidence: {
    priorCanonicalV17Evidence: previousEvidence,
    priorCanonicalV17Session: previousV17?.sessionDate || null,
    provenance: 'UCP_CURRENT_SESSION_GOVERNANCE_ONLY_DOES_NOT_REWRITE_PRIOR_V17_EVIDENCE'
  },
  systemHealth: {
    sessionAligned,
    executionGrade,
    sourceSession,
    decisionSession: sessionDate,
    regimeSession,
    priceSession,
    staleDataBlocked: !sessionAligned,
    zeroRecommendationStateValid: recommendations.length === 0
  },
  permissions: {
    researchOnly: true,
    executionAllowed: false,
    automaticOrders: false,
    recommendationMutationAllowed: false,
    automaticChampionPromotion: false
  },
  lineage: {
    decisionSource: 'data/stable/v16-v169-primary-decision.json',
    regimeSource: 'data/stable/v16-market-regime.json',
    priceTruthSource: 'data/stable/v15-price-truth.json',
    priorCanonicalV17Source: 'data/v17/current.json',
    canonicalPath: 'data/v17/ucp-current-session.json'
  }
};

write('data/v17/ucp-current-session.json', snapshot);
console.log(JSON.stringify({
  status,
  sessionDate,
  sessionAligned,
  executionGrade,
  recommendationCount: recommendations.length,
  regime: snapshot.market.regime,
  riskMultiplier: snapshot.market.riskMultiplier,
  executionAllowed: false
}, null, 2));
