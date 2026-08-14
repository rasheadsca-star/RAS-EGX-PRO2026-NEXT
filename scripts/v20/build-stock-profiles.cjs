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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function pct(value) {
  const n = finite(value);
  if (n === null) return null;
  return Math.round(n * 10) / 10;
}

const current = read('data/v20/current.json');
const snapshot = read('data/v20/current-market-snapshot.json');
const sourceHealth = read('data/v20/source-health.json');
const riskAudit = read('data/v20/risk-reward-audit.json');
const technical = read('data/v20/technical-indicators.json', { symbols: [] });
const technicalStatus = read('data/v20/technical-history-status.json', {});
const snapshotMap = new Map((snapshot.rows || []).map(row => [row.ticker, row]));
const auditMap = new Map((riskAudit.rows || []).map(row => [row.ticker, row]));
const technicalMap = new Map((technical.symbols || []).map(row => [row.ticker, row]));

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

const profiles = (current.opportunities || []).map(row => {
  const marketRow = snapshotMap.get(row.ticker) || {};
  const rrAudit = auditMap.get(row.ticker) || {};
  const ta = technicalProfile(row.ticker);
  const strengths = [
    finite(row.opportunityScore) !== null && row.opportunityScore >= 80 ? 'HIGH_LEGACY_OPPORTUNITY_SCORE' : null,
    row.liquidityExecutionEligible === true ? 'LIQUIDITY_GATE_ELIGIBLE' : null,
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

  return {
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
    liquidity: { executionEligible: row.liquidityExecutionEligible === true, evidenceSource: 'data/v17/liquidity-gate.json' },
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
});

const out = {
  schemaVersion: '20.0.0-stock-profiles-2', generatedAt: new Date().toISOString(), sessionDate: current.sessionDate,
  decisionSupportOnly: true, executionStatus: current.executionStatus, profileCount: profiles.length,
  technicalIndicatorPolicy: 'POINT_IN_TIME_TRUSTED_OHLC_ONLY_STALE_CONTEXT_NEVER_CURRENT_DECISION',
  technicalHistoryStatus: technicalStatus,
  sectorPolicy: 'NO_INFERENCE_WITHOUT_VERIFIED_CLASSIFICATION_SOURCE', profiles,
};

write('data/v20/stock-profiles.json', out);
console.log(JSON.stringify({
  sessionDate: out.sessionDate, profiles: out.profileCount, technicalIndicatorPolicy: out.technicalIndicatorPolicy,
  currentTechnicalReady: profiles.filter(p => p.technicalAnalysis.currentTechnicalReady).length,
  historicalTechnicalOnly: profiles.filter(p => p.technicalAnalysis.status === 'HISTORICAL_CONTEXT_ONLY').length,
  profilesWithActionableStatus: profiles.filter(p => p.status === 'ACTIONABLE').length,
  profilesWithLegacyRrAuditBlocker: profiles.filter(p => p.whyThisStock.blockers.includes('LEGACY_RR_REQUIRES_AUDIT')).length,
}, null, 2));
