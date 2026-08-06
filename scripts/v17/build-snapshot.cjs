#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = relative => path.join(root, relative);
const files = {
  decision: P('data/stable/v16-v169-primary-decision.json'),
  regime: P('data/stable/v16-market-regime.json'),
  legacyLive: P('data/stable/v16-live-evidence.json'),
  fetchStatus: P('data/fetch-status.json'),
  market: P('data/market.json'),
  researchAudit: P('data/research/v16-v169-target-hit-audit.json'),
  challenger: P('data/v17/challenger-status.json'),
  snapshot: P('data/v17/current.json'),
  ledger: P('data/v17/ledger.json'),
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (arguments.length > 1) return fallback;
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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function profitFactor(values) {
  const gains = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  return losses > 0 ? gains / losses : gains > 0 ? null : 0;
}

function maximumDrawdown(values) {
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

function cleanCompanyName(value) {
  const text = String(value || '').trim();
  return text.length >= 2 && !/End AdSlot|-->|\[[0-9,]+\]|^[0-9,\[\]]{5,}/i.test(text);
}

function compactLegacy(row) {
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

function summarizeLedger(ledger) {
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
  const pf = profitFactor(returns);
  return {
    issuedBaskets: entries.length,
    resolvedBaskets: resolved.length,
    pendingBaskets: entries.length - resolved.length,
    resolvedMembers: members.length,
    wins,
    losses,
    winRatePct: returns.length ? round(wins / returns.length * 100) : null,
    averageBasketReturnPct: returns.length ? round(average(returns), 4) : null,
    profitFactor: returns.length && pf !== null ? round(pf, 4) : null,
    maxDrawdownPct: returns.length ? round(maximumDrawdown(returns), 4) : null,
    firstSignalDate: firstDate,
    latestOutcomeDate: outcomeDates.at(-1) || null,
    gate,
  };
}

const decision = readJson(files.decision);
const regime = readJson(files.regime);
const legacyLive = readJson(files.legacyLive, {});
const fetchStatus = readJson(files.fetchStatus, {});
const market = readJson(files.market, {});
const researchAudit = readJson(files.researchAudit, {});
const challenger = readJson(files.challenger);
const now = new Date().toISOString();
const ledger = readJson(files.ledger, { schemaVersion: '17.0.0-ledger', createdAt: now, entries: [] });
if (!Array.isArray(ledger.entries)) ledger.entries = [];

const engineId = decision?.selectedModel?.id;
if (engineId !== 'V16_9_EQUAL_WEIGHT_BASKET') throw new Error(`Unexpected production engine: ${engineId}`);
if (challenger.activeEngine !== engineId || challenger.promotionAllowed !== false) {
  throw new Error('Champion-challenger governance attempted an automatic engine change.');
}

const sourceRecommendations = Array.isArray(decision.recommendations) ? decision.recommendations : [];
if (sourceRecommendations.length < 3 || sourceRecommendations.length > 5) {
  throw new Error(`Basket size must be 3–5; received ${sourceRecommendations.length}`);
}

const recommendations = sourceRecommendations.map((row, index) => ({
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

const tickers = recommendations.map(row => row.ticker);
if (new Set(tickers).size !== tickers.length) throw new Error('Duplicate basket ticker detected.');
for (const row of recommendations) {
  if (!row.ticker || ![row.entryLow, row.entryHigh, row.target, row.stop].every(Number.isFinite)) {
    throw new Error(`Incomplete price plan for ${row.ticker || 'unknown'}`);
  }
  if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) {
    throw new Error(`Invalid price relationship for ${row.ticker}`);
  }
}

const totalAllocationPct = recommendations.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0);
if (totalAllocationPct > 50.001) throw new Error(`Exposure exceeds 50%: ${totalAllocationPct}`);

const sessionDate = decision.sessionDate || decision.expectedLatestSession;
const regimeSession = regime?.metrics?.sessionDate;
const sourceSession = fetchStatus.lastSession || fetchStatus.sessionDate || decision?.priceTruth?.sourceSession || decision?.priceTruth?.sessionDate || sessionDate;
const sessionAligned = Boolean(sessionDate && sessionDate === regimeSession && sessionDate === sourceSession);
const executionGrade = decision?.priceTruth?.executionGrade === true || fetchStatus.executionGrade === true || fetchStatus.mode === 'v15_precise_public_execution_grade';

// This payload intentionally preserves the original issued-signal contract. New
// analytical fields must never alter the hash of an already issued signal.
const immutablePayload = {
  sessionDate,
  engineId,
  recommendations: recommendations.map(row => ({
    ticker: row.ticker,
    entryLow: row.entryLow,
    entryHigh: row.entryHigh,
    target: row.target,
    stop: row.stop,
    portfolioWeightPct: row.portfolioWeightPct,
  })),
};
const signalId = `${sessionDate}:${engineId}`;
const signalHash = hash(immutablePayload);
const existing = ledger.entries.find(entry => entry.signalId === signalId);
if (existing && existing.signalHash !== signalHash) throw new Error(`Immutable ledger conflict for ${signalId}`);
if (!existing) ledger.entries.push({ signalId, signalHash, issuedAt: now, ...immutablePayload, status: 'ISSUED_PENDING_NEXT_SESSION' });
ledger.updatedAt = now;

const marketRows = Array.isArray(market.rows) ? market.rows : [];
const pricedRows = marketRows.filter(row => finite(row.price ?? row.last) !== null);
const ohlcRows = marketRows.filter(row => [row.open, row.high, row.low, row.price ?? row.last].every(value => finite(value) !== null));
const cleanNameRows = marketRows.filter(row => cleanCompanyName(row.name_ar || row.name_en));
const marketDataQuality = {
  totalRows: marketRows.length,
  pricedRows: pricedRows.length,
  completeOhlcRows: ohlcRows.length,
  cleanCompanyNameRows: cleanNameRows.length,
  pricedCoveragePct: marketRows.length ? round(pricedRows.length / marketRows.length * 100) : 0,
  completeOhlcPct: marketRows.length ? round(ohlcRows.length / marketRows.length * 100) : 0,
  cleanCompanyNamePct: marketRows.length ? round(cleanNameRows.length / marketRows.length * 100) : 0,
};

const nativeV17 = summarizeLedger(ledger);
const nativeGate = nativeV17.gate;
const liveEvidenceScore = round(clamp(
  Math.min(1, nativeGate.resolvedBaskets / nativeGate.minimumResolvedBaskets) * 40
  + Math.min(1, nativeGate.resolvedMembers / nativeGate.minimumResolvedMembers) * 40
  + Math.min(1, nativeGate.observedCalendarDays / nativeGate.minimumObservedCalendarDays) * 20,
  0,
  100,
));
const dataQualityScore = round(clamp(
  (sessionAligned ? 30 : 0)
  + (executionGrade ? 25 : 0)
  + marketDataQuality.pricedCoveragePct * 0.15
  + marketDataQuality.completeOhlcPct * 0.15
  + marketDataQuality.cleanCompanyNamePct * 0.1,
  0,
  95,
));
const operationalIntegrityScore = round(clamp(
  35 + (sessionAligned ? 20 : 0) + 15 + (totalAllocationPct <= 50 ? 15 : 0)
  + (ledger.entries.some(entry => entry.signalId === signalId) ? 10 : 0)
  + (challenger.promotionAllowed === false ? 5 : 0),
  0,
  100,
));
const professionalEvidenceReady = nativeGate.passed === true;
const legacyStrategy = (Array.isArray(legacyLive.byStrategy) ? legacyLive.byStrategy : []).find(row => row.name === engineId) || null;
const auditMetrics = researchAudit.basketReturnMetrics || {};
const hotMomentumCount = recommendations.filter(row => row.hotMomentumRisk).length;
const status = sessionAligned && executionGrade ? 'READY_FOR_NEXT_SESSION_REVIEW' : 'BLOCKED_STALE_OR_UNVERIFIED_DATA';

const snapshot = {
  schemaVersion: '17.0.0-rc3',
  generatedAt: now,
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
  championChallenger: {
    activeEngine: challenger.activeEngine,
    status: challenger.status,
    statusAr: challenger.statusAr,
    challenger: challenger.challenger || null,
    promotionAllowed: false,
    nextAction: challenger.nextAction || null,
  },
  market: {
    sessionDate: regimeSession,
    regime: regime.regime,
    labelAr: regime.labelAr,
    score: finite(regime.score),
    riskMultiplier: finite(regime.riskMultiplier),
    maxTradeRiskPct: finite(regime.maxTradeRiskPct),
    guidanceAr: regime.guidanceAr,
    metrics: regime.metrics || {},
  },
  readiness: {
    releaseStage: professionalEvidenceReady ? 'PROFESSIONAL_EVIDENCE' : 'CONTROLLED_PILOT',
    professionalEvidenceReady,
    marketStrengthScore: finite(regime.score),
    dataQualityScore,
    liveEvidenceScore,
    operationalIntegrityScore,
    disclosureAr: professionalEvidenceReady
      ? 'اكتملت بوابات V17 الأصلية للعينة والزمن.'
      : 'التطبيق في وضع Pilot مضبوط؛ قوة السوق والاختبار التاريخي لا يساويان دليلًا حيًا خاصًا بـV17.',
  },
  portfolioPolicy: {
    maximumTotalAllocationPct: 50,
    plannedAllocationPct: round(totalAllocationPct),
    cashReservePct: round(100 - totalAllocationPct),
    unfilledMemberPolicy: 'KEEP_CASH',
    automaticOrders: false,
    sameSessionAmbiguityPolicy: 'CONSERVATIVE_STOP',
  },
  recommendations,
  decisionWarnings: {
    hotMomentumCount,
    allMembersHotMomentum: hotMomentumCount === recommendations.length,
    openingConfirmationMandatory: true,
    warningAr: hotMomentumCount
      ? `${hotMomentumCount} من ${recommendations.length} أسهم تحمل زخمًا ساخنًا؛ لا تنفيذ خارج نطاق الافتتاح ولا مطاردة للسعر.`
      : 'لا توجد إشارات زخم ساخن في السلة الحالية.',
  },
  evidence: {
    nativeV17,
    legacyMethodEvidence: compactLegacy(legacyStrategy),
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
    regimeSession,
    fetchedRows: finite(fetchStatus.marketRows, finite(decision?.priceTruth?.acceptedRows)),
    sourceName: fetchStatus.sourceName || decision?.priceTruth?.source || null,
    staleDataBlocked: !sessionAligned,
    marketDataQuality,
  },
  lineage: {
    decisionSource: 'data/stable/v16-v169-primary-decision.json',
    regimeSource: 'data/stable/v16-market-regime.json',
    legacyEvidenceSource: 'data/stable/v16-live-evidence.json',
    historicalAuditSource: 'data/research/v16-v169-target-hit-audit.json',
    marketSource: 'data/market.json',
    nativeLedger: 'data/v17/ledger.json',
    challengerGateSource: 'data/v17/challenger-status.json',
    canonicalPath: 'data/v17/current.json',
  },
};

writeJsonAtomic(files.snapshot, snapshot);
writeJsonAtomic(files.ledger, ledger);
console.log(JSON.stringify({
  status,
  sessionDate,
  engineId,
  recommendationCount: recommendations.length,
  totalAllocationPct,
  readiness: snapshot.readiness,
  marketDataQuality,
  nativeV17,
  challengerStatus: challenger.status,
  ledgerEntries: ledger.entries.length,
}, null, 2));
