#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const input = {
  decision: path.join(root, 'data/stable/v16-v169-primary-decision.json'),
  regime: path.join(root, 'data/stable/v16-market-regime.json'),
  legacyLive: path.join(root, 'data/stable/v16-live-evidence.json'),
  fetchStatus: path.join(root, 'data/fetch-status.json'),
  market: path.join(root, 'data/market.json'),
  researchAudit: path.join(root, 'data/research/v16-v169-target-hit-audit.json'),
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

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function profitFactor(values) {
  const gains = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  return losses > 0 ? gains / losses : gains > 0 ? null : 0;
}

function maxDrawdown(values) {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of values) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, (equity / peak - 1) * 100);
  }
  return worst;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isCleanCompanyName(value) {
  const text = String(value || '').trim();
  if (text.length < 2) return false;
  return !/End AdSlot|-->|\[[0-9,]+\]|^[0-9,\[\]]{5,}/i.test(text);
}

function compactLegacyStrategy(row) {
  if (!row) return null;
  return {
    name: row.name,
    archivedRecommendations: finite(row.archivedRecommendations, 0),
    enteredTrades: finite(row.enteredTrades, 0),
    resolvedTrades: finite(row.resolvedTrades, 0),
    cancelledOrNotEntered: finite(row.cancelledOrNotEntered, 0),
    wins: finite(row.wins, 0),
    losses: finite(row.losses, 0),
    winRatePct: finite(row.winRatePct),
    averageNetReturnPct: finite(row.averageNetReturnPct),
    profitFactor: finite(row.profitFactor),
    maxDrawdownPct: finite(row.maxDrawdownPct),
    observedCalendarDays: finite(row.observedCalendarDays, 0),
    firstRecommendationDate: row.firstRecommendationDate || null,
    latestObservedDate: row.latestObservedDate || null,
    provenance: 'LEGACY_V16_9_METHOD_EVIDENCE_NOT_NATIVE_V17',
  };
}

function nativeLedgerSummary(ledger) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const resolved = entries.filter(entry => entry.outcome?.resolved === true);
  const returns = resolved.map(entry => finite(entry.outcome?.basketSleeveReturnPct)).filter(Number.isFinite);
  const members = resolved.flatMap(entry => Array.isArray(entry.outcome?.members) ? entry.outcome.members : []);
  const issueDates = entries.map(entry => entry.sessionDate).filter(Boolean).sort();
  const outcomeDates = resolved.map(entry => entry.outcome?.outcomeDate).filter(Boolean).sort();
  const firstDate = issueDates[0] || null;
  const lastDate = outcomeDates.at(-1) || issueDates.at(-1) || null;
  const observedCalendarDays = firstDate && lastDate
    ? Math.max(0, Math.round((new Date(`${lastDate}T00:00:00Z`) - new Date(`${firstDate}T00:00:00Z`)) / 86400000) + 1)
    : 0;
  const gate = {
    minimumResolvedBaskets: 30,
    minimumResolvedMembers: 100,
    minimumObservedCalendarDays: 90,
    resolvedBaskets: resolved.length,
    resolvedMembers: members.length,
    observedCalendarDays,
  };
  gate.basketGatePassed = gate.resolvedBaskets >= gate.minimumResolvedBaskets;
  gate.memberGatePassed = gate.resolvedMembers >= gate.minimumResolvedMembers;
  gate.timeGatePassed = gate.observedCalendarDays >= gate.minimumObservedCalendarDays;
  gate.passed = gate.basketGatePassed && gate.memberGatePassed && gate.timeGatePassed;

  const wins = returns.filter(value => value > 0).length;
  const losses = returns.filter(value => value < 0).length;
  return {
    issuedBaskets: entries.length,
    resolvedBaskets: resolved.length,
    pendingBaskets: entries.length - resolved.length,
    resolvedMembers: members.length,
    wins,
    losses,
    winRatePct: returns.length ? round(wins / returns.length * 100, 2) : null,
    averageBasketReturnPct: returns.length ? round(average(returns), 4) : null,
    profitFactor: returns.length ? (profitFactor(returns) === null ? null : round(profitFactor(returns), 4)) : null,
    maxDrawdownPct: returns.length ? round(maxDrawdown(returns), 4) : null,
    firstSignalDate: firstDate,
    latestOutcomeDate: outcomeDates.at(-1) || null,
    gate,
  };
}

