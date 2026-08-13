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
  history50: P('data/history-50.json'),
  currentResearch: P('data/today-decision-center.json'),
  resilient: P('data/v17/resilient-session-status.json'),
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

function latestHistorySession(history) {
  const dates = [];
  for (const rows of Object.values(history?.symbols || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const date = String(row?.date || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
    }
  }
  return dates.sort().at(-1) || null;
}

function mapChampionRecommendation(row, index) {
  return {
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
    opportunityState: 'CHAMPION_REFERENCE',
    executionAllowed: true,
    monitorOnly: false,
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
  };
}

function mapResearchOpportunity(row, index) {
  return {
    ticker: String(row.symbol || '').trim().toUpperCase(),
    companyNameAr: row.name || row.symbol,
    rank: index + 1,
    grade: row.grade || 'Watch',
    entryLow: finite(row.entryFrom),
    entryHigh: finite(row.entryTo),
    target: finite(row.target1),
    target2: finite(row.target2),
    stop: finite(row.stopLoss),
    support1: finite(row.support1),
    resistance1: finite(row.resistance1),
    referenceClose: finite(row.price),
    portfolioWeightPct: 0,
    basketWeightPct: 0,
    holdingSessions: 1,
    probabilityTop10Pct: finite(row.targetProbability, finite(row.confidence)),
    rsi14: null,
    volumeRatio20: null,
    hotMomentumRisk: false,
    opportunityState: row.opportunityState || 'CONDITIONAL_WATCH',
    executionAllowed: false,
    monitorOnly: true,
    provisionalPlan: row.provisionalPlan !== false,
    srVerified: row.srVerified === true,
    why: row.why || null,
    reason: row.reason || null,
    state: 'RESEARCH_WATCH_ONLY',
    cashIfNotTriggered: true,
    executionRules: {
      cancelIfOpenAbove: finite(row.entryTo),
      cancelIfOpenBelow: finite(row.stopLoss),
      observeFirstMinutes: 15,
      requireOpeningInsideRange: true,
      requireLiquidityConfirmation: true,
      chaseForbidden: true,
    },
  };
}

const decision = readJson(files.decision);
const regime = readJson(files.regime);
const legacyLive = readJson(files.legacyLive, {});
const fetchStatus = readJson(files.fetchStatus, {});
const market = readJson(files.market, {});
const history50 = readJson(files.history50, {});
const currentResearch = readJson(files.currentResearch, {});
const resilient = readJson(files.resilient, {});
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
  throw new Error(`Champion basket size must be 3–5; received ${sourceRecommendations.length}`);
}
const championReferenceRecommendations = sourceRecommendations.map(mapChampionRecommendation);
for (const row of championReferenceRecommendations) {
  if (!row.ticker || ![row.entryLow, row.entryHigh, row.target, row.stop].every(Number.isFinite)) {
    throw new Error(`Incomplete champion price plan for ${row.ticker || 'unknown'}`);
  }
  if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) {
    throw new Error(`Invalid champion price relationship for ${row.ticker}`);
  }
}
const championAllocationPct = championReferenceRecommendations.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0);
if (championAllocationPct > 50.001) throw new Error(`Champion exposure exceeds 50%: ${championAllocationPct}`);

