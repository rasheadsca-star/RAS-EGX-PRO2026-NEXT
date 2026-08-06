#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const input = {
  decision: path.join(root, 'data/stable/v16-v169-primary-decision.json'),
  regime: path.join(root, 'data/stable/v16-market-regime.json'),
  live: path.join(root, 'data/stable/v16-live-evidence.json'),
  fetchStatus: path.join(root, 'data/fetch-status.json'),
};
const outputDir = path.join(root, 'data/v17');
const snapshotPath = path.join(outputDir, 'current.json');
const ledgerPath = path.join(outputDir, 'ledger.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`Cannot read JSON ${path.relative(root, filePath)}: ${error.message}`);
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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const decision = readJson(input.decision);
const regime = readJson(input.regime);
const live = readJson(input.live);
const fetchStatus = readJson(input.fetchStatus, {});

const engineId = decision?.selectedModel?.id;
if (engineId !== 'V16_9_EQUAL_WEIGHT_BASKET') {
  throw new Error(`V17 accepts one production engine only; received ${engineId || 'missing'}`);
}

const recommendations = Array.isArray(decision.recommendations) ? decision.recommendations : [];
if (recommendations.length < 3 || recommendations.length > 5) {
  throw new Error(`V17 basket must contain 3–5 members; received ${recommendations.length}`);
}

const sessionDate = decision.sessionDate || decision.expectedLatestSession;
const marketSession = regime?.metrics?.sessionDate;
const sourceSession = fetchStatus.lastSession || fetchStatus.sessionDate || decision?.priceTruth?.sourceSession || decision?.priceTruth?.sessionDate || sessionDate;
const sessionAligned = Boolean(sessionDate && sessionDate === marketSession && sessionDate === sourceSession);
const executionGrade = decision?.priceTruth?.executionGrade === true || fetchStatus.executionGrade === true || fetchStatus.mode === 'v15_precise_public_execution_grade';

const normalizedRecommendations = recommendations.map((row, index) => ({
  ticker: String(row.ticker || '').trim().toUpperCase(),
  companyNameAr: row.companyNameAr || row.ticker,
  rank: index + 1,
  entryLow: finite(row.entryLow),
  entryHigh: finite(row.entryHigh),
  target: finite(row.target1),
  stop: finite(row.stopLoss),
  referenceClose: finite(row.close),
  portfolioWeightPct: finite(row.portfolioWeightPct),
  basketWeightPct: finite(row.basketInternalWeightPct),
  holdingSessions: finite(row.holdingSessions, 1),
  probabilityTop10Pct: finite(row.estimatedTop10ProbabilityPct),
  rsi14: finite(row.rsi14),
  volumeRatio20: finite(row.volumeRatio20),
  hotMomentumRisk: row.hotMomentumRisk === true || finite(row.rsi14, 0) > 80,
  state: 'PENDING_OPEN_CONFIRMATION',
  cashIfNotTriggered: true,
  executionRules: {
    cancelIfOpenAbove: finite(row?.morningConfirmation?.cancelIfOpenAbove, finite(row.entryHigh)),
    cancelIfOpenBelow: finite(row?.morningConfirmation?.cancelIfOpenBelow, finite(row.stopLoss)),
    observeFirstMinutes: 15,
    requireOpeningInsideRange: true,
    requireLiquidityConfirmation: true,
    chaseForbidden: true,
  },
}));

const duplicateTickers = normalizedRecommendations
  .map(row => row.ticker)
  .filter((ticker, index, all) => all.indexOf(ticker) !== index);
if (duplicateTickers.length) throw new Error(`Duplicate V17 tickers: ${duplicateTickers.join(', ')}`);

for (const row of normalizedRecommendations) {
  if (!row.ticker || ![row.entryLow, row.entryHigh, row.target, row.stop].every(Number.isFinite)) {
    throw new Error(`Incomplete price plan for ${row.ticker || 'unknown ticker'}`);
  }
  if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) {
    throw new Error(`Invalid price relationship for ${row.ticker}`);
  }
}

const totalAllocationPct = normalizedRecommendations.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0);
if (totalAllocationPct > 50.001) throw new Error(`V17 exposure exceeds 50%: ${totalAllocationPct}`);

const evidenceGate = live.professionalGate || {};
const resolvedRatio = clamp(finite(evidenceGate.resolvedTrades, 0) / Math.max(1, finite(evidenceGate.minimumResolvedTrades, 100)), 0, 1);
const timeRatio = clamp(finite(evidenceGate.observedCalendarDays, 0) / Math.max(1, finite(evidenceGate.minimumObservedCalendarDays, 90)), 0, 1);
const evidenceScore = Math.round((resolvedRatio * 60 + timeRatio * 40) * 100) / 100;
const dataScore = Math.round(clamp((sessionAligned ? 55 : 0) + (executionGrade ? 30 : 0) + Math.min(15, finite(decision?.marketScan?.symbolsLatest, 0) / 12), 0, 95) * 100) / 100;
const operationalScore = Math.round(clamp(45 + (sessionAligned ? 25 : 0) + (duplicateTickers.length === 0 ? 15 : 0) + (totalAllocationPct <= 50 ? 15 : 0), 0, 100) * 100) / 100;
const professionalEvidenceReady = live.professionalEvidenceReady === true && evidenceGate.sampleGatePassed === true && evidenceGate.timeGatePassed === true;
const releaseStage = professionalEvidenceReady ? 'PROFESSIONAL_EVIDENCE' : 'CONTROLLED_PILOT';