const decision = readJson(input.decision);
const regime = readJson(input.regime);
const legacyLive = readJson(input.legacyLive, {});
const fetchStatus = readJson(input.fetchStatus, {});
const market = readJson(input.market, {});
const researchAudit = readJson(input.researchAudit, {});
const generatedAt = new Date().toISOString();
const ledger = readJson(ledgerPath, {
  schemaVersion: '17.0.0-ledger',
  createdAt: generatedAt,
  entries: [],
});
if (!Array.isArray(ledger.entries)) ledger.entries = [];

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

const rows = Array.isArray(market.rows) ? market.rows : [];
const pricedRows = rows.filter(row => finite(row.price ?? row.last) !== null);
const ohlcRows = rows.filter(row => [row.open, row.high, row.low, row.price ?? row.last].every(value => finite(value) !== null));
const cleanNameRows = rows.filter(row => isCleanCompanyName(row.name_ar || row.name_en));
const marketQuality = {
  totalRows: rows.length,
  pricedRows: pricedRows.length,
  completeOhlcRows: ohlcRows.length,
  cleanCompanyNameRows: cleanNameRows.length,
  pricedCoveragePct: rows.length ? round(pricedRows.length / rows.length * 100, 2) : 0,
  completeOhlcPct: rows.length ? round(ohlcRows.length / rows.length * 100, 2) : 0,
  cleanCompanyNamePct: rows.length ? round(cleanNameRows.length / rows.length * 100, 2) : 0,
};

const nativeEvidence = nativeLedgerSummary(ledger);
const nativeGate = nativeEvidence.gate;
const evidenceScore = round(clamp(
  Math.min(1, nativeGate.resolvedBaskets / nativeGate.minimumResolvedBaskets) * 40
  + Math.min(1, nativeGate.resolvedMembers / nativeGate.minimumResolvedMembers) * 40
  + Math.min(1, nativeGate.observedCalendarDays / nativeGate.minimumObservedCalendarDays) * 20,
  0,
  100,
), 2);
const dataScore = round(clamp(
  (sessionAligned ? 30 : 0)
  + (executionGrade ? 25 : 0)
  + marketQuality.pricedCoveragePct * 0.15
  + marketQuality.completeOhlcPct * 0.15
  + marketQuality.cleanCompanyNamePct * 0.1,
  0,
  95,
), 2);
const operationalScore = round(clamp(
  35
  + (sessionAligned ? 20 : 0)
  + (duplicateTickers.length === 0 ? 15 : 0)
  + (totalAllocationPct <= 50 ? 15 : 0)
  + (ledger.entries.some(entry => entry.signalId === signalId) ? 15 : 0),
  0,
  100,
), 2);
const professionalEvidenceReady = nativeGate.passed === true;
const releaseStage = professionalEvidenceReady ? 'PROFESSIONAL_EVIDENCE' : 'CONTROLLED_PILOT';

const legacyStrategyEvidence = (Array.isArray(legacyLive.byStrategy) ? legacyLive.byStrategy : []).find(row => row.name === engineId) || null;
const auditMetrics = researchAudit.basketReturnMetrics || {};
const status = sessionAligned && executionGrade ? 'READY_FOR_NEXT_SESSION_REVIEW' : 'BLOCKED_STALE_OR_UNVERIFIED_DATA';
const hotMomentumCount = normalizedRecommendations.filter(row => row.hotMomentumRisk).length;