const championSessionDate = decision.sessionDate || decision.expectedLatestSession;
const championRegimeSession = regime?.metrics?.sessionDate || null;
const latestMarketSession = latestHistorySession(history50);
const researchSessionDate = currentResearch.sessionDate || latestMarketSession;
const currentSourceSession = researchSessionDate || latestMarketSession || null;
const researchSessionAligned = Boolean(researchSessionDate && latestMarketSession && researchSessionDate === latestMarketSession);
const championReferenceCurrent = Boolean(championSessionDate && latestMarketSession && championSessionDate === latestMarketSession);
const championInternalSessionAligned = Boolean(championSessionDate && championSessionDate === championRegimeSession);
const resilientResearchAllowed = resilient?.confidencePolicy?.allowResearchRanking !== false && resilient?.mode !== 'BLOCKED';
const resilientExecutionAllowed = resilient?.confidencePolicy?.allowExecutionGradeClaim === true && resilient?.mode === 'NORMAL';
const researchRows = Array.isArray(currentResearch.rankedOpportunities) ? currentResearch.rankedOpportunities : [];
const validResearchRows = researchRows.filter(row => row?.symbol && [row.entryFrom, row.entryTo, row.target1, row.stopLoss].every(value => finite(value) !== null));
const researchReady = Boolean(researchSessionAligned && resilientResearchAllowed && validResearchRows.length >= 3);
const championExecutionGrade = decision?.priceTruth?.executionGrade === true || fetchStatus.executionGrade === true || fetchStatus.mode === 'v15_precise_public_execution_grade';
const executionReady = Boolean(championReferenceCurrent && championInternalSessionAligned && championExecutionGrade && resilientExecutionAllowed);

const currentRecommendations = executionReady
  ? championReferenceRecommendations
  : validResearchRows.slice(0, 5).map(mapResearchOpportunity);
for (const row of currentRecommendations) {
  if (![row.entryLow, row.entryHigh, row.target, row.stop].every(Number.isFinite)) continue;
  if (!(row.stop < row.entryLow && row.entryLow <= row.entryHigh && row.target > row.entryHigh)) {
    throw new Error(`Invalid current research price relationship for ${row.ticker}`);
  }
}

const effectiveAllocationPct = executionReady ? championAllocationPct : 0;
const effectiveCashPct = 100 - effectiveAllocationPct;

// Preserve the frozen champion signal contract. A stale champion reference is never
// retroactively issued as a new current signal merely because V17 was rebuilt later.
if (executionReady) {
  const immutablePayload = {
    sessionDate: championSessionDate,
    engineId,
    recommendations: championReferenceRecommendations.map(row => ({
      ticker: row.ticker,
      entryLow: row.entryLow,
      entryHigh: row.entryHigh,
      target: row.target,
      stop: row.stop,
      portfolioWeightPct: row.portfolioWeightPct,
    })),
  };
  const signalId = `${championSessionDate}:${engineId}`;
  const signalHash = hash(immutablePayload);
  const existing = ledger.entries.find(entry => entry.signalId === signalId);
  if (existing && existing.signalHash !== signalHash) throw new Error(`Immutable ledger conflict for ${signalId}`);
  if (!existing) ledger.entries.push({ signalId, signalHash, issuedAt: now, ...immutablePayload, status: 'ISSUED_PENDING_NEXT_SESSION' });
}
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
  (researchSessionAligned ? 30 : 0)
  + (resilientResearchAllowed ? 15 : 0)
  + (resilientExecutionAllowed ? 10 : 0)
  + marketDataQuality.pricedCoveragePct * 0.15
  + marketDataQuality.completeOhlcPct * 0.15
  + marketDataQuality.cleanCompanyNamePct * 0.1,
  0,
  95,
));
const operationalIntegrityScore = round(clamp(
  35 + (researchSessionAligned ? 20 : 0) + 15 + (effectiveAllocationPct <= 50 ? 15 : 0)
  + (challenger.promotionAllowed === false ? 10 : 0)
  + (!executionReady && effectiveAllocationPct === 0 ? 5 : 0),
  0,
  100,
));
const professionalEvidenceReady = nativeGate.passed === true;
const legacyStrategy = (Array.isArray(legacyLive.byStrategy) ? legacyLive.byStrategy : []).find(row => row.name === engineId) || null;
const auditMetrics = researchAudit.basketReturnMetrics || {};
const executionBlockedReasons = [];
if (!championReferenceCurrent) executionBlockedReasons.push('CHAMPION_REFERENCE_STALE');
if (!championInternalSessionAligned) executionBlockedReasons.push('CHAMPION_REGIME_SESSION_MISMATCH');
if (!championExecutionGrade) executionBlockedReasons.push('CHAMPION_NOT_EXECUTION_GRADE');
if (!resilientExecutionAllowed) executionBlockedReasons.push('CURRENT_SOURCE_NOT_EXECUTION_READY');
if (finite(currentResearch?.summary?.executionCount, 0) === 0) executionBlockedReasons.push('NO_CURRENT_EXECUTABLE_OPPORTUNITIES');