const strategyEvidence = (Array.isArray(live.byStrategy) ? live.byStrategy : []).find(row => row.name === engineId) || null;
const generatedAt = new Date().toISOString();
const status = sessionAligned && executionGrade ? 'READY_FOR_NEXT_SESSION_REVIEW' : 'BLOCKED_STALE_OR_UNVERIFIED_DATA';

const snapshot = {
  schemaVersion: '17.0.0-rc1',
  generatedAt,
  status,
  statusAr: status === 'READY_FOR_NEXT_SESSION_REVIEW'
    ? 'البيانات متسقة والسلة جاهزة للمراجعة قبل الجلسة، وليست أمر شراء آليًا.'
    : 'تم إيقاف التوصيات بسبب عدم اتساق الجلسة أو عدم اكتمال درجة التنفيذ.',
  sessionDate,
  nextSessionPlan: true,
  engine: {
    id: engineId,
    version: '17.0-wrapper-on-v16.9-method',
    labelAr: 'سلة احتمالية متساوية الأوزان — تشغيل V17 معزول',
    singleProductionEngine: true,
  },
  market: {
    sessionDate: marketSession,
    regime: regime.regime,
    labelAr: regime.labelAr,
    score: finite(regime.score),
    riskMultiplier: finite(regime.riskMultiplier),
    maxTradeRiskPct: finite(regime.maxTradeRiskPct),
    guidanceAr: regime.guidanceAr,
    metrics: regime.metrics || {},
  },
  readiness: {
    releaseStage,
    professionalEvidenceReady,
    marketStrengthScore: finite(regime.score),
    dataQualityScore: dataScore,
    liveEvidenceScore: evidenceScore,
    operationalIntegrityScore: operationalScore,
    disclosureAr: professionalEvidenceReady
      ? 'اكتملت بوابة العينة والزمن المحددة في السجل الحي.'
      : 'التطبيق في وضع Pilot مضبوط؛ قوة السوق لا تعني أن الأداء المهني مثبت.',
  },
  portfolioPolicy: {
    maximumTotalAllocationPct: 50,
    plannedAllocationPct: Math.round(totalAllocationPct * 100) / 100,
    cashReservePct: Math.round((100 - totalAllocationPct) * 100) / 100,
    unfilledMemberPolicy: 'KEEP_CASH',
    automaticOrders: false,
    sameSessionAmbiguityPolicy: 'CONSERVATIVE_STOP',
  },
  recommendations: normalizedRecommendations,
  evidence: {
    gate: evidenceGate,
    overallSummary: live.summary || {},
    productionStrategySummary: strategyEvidence,
  },
  systemHealth: {
    sessionAligned,
    executionGrade,
    sourceSession,
    decisionSession: sessionDate,
    regimeSession: marketSession,
    fetchedRows: finite(fetchStatus.marketRows, finite(decision?.priceTruth?.acceptedRows)),
    sourceName: fetchStatus.sourceName || decision?.priceTruth?.source || null,
    staleDataBlocked: !sessionAligned,
  },
  lineage: {
    decisionSource: 'data/stable/v16-v169-primary-decision.json',
    regimeSource: 'data/stable/v16-market-regime.json',
    liveEvidenceSource: 'data/stable/v16-live-evidence.json',
    canonicalPath: 'data/v17/current.json',
  },
};

const ledger = readJson(ledgerPath, {
  schemaVersion: '17.0.0-ledger',
  createdAt: generatedAt,
  entries: [],
});
if (!Array.isArray(ledger.entries)) ledger.entries = [];

const immutablePayload = {
  sessionDate,
  engineId,
  recommendations: normalizedRecommendations.map(row => ({
    ticker: row.ticker,
    entryLow: row.entryLow,
    entryHigh: row.entryHigh,
    target: row.target,
    stop: row.stop,
    portfolioWeightPct: row.portfolioWeightPct,
  })),
};
const signalId = `${sessionDate}:${engineId}`;
const signalHash = stableHash(immutablePayload);
const existing = ledger.entries.find(entry => entry.signalId === signalId);
if (existing && existing.signalHash !== signalHash) {
  throw new Error(`Immutable ledger conflict for ${signalId}; refusing silent replacement`);
}
if (!existing) {
  ledger.entries.push({
    signalId,
    signalHash,
    issuedAt: generatedAt,
    ...immutablePayload,
    status: 'ISSUED_PENDING_NEXT_SESSION',
  });
}
ledger.updatedAt = generatedAt;

writeJsonAtomic(snapshotPath, snapshot);
writeJsonAtomic(ledgerPath, ledger);

console.log(JSON.stringify({
  status: snapshot.status,
  sessionDate,
  engineId,
  recommendationCount: normalizedRecommendations.length,
  totalAllocationPct,
  scores: snapshot.readiness,
  ledgerEntries: ledger.entries.length,
}, null, 2));