const snapshot = {
  schemaVersion: '17.0.0-rc2',
  generatedAt,
  status,
  statusAr: status === 'READY_FOR_NEXT_SESSION_REVIEW'
    ? 'البيانات متسقة والسلة جاهزة للمراجعة قبل الجلسة، وليست أمر شراء آليًا.'
    : 'تم إيقاف التوصيات بسبب عدم اتساق الجلسة أو عدم اكتمال درجة التنفيذ.',
  sessionDate,
  nextSessionPlan: true,
  engine: {
    id: engineId,
    version: '17.0-isolated-v16.9-method',
    labelAr: 'سلة احتمالية متساوية الأوزان — تشغيل V17 معزول',
    singleProductionEngine: true,
    selectionMethodFrozen: true,
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
      ? 'اكتملت بوابات V17 الأصلية للعينة والزمن.'
      : 'التطبيق في وضع Pilot مضبوط؛ قوة السوق والاختبار التاريخي لا يساويان دليلًا حيًا خاصًا بـV17.',
  },
  portfolioPolicy: {
    maximumTotalAllocationPct: 50,
    plannedAllocationPct: round(totalAllocationPct, 2),
    cashReservePct: round(100 - totalAllocationPct, 2),
    unfilledMemberPolicy: 'KEEP_CASH',
    automaticOrders: false,
    sameSessionAmbiguityPolicy: 'CONSERVATIVE_STOP',
  },
  recommendations: normalizedRecommendations,
  decisionWarnings: {
    hotMomentumCount,
    allMembersHotMomentum: hotMomentumCount === normalizedRecommendations.length,
    openingConfirmationMandatory: true,
    warningAr: hotMomentumCount
      ? `${hotMomentumCount} من ${normalizedRecommendations.length} أسهم تحمل زخمًا ساخنًا؛ لا تنفيذ خارج نطاق الافتتاح ولا مطاردة للسعر.`
      : 'لا توجد إشارات زخم ساخن في السلة الحالية.',
  },
  evidence: {
    nativeV17: nativeEvidence,
    legacyMethodEvidence: compactLegacyStrategy(legacyStrategyEvidence),
    researchAudit: {
      auditWindow: researchAudit.auditWindow || null,
      executableSelections: finite(researchAudit.executableByOpenRuleCount),
      conservativeTargetHitRatePct: finite(researchAudit.conservativeTargetHitRateOfExecutablePct),
      positiveBasketSessionPct: finite(researchAudit.positiveBasketSessionPct),
      averageNetReturnPct: finite(auditMetrics.averageNetReturnPct),
      profitFactor: finite(auditMetrics.profitFactor),
      maximumDrawdownPct: finite(auditMetrics.maximumDrawdownPct),
      limitationsAr: Array.isArray(researchAudit.limitationsAr) ? researchAudit.limitationsAr : [],
      provenance: 'HISTORICAL_RESEARCH_NOT_LIVE_EVIDENCE',
    },
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
    marketDataQuality: marketQuality,
  },
  lineage: {
    decisionSource: 'data/stable/v16-v169-primary-decision.json',
    regimeSource: 'data/stable/v16-market-regime.json',
    legacyEvidenceSource: 'data/stable/v16-live-evidence.json',
    historicalAuditSource: 'data/research/v16-v169-target-hit-audit.json',
    marketSource: 'data/market.json',
    nativeLedger: 'data/v17/ledger.json',
    canonicalPath: 'data/v17/current.json',
  },
};

writeJsonAtomic(snapshotPath, snapshot);
writeJsonAtomic(ledgerPath, ledger);

console.log(JSON.stringify({
  status: snapshot.status,
  sessionDate,
  engineId,
  recommendationCount: normalizedRecommendations.length,
  totalAllocationPct,
  scores: snapshot.readiness,
  marketQuality,
  nativeEvidence,
  ledgerEntries: ledger.entries.length,
}, null, 2));