let status;
if (executionReady) status = 'READY_FOR_NEXT_SESSION_REVIEW';
else if (researchReady) status = 'RESEARCH_READY_EXECUTION_BLOCKED';
else status = 'BLOCKED_STALE_OR_UNVERIFIED_DATA';

const currentSessionDate = researchSessionDate || latestMarketSession || championSessionDate || null;
const statusAr = status === 'READY_FOR_NEXT_SESSION_REVIEW'
  ? 'القرار الحالي متزامن مع جلسة السوق واجتاز بوابات التنفيذ، مع بقاء التنفيذ يدويًا ومشروطًا.'
  : status === 'RESEARCH_READY_EXECUTION_BLOCKED'
    ? 'مسح السوق الحالي صالح للبحث والمتابعة فقط. لا توجد أوزان استثمارية أو أوامر تنفيذ لأن قرار Champion المرجعي أو مصادر التنفيذ غير مكتملة للجلسة الحالية.'
    : 'تم إيقاف التوصيات الحالية بسبب نقص حقيقة الجلسة أو جودة البيانات.';

const snapshot = {
  schemaVersion: '17.0.0-rc4',
  generatedAt: now,
  status,
  statusAr,
  sessionDate: currentSessionDate,
  nextSessionPlan: executionReady,
  recommendationMode: executionReady ? 'CHAMPION_EXECUTION_REVIEW' : 'CURRENT_RESEARCH_WATCH_ONLY',
  engine: {
    id: engineId,
    version: '17.0-isolated-v16.9-champion',
    labelAr: 'V16.9 Champion محفوظ — V17 طبقة بحث ومراقبة معزولة',
    singleProductionEngine: true,
    selectionMethodFrozen: true,
  },
  championReference: {
    sessionDate: championSessionDate,
    currentForMarketSession: championReferenceCurrent,
    internallySessionAligned: championInternalSessionAligned,
    executionGrade: championExecutionGrade,
    plannedAllocationPct: round(championAllocationPct),
    recommendations: championReferenceRecommendations,
    regimeReference: {
      sessionDate: championRegimeSession,
      regime: regime.regime || null,
      labelAr: regime.labelAr || null,
      score: finite(regime.score),
      riskMultiplier: finite(regime.riskMultiplier),
      maxTradeRiskPct: finite(regime.maxTradeRiskPct),
      guidanceAr: regime.guidanceAr || null,
    },
    disclosureAr: championReferenceCurrent
      ? 'مرجع Champion متزامن مع جلسة السوق الحالية.'
      : `قرار Champion محفوظ كمرجع تاريخي فقط لأنه يعود إلى ${championSessionDate || 'جلسة غير معلومة'} وليس جلسة السوق الحالية ${currentSessionDate || 'غير معلومة'}.`,
  },
  currentResearch: {
    sessionDate: researchSessionDate,
    generatedAt: currentResearch.generatedAt || null,
    researchReady,
    executionCount: finite(currentResearch?.summary?.executionCount, 0),
    rankedCount: finite(currentResearch?.summary?.rankedCount, validResearchRows.length),
    conditionalWatchCount: finite(currentResearch?.summary?.conditionalWatchCount, 0),
    supportResistanceCoveragePct: finite(currentResearch?.summary?.supportResistanceCoveragePct, 0),
    mainDecision: currentResearch.mainDecision || null,
    caution: currentResearch.caution || null,
    provenance: 'CURRENT_SESSION_RESEARCH_NOT_AUTOMATIC_EXECUTION',
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
    sessionDate: currentSessionDate,
    regime: championReferenceCurrent ? regime.regime : 'UNVERIFIED_CURRENT_REGIME',
    labelAr: championReferenceCurrent ? regime.labelAr : 'لم يُعاد احتساب حالة السوق الحالية بمحرك V16 المجمد؛ مرجع الحالة القديم معروض منفصلًا.',
    score: championReferenceCurrent ? finite(regime.score) : null,
    riskMultiplier: championReferenceCurrent ? finite(regime.riskMultiplier) : null,
    maxTradeRiskPct: executionReady ? finite(regime.maxTradeRiskPct, 0) : 0,
    guidanceAr: executionReady
      ? regime.guidanceAr
      : 'المتابعة بحثية فقط حتى تتزامن بوابات التنفيذ مع جلسة السوق الحالية.',
    metrics: championReferenceCurrent ? (regime.metrics || {}) : {},
  },
  readiness: {
    releaseStage: professionalEvidenceReady ? 'PROFESSIONAL_EVIDENCE' : 'CONTROLLED_PILOT',
    professionalEvidenceReady,
    researchReady,
    executionReady,
    marketStrengthScore: championReferenceCurrent ? finite(regime.score) : null,
    dataQualityScore,
    liveEvidenceScore,
    operationalIntegrityScore,
    disclosureAr: executionReady
      ? 'بوابات الجلسة الحالية تسمح بالمراجعة التنفيذية اليدوية؛ لا توجد أوامر آلية.'
      : 'قوة البحث الحالية منفصلة عن التنفيذ. أي Champion قديم لا يُعرض كتوصية حالية ولا يحصل على وزن استثماري.',
  },
  portfolioPolicy: {
    maximumTotalAllocationPct: 50,
    plannedAllocationPct: round(effectiveAllocationPct),
    cashReservePct: round(effectiveCashPct),
    unfilledMemberPolicy: 'KEEP_CASH',
    automaticOrders: false,
    sameSessionAmbiguityPolicy: 'CONSERVATIVE_STOP',
    researchWatchAllocationPct: 0,
  },
  recommendations: currentRecommendations,
  decisionWarnings: {
    researchOnly: !executionReady,
    openingConfirmationMandatory: executionReady,
    executionBlockedReasons,
    warningAr: executionReady
      ? 'التنفيذ يظل مشروطًا بالافتتاح والسيولة وعدم مطاردة السعر.'
      : `مراقبة فقط دون تنفيذ أو أوزان محفظة. أسباب الحظر: ${executionBlockedReasons.join('، ') || 'بوابة التنفيذ غير مكتملة'}.`,
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
    sessionAligned: researchSessionAligned,
    executionGrade: executionReady,
    sourceSession: currentSourceSession,
    decisionSession: currentSessionDate,
    latestMarketSession,
    championReferenceSession: championSessionDate,
    championRegimeSession,
    championReferenceStale: !championReferenceCurrent,
    resilientMode: resilient.mode || null,
    resilientReasons: Array.isArray(resilient.reasons) ? resilient.reasons : [],
    fetchedRows: finite(fetchStatus.marketRows, marketRows.length),
    sourceName: fetchStatus.sourceName || market.source || null,
    staleDataBlocked: !researchSessionAligned,
    executionBlockedReasons,
    marketDataQuality,
  },
  lineage: {
    championDecisionSource: 'data/stable/v16-v169-primary-decision.json',
    championRegimeSource: 'data/stable/v16-market-regime.json',
    currentResearchSource: 'data/today-decision-center.json',
    currentSessionTruthSource: 'data/history-50.json',
    resilientSessionGate: 'data/v17/resilient-session-status.json',
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
  currentSessionDate,
  latestMarketSession,
  championSessionDate,
  championReferenceCurrent,
  researchReady,
  executionReady,
  recommendationMode: snapshot.recommendationMode,
  recommendationCount: currentRecommendations.length,
  effectiveAllocationPct,
  readiness: snapshot.readiness,
  marketDataQuality,
  nativeV17,
  challengerStatus: challenger.status,
  ledgerEntries: ledger.entries.length,
}, null, 2));