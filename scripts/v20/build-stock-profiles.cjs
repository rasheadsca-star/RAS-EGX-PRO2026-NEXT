#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function pct(value) {
  const n = finite(value);
  if (n === null) return null;
  return Math.round(n * 10) / 10;
}
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function clamp(value, min = 0, max = 100) {
  const n = finite(value);
  if (n === null) return null;
  return Math.max(min, Math.min(max, n));
}
function avg(values) {
  const nums = values.map(finite).filter(v => v !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
function piecewise(value, points) {
  const n = finite(value);
  if (n === null) return null;
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (n <= x2) {
      const t = (n - x1) / (x2 - x1);
      return y1 + (y2 - y1) * t;
    }
  }
  return points[points.length - 1][1];
}
function decisionComponent(name, weightPct, score, provenance, evidence = {}) {
  const normalized = score === null ? null : clamp(score);
  return {
    name,
    weightPct,
    available: normalized !== null,
    score: normalized === null ? null : round(normalized, 1),
    weightedPoints: normalized === null ? 0 : round(normalized * weightPct / 100, 3),
    provenance,
    evidence,
  };
}
function decisionRrScore(netRr) {
  return piecewise(netRr, [[-1,0],[0,0],[0.25,20],[0.5,35],[1,55],[1.5,70],[2,82],[3,95],[4,100]]);
}
function decisionAlignmentScore(alignment) {
  const state = String(alignment?.state || '');
  if (state === 'IN_ENTRY_RANGE') return 100;
  if (state === 'BELOW_ENTRY_RANGE_WAITING') return 70;
  if (state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') return 30;
  if (state.startsWith('REBUILD_REQUIRED')) return 0;
  if (state === 'INVALID_PLAN_RELATION') return 0;
  return null;
}
function decisionSrScore(sr) {
  if (!sr) return null;
  const statusScore = sr.sessionAligned !== true ? 25 : sr.executionEligible === true ? 100 : 65;
  const confRaw = finite(sr.confidence);
  const confPct = confRaw === null ? null : clamp(confRaw <= 1 ? confRaw * 100 : confRaw);
  return avg([statusScore, confPct]);
}
function decisionLiquidityScore(liquidity) {
  if (!liquidity || liquidity.evidenceAvailable !== true) return null;
  const raw = clamp(liquidity.liquidityScore);
  if (raw === null) return null;
  if (liquidity.sessionAligned !== true) return Math.min(raw, 25);
  return raw;
}
function decisionDataScore(profile) {
  const completeness = clamp(profile.marketSnapshot?.criticalFieldCompletenessPct);
  const srConfRaw = finite(profile.supportResistance?.confidence);
  const srConf = srConfRaw === null ? null : clamp(srConfRaw <= 1 ? srConfRaw * 100 : srConfRaw);
  const blockers = new Set(profile.whyThisStock?.blockers || []);
  let sourceIntegrity = 100;
  if (blockers.has('CRITICAL_SOURCE_CONFLICT')) sourceIntegrity = 0;
  else if (blockers.has('MISSING_CRITICAL_SYMBOL_EVIDENCE')) sourceIntegrity = 35;
  return avg([completeness, srConf, sourceIntegrity]);
}
function decisionTechnicalScore(ta) {
  if (ta?.currentTechnicalReady !== true || ta?.usedForCurrentDecision !== true) return null;
  const parts = [];
  const trend = String(ta.trend || '').toUpperCase();
  if (trend === 'BULLISH') parts.push(85);
  else if (trend === 'NEUTRAL' || trend === 'SIDEWAYS') parts.push(55);
  else if (trend === 'BEARISH') parts.push(25);
  const rsi = finite(ta.rsi14);
  if (rsi !== null) parts.push(rsi >= 45 && rsi <= 65 ? 100 : rsi >= 35 && rsi <= 75 ? 70 : 30);
  const hist = finite(ta.macdHistogram);
  if (hist !== null) parts.push(hist > 0 ? 80 : hist < 0 ? 35 : 55);
  const mom20 = finite(ta.momentum20Pct);
  if (mom20 !== null) parts.push(mom20 > 0 ? Math.min(100, 60 + mom20 * 4) : Math.max(15, 50 + mom20 * 4));
  return avg(parts);
}
function decisionNextCondition(alignment) {
  const state = String(alignment?.state || '');
  if (state === 'IN_ENTRY_RANGE') return 'ENTRY_ZONE_PRESENT_EXECUTION_GATE_STILL_SEPARATE';
  if (state === 'BELOW_ENTRY_RANGE_WAITING') return 'WAIT_FOR_PRICE_TO_ENTER_ISSUED_ENTRY_RANGE';
  if (state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') return 'DO_NOT_CHASE_WAIT_FOR_NEW_VALID_PLAN_OR_REENTRY';
  if (state.startsWith('REBUILD_REQUIRED')) return 'REBUILD_TRADE_PLAN_AFTER_SOURCE_REVIEW';
  if (state === 'INVALID_PLAN_RELATION') return 'INVALID_PLAN_REQUIRES_REBUILD';
  return 'REVIEW_TRADE_PLAN_STATE';
}
function decisionTier(score, coveragePct, policy) {
  if (finite(score) === null || finite(coveragePct) === null || coveragePct < policy.minimumEvidenceCoverageForTierPct) return 'UNRATED_INSUFFICIENT_EVIDENCE';
  if (score >= policy.tierThresholds.RESEARCH_A) return 'RESEARCH_A';
  if (score >= policy.tierThresholds.RESEARCH_B) return 'RESEARCH_B';
  if (score >= policy.tierThresholds.RESEARCH_C) return 'RESEARCH_C';
  return 'RESEARCH_D';
}
function decisionNarrativeAr(row) {
  const score = row.researchDecisionScore === null ? 'غير مصنف' : `${row.researchDecisionScore}/100`;
  const tier = row.researchTier === 'UNRATED_INSUFFICIENT_EVIDENCE' ? 'أدلة غير كافية' : row.researchTier;
  const next = ({
    ENTRY_ZONE_PRESENT_EXECUTION_GATE_STILL_SEPARATE: 'السعر داخل نطاق الدخول المرجعي، لكن إذن التنفيذ يظل منفصلًا وخاضعًا لبوابة V17.',
    WAIT_FOR_PRICE_TO_ENTER_ISSUED_ENTRY_RANGE: 'السعر أسفل نطاق الدخول؛ المطلوب الانتظار حتى دخول النطاق المرجعي بدل المطاردة.',
    DO_NOT_CHASE_WAIT_FOR_NEW_VALID_PLAN_OR_REENTRY: 'السعر أعلى نطاق الدخول؛ لا مطاردة للسعر، وتلزم عودة للنطاق أو خطة جديدة موثقة.',
    REBUILD_TRADE_PLAN_AFTER_SOURCE_REVIEW: 'خطة التداول تحتاج إعادة بناء بعد مراجعة مصدر السعر/المقياس؛ السبب التشخيصي غير مفترض.',
    INVALID_PLAN_REQUIRES_REBUILD: 'علاقة الوقف/الدخول/الهدف غير صالحة وتحتاج إعادة بناء.',
    REVIEW_TRADE_PLAN_STATE: 'حالة خطة التداول تحتاج مراجعة.',
  })[row.nextCondition] || 'حالة خطة التداول تحتاج مراجعة.';
  return `${row.ticker}: درجة قرار بحثية ${score} (${tier}) بتغطية أدلة ${row.scoreEvidenceCoveragePct}%. ${next} هذه الدرجة ليست Confidence ولا Execution Permission ولا دليل ترقية للنموذج.`;
}

const current = read('data/v20/current.json');
const snapshot = read('data/v20/current-market-snapshot.json');
const sourceHealth = read('data/v20/source-health.json');
const riskAudit = read('data/v20/risk-reward-audit.json');
const technical = read('data/v20/technical-indicators.json', { symbols: [] });
const technicalStatus = read('data/v20/technical-history-status.json', {});
const decisionPolicy = read('data/v20/decision-intelligence-policy.json', null);
const liquidityGate = read('data/v17/liquidity-gate.json', { rows: [] });
const gate = read('data/v17/resilient-session-status.json', {});

if (!decisionPolicy || decisionPolicy.status !== 'SHADOW_RESEARCH_ONLY_UNCALIBRATED') throw new Error('V20 decision intelligence policy missing');
if (decisionPolicy.scoreIsConfidence !== false || decisionPolicy.scoreCanOpenExecutionGate !== false) throw new Error('Decision score/confidence or execution separation policy drift');
if (decisionPolicy.scoreCanDriveProductionAllocation !== false || decisionPolicy.scoreCanChangeChampion !== false || decisionPolicy.scoreCanTriggerAutomaticPromotion !== false) throw new Error('Decision score production governance isolation drift');
if (decisionPolicy.modelConfidenceMayBeInferredFromScore !== false) throw new Error('Decision score cannot infer model confidence');
const decisionWeightKeys = ['legacyOpportunity','dataEvidence','liquidity','supportResistance','netRiskReward','tradePlanAlignment','currentTechnical'];
if (decisionWeightKeys.reduce((sum, key) => sum + Number(decisionPolicy.componentWeightsPct?.[key] || 0), 0) !== 100) throw new Error('Decision intelligence component weights must sum to 100');

const snapshotMap = new Map((snapshot.rows || []).map(row => [row.ticker, row]));
const auditMap = new Map((riskAudit.rows || []).map(row => [row.ticker, row]));
const technicalMap = new Map((technical.symbols || []).map(row => [row.ticker, row]));
const liquidityMap = new Map((liquidityGate.rows || []).map(row => [String(row.symbol || row.ticker || '').trim().toUpperCase(), row]));

function liquidityProfile(ticker) {
  const symbol = String(ticker || '').trim().toUpperCase();
  const item = liquidityMap.get(symbol);
  const sessionAligned = liquidityGate.sessionAligned === true && liquidityGate.referenceSessionDate === current.sessionDate;
  if (!item) {
    return {
      available: false, evidenceAvailable: false, sessionAligned, liquidityScore: null, liquidityDecision: 'NO_EVIDENCE',
      executionEligible: false, conditionalEligible: false, currentTurnover: null, avg20Turnover: null,
      currentVolume: null, avg20Volume: null, trades: null, historicalSessionsUsed: null,
      scoringContract: liquidityGate.sourceLineage?.scoringContract || null, evidenceSource: 'data/v17/liquidity-gate.json',
    };
  }
  return {
    available: item.evidenceAvailable === true, evidenceAvailable: item.evidenceAvailable === true, sessionAligned,
    liquidityScore: finite(item.liquidityScore), liquidityDecision: item.liquidityDecision || null,
    executionEligible: item.executionLiquidityOk === true, conditionalEligible: item.conditionalLiquidityOk === true,
    currentTurnover: finite(item.currentTurnover), avg20Turnover: finite(item.avg20Turnover),
    currentVolume: finite(item.currentVolume), avg20Volume: finite(item.avg20Volume), trades: finite(item.trades),
    historicalSessionsUsed: finite(item.historicalSessionsUsed), reason: item.reason || null,
    scoringContract: liquidityGate.sourceLineage?.scoringContract || null, evidenceSource: 'data/v17/liquidity-gate.json',
  };
}

function technicalProfile(ticker) {
  const item = technicalMap.get(ticker);
  if (!item) {
    return {
      status: 'UNAVAILABLE', historicalIndicatorReady: false, currentTechnicalReady: false,
      usedForCurrentDecision: false, asOfSession: null, source: null, rowsUsed: 0,
      sma20: null, sma50: null, ema20: null, rsi14: null, macd: null, macdSignal: null,
      macdHistogram: null, atr14: null, momentum5Pct: null, momentum10Pct: null,
      momentum20Pct: null, trend: null, blockers: ['TRUSTED_TECHNICAL_HISTORY_UNAVAILABLE'],
      note: 'No trusted point-in-time OHLC history passed the V20 provenance filter for this symbol.',
    };
  }
  const values = item.indicators || {};
  const currentReady = item.currentTechnicalReady === true;
  return {
    status: currentReady ? 'CURRENT_POINT_IN_TIME_READY' : (item.historicalIndicatorReady ? 'HISTORICAL_CONTEXT_ONLY' : 'INSUFFICIENT_TRUSTED_HISTORY'),
    historicalIndicatorReady: item.historicalIndicatorReady === true,
    currentTechnicalReady: currentReady,
    usedForCurrentDecision: item.usedForCurrentDecision === true,
    asOfSession: item.asOfSession || null,
    source: item.source || null,
    sourceKind: item.sourceKind || null,
    rowsUsed: Number(item.rowsUsed || 0),
    sessionAligned: item.sessionAligned === true,
    priceReconciled: item.priceReconciled === true,
    currentPriceDifferencePct: finite(item.currentPriceDifferencePct),
    sma20: finite(values.sma20), sma50: finite(values.sma50), ema20: finite(values.ema20),
    rsi14: finite(values.rsi14), macd: finite(values.macd), macdSignal: finite(values.macdSignal),
    macdHistogram: finite(values.macdHistogram), atr14: finite(values.atr14),
    momentum5Pct: finite(values.momentum5Pct), momentum10Pct: finite(values.momentum10Pct),
    momentum20Pct: finite(values.momentum20Pct), trend: values.trend || null,
    readiness: item.readiness || {}, blockers: item.blockers || [],
    note: currentReady
      ? 'Indicators are calculated only from trusted OHLC rows at or before the V20 session date and passed session/price reconciliation.'
      : 'Values may be shown as historical research context, but stale or unreconciled indicators are not used as current-decision evidence.',
  };
}

function buildDecisionIntelligence(profile) {
  const weights = decisionPolicy.componentWeightsPct;
  const legacy = finite(profile.opportunity?.score);
  const netRr = finite(profile.tradePlan?.riskReward?.primaryTarget1NetRiskReward ?? profile.tradePlan?.target1Metrics?.netRiskReward);
  const alignment = profile.tradePlan?.alignment || null;
  const blockers = new Set(profile.whyThisStock?.blockers || []);
  const components = {
    legacyOpportunity: decisionComponent('LEGACY_OPPORTUNITY_REFERENCE', weights.legacyOpportunity, legacy, 'data/final-opportunity-ranking.json', { legacyScore: legacy, calibration: 'LEGACY_REFERENCE_NOT_V20_CONFIDENCE' }),
    dataEvidence: decisionComponent('CURRENT_DATA_EVIDENCE', weights.dataEvidence, decisionDataScore(profile), 'data/v20/current-market-snapshot.json + data/v17/resilient-session-status.json', {
      criticalFieldCompletenessPct: finite(profile.marketSnapshot?.criticalFieldCompletenessPct),
      sourceConflict: blockers.has('CRITICAL_SOURCE_CONFLICT'),
      missingCriticalEvidence: blockers.has('MISSING_CRITICAL_SYMBOL_EVIDENCE'),
    }),
    liquidity: decisionComponent('LIQUIDITY_EVIDENCE', weights.liquidity, decisionLiquidityScore(profile.liquidity), 'data/v17/liquidity-gate.json', {
      liquidityScore: finite(profile.liquidity?.liquidityScore), liquidityDecision: profile.liquidity?.liquidityDecision || null,
      evidenceAvailable: profile.liquidity?.evidenceAvailable === true, sessionAligned: profile.liquidity?.sessionAligned === true,
      executionEligible: profile.liquidity?.executionEligible === true, conditionalEligible: profile.liquidity?.conditionalEligible === true,
      currentTurnover: finite(profile.liquidity?.currentTurnover), avg20Turnover: finite(profile.liquidity?.avg20Turnover),
      currentVolume: finite(profile.liquidity?.currentVolume), avg20Volume: finite(profile.liquidity?.avg20Volume),
      trades: finite(profile.liquidity?.trades), historicalSessionsUsed: finite(profile.liquidity?.historicalSessionsUsed),
      scoringContract: profile.liquidity?.scoringContract || null, binaryEligibilityFallbackUsed: false,
    }),
    supportResistance: decisionComponent('SUPPORT_RESISTANCE_EVIDENCE', weights.supportResistance, decisionSrScore(profile.supportResistance), 'data/v17/internal-ohlc-support-resistance.json', {
      available: Boolean(profile.supportResistance), sessionAligned: profile.supportResistance?.sessionAligned === true,
      executionEligible: profile.supportResistance?.executionEligible === true, confidence: finite(profile.supportResistance?.confidence),
    }),
    netRiskReward: decisionComponent('CONSERVATIVE_NET_RR_AFTER_COSTS', weights.netRiskReward, decisionRrScore(netRr), 'data/v20/risk-reward-audit.json', { netRiskReward: netRr, costAware: true, legacyRiskRewardUsedAsPrimary: false }),
    tradePlanAlignment: decisionComponent('CURRENT_PRICE_TRADE_PLAN_ALIGNMENT', weights.tradePlanAlignment, decisionAlignmentScore(alignment), 'data/v20/trade-plan-audit.json', {
      state: alignment?.state || null, currentPriceInsideEntryRange: alignment?.insideEntryRange === true,
      hardReviewRequired: alignment?.hardReviewRequired === true, eligibleForActionable: alignment?.eligibleForActionable === true,
    }),
    currentTechnical: decisionComponent('CURRENT_POINT_IN_TIME_TECHNICAL', weights.currentTechnical, decisionTechnicalScore(profile.technicalAnalysis), 'data/v20/technical-indicators.json', {
      currentTechnicalReady: profile.technicalAnalysis?.currentTechnicalReady === true,
      usedForCurrentDecision: profile.technicalAnalysis?.usedForCurrentDecision === true,
      asOfSession: profile.technicalAnalysis?.asOfSession || null,
      trend: profile.technicalAnalysis?.currentTechnicalReady === true ? profile.technicalAnalysis?.trend || null : null,
    }),
  };
  const available = Object.values(components).filter(item => item.available);
  const availableWeight = available.reduce((sum, item) => sum + item.weightPct, 0);
  const weightedPoints = available.reduce((sum, item) => sum + item.weightedPoints, 0);
  let score = availableWeight > 0 ? weightedPoints / availableWeight * 100 : null;
  const beforeCaps = score === null ? null : round(score, 1);
  const caps = [];
  const state = String(alignment?.state || '');
  if (state.startsWith('REBUILD_REQUIRED') || state === 'INVALID_PLAN_RELATION') caps.push({ code: 'INVALID_OR_REBUILD_REQUIRED_TRADE_PLAN', maxScore: decisionPolicy.defensiveCaps.invalidOrRebuildRequiredTradePlanMaxScore });
  if (blockers.has('CRITICAL_SOURCE_CONFLICT')) caps.push({ code: 'CRITICAL_SOURCE_CONFLICT', maxScore: decisionPolicy.defensiveCaps.criticalSourceConflictMaxScore });
  if (blockers.has('MISSING_CRITICAL_SYMBOL_EVIDENCE')) caps.push({ code: 'MISSING_CRITICAL_SYMBOL_EVIDENCE', maxScore: decisionPolicy.defensiveCaps.missingCriticalEvidenceMaxScore });
  if (state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') caps.push({ code: 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE', maxScore: decisionPolicy.defensiveCaps.aboveEntryRangeDoNotChaseMaxScore });
  for (const cap of caps) if (score !== null) score = Math.min(score, cap.maxScore);
  score = score === null ? null : round(score, 1);
  const coveragePct = round(availableWeight, 1);

  const strengths = [];
  const weaknesses = [];
  const evidenceGaps = [];
  for (const [key, item] of Object.entries(components)) {
    if (!item.available) evidenceGaps.push(`${key.toUpperCase()}_UNAVAILABLE`);
    else if (item.score >= 75) strengths.push(`${key.toUpperCase()}_STRONG`);
    else if (item.score <= 40) weaknesses.push(`${key.toUpperCase()}_WEAK`);
  }
  if (netRr !== null && netRr < 0.5) weaknesses.push('NET_RR_BELOW_0_5');
  if (profile.technicalAnalysis?.currentTechnicalReady !== true) evidenceGaps.push('CURRENT_TECHNICAL_NOT_READY');
  if (!profile.supportResistance) evidenceGaps.push('SUPPORT_RESISTANCE_UNAVAILABLE');
  if (caps.length) weaknesses.push(...caps.map(cap => `SCORE_CAP_${cap.code}`));

  const legacyPoints = components.legacyOpportunity.available ? components.legacyOpportunity.weightedPoints : 0;
  const legacyDependencyPct = weightedPoints > 0 ? round(legacyPoints / weightedPoints * 100, 1) : null;
  const result = {
    researchDecisionScore: score,
    researchDecisionScoreBeforeCaps: beforeCaps,
    researchTier: decisionTier(score, coveragePct, decisionPolicy),
    scoreIsConfidence: false,
    scoreEvidenceCoveragePct: coveragePct,
    legacyContributionPctOfWeightedPoints: legacyDependencyPct,
    calibrationStatus: 'UNVALIDATED_RESEARCH_HEURISTIC_REQUIRES_FORWARD_AND_INDEPENDENT_HOLDOUT',
    components,
    scoreCaps: caps,
    explainability: { strengths: [...new Set(strengths)], weaknesses: [...new Set(weaknesses)], evidenceGaps: [...new Set(evidenceGaps)] },
    nextCondition: decisionNextCondition(alignment),
    execution: {
      permissionSource: 'data/v17/resilient-session-status.json', globalExecutionGrade: gate.executionGrade === true,
      issuedStatus: profile.status, scoreMayOpenExecutionGate: false, scoreMayCreateActionableStatus: false, scoreMayChangePositionWeight: false,
    },
    confidenceSeparation: {
      marketConfidencePct: finite(profile.confidence?.marketConfidencePct), dataConfidencePct: finite(profile.confidence?.dataConfidencePct),
      modelConfidencePct: finite(profile.confidence?.modelConfidencePct), executionConfidencePct: finite(profile.confidence?.executionConfidencePct),
      copiedFromStockProfileWithoutScoreInference: true,
    },
    provenance: { policy: 'data/v20/decision-intelligence-policy.json', legacyRanking: 'data/final-opportunity-ranking.json', stockProfile: 'data/v20/stock-profiles.json' },
  };
  result.decisionNarrativeAr = decisionNarrativeAr({ ticker: profile.ticker, ...result });
  return result;
}

const profiles = (current.opportunities || []).map(row => {
  const marketRow = snapshotMap.get(row.ticker) || {};
  const rrAudit = auditMap.get(row.ticker) || {};
  const ta = technicalProfile(row.ticker);
  const liq = liquidityProfile(row.ticker);
  const strengths = [
    finite(row.opportunityScore) !== null && row.opportunityScore >= 80 ? 'HIGH_LEGACY_OPPORTUNITY_SCORE' : null,
    liq.executionEligible === true ? 'LIQUIDITY_GATE_ELIGIBLE' : null,
    row.supportResistance?.sessionAligned === true ? 'SUPPORT_RESISTANCE_SESSION_ALIGNED' : null,
    row.supportResistance?.executionEligible === true ? 'INTERNAL_SUPPORT_RESISTANCE_EXECUTION_ELIGIBLE' : null,
    finite(row.riskReward?.primaryTarget1NetRiskReward) !== null && row.riskReward.primaryTarget1NetRiskReward > 0 ? 'POSITIVE_TARGET1_NET_REWARD_AFTER_COSTS' : null,
    ta.currentTechnicalReady && ta.trend === 'BULLISH' ? 'CURRENT_TRUSTED_TECHNICAL_TREND_BULLISH' : null,
    ta.currentTechnicalReady && finite(ta.rsi14) !== null && ta.rsi14 >= 45 && ta.rsi14 <= 70 ? 'CURRENT_RSI_IN_BALANCED_MOMENTUM_RANGE' : null,
  ].filter(Boolean);
  const blockers = [...new Set([
    ...(row.reasons || []),
    rrAudit.materialMismatch ? 'LEGACY_RR_REQUIRES_AUDIT' : null,
    current.marketStatus?.verified !== true ? 'MARKET_REGIME_NOT_VERIFIED' : null,
    current.executionStatus !== 'EXECUTION_GRADE' ? 'GLOBAL_EXECUTION_NOT_GRADE' : null,
  ].filter(Boolean))];

  const profile = {
    ticker: row.ticker,
    nameAr: row.nameAr || marketRow.nameAr || null,
    nameEn: marketRow.nameEn || null,
    rank: row.rank,
    sessionDate: current.sessionDate,
    status: row.status,
    executionStatus: current.executionStatus,
    price: finite(row.price),
    marketSnapshot: {
      previousClose: finite(marketRow.previousClose), open: finite(marketRow.open), high: finite(marketRow.high),
      low: finite(marketRow.low), volume: finite(marketRow.volume), turnover: finite(marketRow.turnover),
      trades: finite(marketRow.trades), change: finite(marketRow.change), changePct: finite(marketRow.changePct),
      dataQualityState: marketRow.dataQualityState || null,
      criticalFieldCompletenessPct: pct(marketRow.criticalFieldCompletenessPct),
    },
    opportunity: {
      score: finite(row.opportunityScore), scoreIsConfidence: false, scoreProvenance: row.scoreProvenance || null,
      legacyTargetProbabilityPct: finite(row.legacyTargetProbabilityPct),
    },
    confidence: {
      marketConfidencePct: finite(row.confidence?.marketConfidencePct),
      dataConfidencePct: finite(row.confidence?.dataConfidencePct),
      modelConfidencePct: finite(row.confidence?.modelConfidencePct),
      executionConfidencePct: finite(row.confidence?.executionConfidencePct), dimensionsAreIndependent: true,
    },
    supportResistance: row.supportResistance || null,
    liquidity: {
      ...liq,
      currentDecisionExecutionEligible: row.liquidityExecutionEligible === true,
      consistentWithCurrentDecision: liq.executionEligible === (row.liquidityExecutionEligible === true),
    },
    tradePlan: { ...row.tradePlan, riskReward: row.riskReward || null },
    whyThisStock: {
      strengths, blockers, technicalEvidenceUsed: ta.usedForCurrentDecision === true,
      summaryState: row.status === 'ACTIONABLE'
        ? 'EXECUTION_CANDIDATE_SUBJECT_TO_USER_DECISION'
        : row.status === 'WATCH' ? 'RESEARCH_WATCH_NOT_EXECUTION'
          : row.status === 'AVOID' ? 'DO_NOT_TREAT_AS_CURRENT_EXECUTION_CANDIDATE' : 'WAIT_FOR_REQUIRED_CONDITIONS',
    },
    technicalAnalysis: ta,
    marketRegimeCompatibility: {
      regime: current.marketStatus?.regime || null,
      regimeVerified: current.marketStatus?.verified === true,
      compatibility: current.marketStatus?.verified === true ? 'NOT_YET_CALIBRATED' : 'UNVERIFIED',
    },
    sectorContext: {
      sector: null, status: 'UNAVAILABLE_FROM_VERIFIED_CURRENT_V20_INPUTS',
      note: 'Sector classification is intentionally not inferred from ticker or company name.',
    },
    historicalCalibration: {
      status: 'NOT_ATTACHED_TO_CURRENT_PROFILE', forwardPaperEvidenceAvailable: false,
      note: 'Historical model evidence, walk-forward evidence and current forward tracking remain separate layers.',
    },
    provenance: {
      currentDecision: 'data/v20/current.json', marketSnapshot: 'data/v20/current-market-snapshot.json',
      sourceHealth: 'data/v20/source-health.json', riskRewardAudit: 'data/v20/risk-reward-audit.json',
      technicalHistory: 'data/v20/technical-history.json', technicalIndicators: 'data/v20/technical-indicators.json',
      sourceTimestamp: marketRow.sourceTimestamp || sourceHealth.lastSourceUpdate || null,
      source: marketRow.source || null, sourceUrl: marketRow.sourceUrl || null,
      sessionAligned: marketRow.sessionAligned === true && current.dataStatus?.sessionAligned === true,
    },
  };
  profile.decisionIntelligence = buildDecisionIntelligence(profile);
  return profile;
});

const researchDecisionRanking = [...profiles]
  .sort((a, b) => (finite(b.decisionIntelligence?.researchDecisionScore) ?? -1) - (finite(a.decisionIntelligence?.researchDecisionScore) ?? -1) || a.rank - b.rank)
  .map((profile, index) => ({
    rank: index + 1, ticker: profile.ticker, legacyRank: profile.rank,
    researchDecisionScore: profile.decisionIntelligence.researchDecisionScore,
    researchTier: profile.decisionIntelligence.researchTier,
    issuedStatus: profile.status,
  }));
const tierCounts = {};
for (const profile of profiles) tierCounts[profile.decisionIntelligence.researchTier] = (tierCounts[profile.decisionIntelligence.researchTier] || 0) + 1;
const decisionScores = profiles.map(p => finite(p.decisionIntelligence.researchDecisionScore)).filter(v => v !== null).sort((a, b) => a - b);
const medianDecisionScore = decisionScores.length
  ? (decisionScores.length % 2 ? decisionScores[(decisionScores.length - 1) / 2] : (decisionScores[decisionScores.length / 2 - 1] + decisionScores[decisionScores.length / 2]) / 2)
  : null;

const out = {
  schemaVersion: '20.0.0-stock-profiles-3', generatedAt: new Date().toISOString(), sessionDate: current.sessionDate,
  decisionSupportOnly: true, executionStatus: current.executionStatus, profileCount: profiles.length,
  technicalIndicatorPolicy: 'POINT_IN_TIME_TRUSTED_OHLC_ONLY_STALE_CONTEXT_NEVER_CURRENT_DECISION',
  technicalHistoryStatus: technicalStatus,
  sectorPolicy: 'NO_INFERENCE_WITHOUT_VERIFIED_CLASSIFICATION_SOURCE',
  decisionIntelligencePolicy: decisionPolicy,
  decisionIntelligenceSummary: {
    status: decisionPolicy.status,
    scoreIsConfidence: false,
    usedForExecutionGate: false,
    usedForProductionAllocation: false,
    usedForChampionSelection: false,
    liquidityComponentWeightPct: decisionPolicy.componentWeightsPct.liquidity,
    liquidityScoringContract: decisionPolicy.liquidityScoring?.scoringContract || null,
    liquidityUsesNumericV17Score: true,
    liquidityComponentAvailableCount: profiles.filter(p => p.decisionIntelligence.components.liquidity.available).length,
    medianResearchDecisionScore: medianDecisionScore === null ? null : round(medianDecisionScore, 1),
    tierCounts,
    currentTechnicalComponentAvailableCount: profiles.filter(p => p.decisionIntelligence.components.currentTechnical.available).length,
    cappedScoreCount: profiles.filter(p => p.decisionIntelligence.scoreCaps.length > 0).length,
    highLegacyDependencyCount: profiles.filter(p => finite(p.decisionIntelligence.legacyContributionPctOfWeightedPoints) !== null && p.decisionIntelligence.legacyContributionPctOfWeightedPoints > 40).length,
  },
  researchDecisionRanking,
  profiles,
};

write('data/v20/stock-profiles.json', out);
require('./build-native-research-challenger.cjs').main();
console.log(JSON.stringify({
  sessionDate: out.sessionDate, profiles: out.profileCount, technicalIndicatorPolicy: out.technicalIndicatorPolicy,
  currentTechnicalReady: profiles.filter(p => p.technicalAnalysis.currentTechnicalReady).length,
  historicalTechnicalOnly: profiles.filter(p => p.technicalAnalysis.status === 'HISTORICAL_CONTEXT_ONLY').length,
  profilesWithActionableStatus: profiles.filter(p => p.status === 'ACTIONABLE').length,
  profilesWithLegacyRrAuditBlocker: profiles.filter(p => p.whyThisStock.blockers.includes('LEGACY_RR_REQUIRES_AUDIT')).length,
  decisionIntelligence: out.decisionIntelligenceSummary,
}, null, 2));
