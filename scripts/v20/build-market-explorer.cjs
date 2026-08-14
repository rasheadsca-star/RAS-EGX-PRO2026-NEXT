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
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
function text(value) { return String(value || '').trim(); }

const universe = read('data/v20/master-universe.json', { rows: [] });
const market = read('data/v20/current-market-snapshot.json', { rows: [] });
const current = read('data/v20/current.json', { opportunities: [] });
const profiles = read('data/v20/stock-profiles.json', { profiles: [] });
const techStatus = read('data/v20/technical-history-status.json', {});
const sourceHealth = read('data/v20/source-health.json', {});

const sessionDate = current.sessionDate || market.sessionDate || universe.sessionDate || null;
const marketMap = new Map((market.rows || []).map(row => [row.ticker, row]));
const opportunityMap = new Map((current.opportunities || []).map(row => [row.ticker, row]));
const profileMap = new Map((profiles.profiles || []).map(row => [row.ticker, row]));

const rows = (universe.rows || []).map(base => {
  const m = marketMap.get(base.ticker) || null;
  const opportunity = opportunityMap.get(base.ticker) || null;
  const profile = profileMap.get(base.ticker) || null;
  const ta = profile?.technicalAnalysis || null;
  const currentSessionAvailable = Boolean(
    m &&
    m.sessionAligned === true &&
    m.sessionDate === sessionDate &&
    finite(m.price) !== null &&
    Number(m.price) > 0
  );
  const marketDataState = !m
    ? 'CURRENT_SESSION_DATA_UNAVAILABLE'
    : currentSessionAvailable
      ? 'CURRENT_SESSION_AVAILABLE'
      : 'CURRENT_SESSION_MISMATCH';

  const technicalState = !ta
    ? 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE'
    : ta.currentTechnicalReady === true
      ? 'CURRENT_READY'
      : ta.historicalIndicatorReady === true
        ? 'HISTORICAL_CONTEXT_ONLY'
        : ta.status === 'UNAVAILABLE'
          ? 'UNAVAILABLE'
          : 'INSUFFICIENT_TRUSTED_HISTORY';

  const technical = {
    state: technicalState,
    asOfSession: ta?.asOfSession || null,
    source: ta?.source || null,
    rowsUsed: Number(ta?.rowsUsed || 0),
    sessionAligned: ta?.sessionAligned === true,
    priceReconciled: ta?.priceReconciled === true,
    usedForCurrentDecision: ta?.usedForCurrentDecision === true,
    currentPriceDifferencePct: finite(ta?.currentPriceDifferencePct),
    trend: ta?.trend || null,
    rsi14: finite(ta?.rsi14),
    macd: finite(ta?.macd),
    macdSignal: finite(ta?.macdSignal),
    atr14: finite(ta?.atr14),
    momentum5Pct: finite(ta?.momentum5Pct),
    blockers: Array.isArray(ta?.blockers) ? ta.blockers : [],
  };

  if (technical.usedForCurrentDecision && technical.state !== 'CURRENT_READY') {
    throw new Error(`${base.ticker}: technical evidence marked current without CURRENT_READY state`);
  }
  if (technical.state === 'CURRENT_READY' && technical.asOfSession !== sessionDate) {
    throw new Error(`${base.ticker}: CURRENT_READY technical session mismatch`);
  }

  return {
    ticker: base.ticker,
    nameAr: base.nameAr || m?.nameAr || null,
    nameEn: base.nameEn || m?.nameEn || null,
    nameArVerified: base.nameArVerified === true || m?.nameArVerified === true,
    sessionDate,
    marketDataState,
    currentSessionAvailable,
    price: currentSessionAvailable ? finite(m.price) : null,
    previousClose: currentSessionAvailable ? finite(m.previousClose) : null,
    open: currentSessionAvailable ? finite(m.open) : null,
    high: currentSessionAvailable ? finite(m.high) : null,
    low: currentSessionAvailable ? finite(m.low) : null,
    volume: currentSessionAvailable ? finite(m.volume) : null,
    turnover: currentSessionAvailable ? finite(m.turnover) : null,
    trades: currentSessionAvailable ? finite(m.trades) : null,
    change: currentSessionAvailable ? finite(m.change) : null,
    changePct: currentSessionAvailable ? finite(m.changePct) : null,
    dataQualityState: m?.dataQualityState || 'CURRENT_DATA_UNAVAILABLE',
    criticalFieldCompletenessPct: currentSessionAvailable ? round(m.criticalFieldCompletenessPct, 1) : null,
    dataQualityIssues: currentSessionAvailable && Array.isArray(m?.dataQualityIssues) ? m.dataQualityIssues : [],
    ohlcValid: currentSessionAvailable ? m?.ohlcValid === true : false,
    semanticCompleteness: m?.semanticCompleteness === true,
    liquidityExecutionEligible: m?.liquidityExecutionEligible === true,
    supportResistanceAvailable: m?.supportResistanceAvailable === true,
    supportResistanceExecutionEligible: m?.supportResistanceExecutionEligible === true,
    sourceConflict: base.sourceConflict === true || m?.sourceConflict === true,
    decision: opportunity ? {
      scope: 'CURRENT_OPPORTUNITY',
      rank: finite(opportunity.rank),
      status: opportunity.status || null,
      opportunityScore: finite(opportunity.opportunityScore),
      netRiskRewardT1: finite(opportunity.riskReward?.primaryTarget1NetRiskReward),
      dataConfidencePct: finite(opportunity.confidence?.dataConfidencePct),
      executionConfidencePct: finite(opportunity.confidence?.executionConfidencePct),
    } : {
      scope: 'MARKET_ONLY',
      rank: null,
      status: null,
      opportunityScore: null,
      netRiskRewardT1: null,
      dataConfidencePct: null,
      executionConfidencePct: null,
    },
    technical,
    provenance: {
      currentPriceSource: currentSessionAvailable ? (m.source || null) : null,
      currentPriceSourceUrl: currentSessionAvailable ? (m.sourceUrl || null) : null,
      sourceTimestamp: currentSessionAvailable ? (m.sourceTimestamp || null) : null,
      sourceSession: currentSessionAvailable ? m.sessionDate : null,
      masterUniverse: 'data/v20/master-universe.json',
      currentMarketSnapshot: 'data/v20/current-market-snapshot.json',
      technicalIndicators: ta ? 'data/v20/technical-indicators.json' : null,
    },
    searchText: `${text(base.ticker)} ${text(base.nameAr || m?.nameAr)} ${text(base.nameEn || m?.nameEn)}`.toLocaleLowerCase('ar'),
  };
});

const currentSnapshotCount = rows.filter(row => row.currentSessionAvailable).length;
const marketOnlyCount = rows.filter(row => row.decision.scope === 'MARKET_ONLY').length;
const opportunityCount = rows.filter(row => row.decision.scope === 'CURRENT_OPPORTUNITY').length;
const currentTechnicalReadyCount = rows.filter(row => row.technical.state === 'CURRENT_READY').length;
const historicalTechnicalOnlyCount = rows.filter(row => row.technical.state === 'HISTORICAL_CONTEXT_ONLY').length;
const technicalNotEvaluatedCount = rows.filter(row => row.technical.state === 'NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE').length;
const completeCurrentRows = rows.filter(row => row.currentSessionAvailable && row.dataQualityState === 'COMPLETE_FOR_CURRENT_SCOPE').length;
const partialCurrentRows = rows.filter(row => row.currentSessionAvailable && row.dataQualityState !== 'COMPLETE_FOR_CURRENT_SCOPE').length;

const out = {
  schemaVersion: '20.0.0-market-explorer-2',
  generatedAt: new Date().toISOString(),
  sessionDate,
  decisionSupportOnly: true,
  executionStatus: current.executionStatus || null,
  policy: {
    fullMarketSearch: true,
    currentSessionPriceOnly: true,
    stalePriceFallbackDisplayedAsCurrent: false,
    marketOnlyIsRecommendation: false,
    technicalCurrentRequiresTrustedPointInTimeReadiness: true,
    nonEvaluatedTechnicalMeansUnavailable: false,
    semanticRowQualityPropagated: true,
    paginationRecommended: true,
  },
  summary: {
    universeCount: rows.length,
    currentSnapshotCount,
    currentSessionCoveragePct: rows.length ? round(currentSnapshotCount / rows.length * 100, 2) : 0,
    currentSessionDataUnavailableCount: rows.length - currentSnapshotCount,
    completeCurrentRows,
    partialCurrentRows,
    opportunityCount,
    marketOnlyCount,
    currentTechnicalReadyCount,
    historicalTechnicalOnlyCount,
    technicalNotEvaluatedCount,
    technicalCurrentCoverageOfUniversePct: rows.length ? round(currentTechnicalReadyCount / rows.length * 100, 2) : 0,
    technicalCurrentCoverageOfOpportunityUniversePct: finite(techStatus.currentTechnicalCoveragePct),
    sourceStatus: sourceHealth.status || null,
  },
  rows,
};

if (out.summary.universeCount !== Number(universe.count || rows.length)) {
  throw new Error(`Market Explorer universe mismatch: ${out.summary.universeCount} vs ${universe.count}`);
}
if (rows.some(row => row.currentSessionAvailable && row.provenance.sourceSession !== sessionDate)) {
  throw new Error('Market Explorer contains current row with non-current source session');
}
if (rows.some(row => row.marketDataState !== 'CURRENT_SESSION_AVAILABLE' && row.price !== null)) {
  throw new Error('Market Explorer exposes stale/misaligned price as current');
}
if (rows.some(row => row.decision.scope === 'MARKET_ONLY' && row.decision.status !== null)) {
  throw new Error('Market-only row was assigned a recommendation status');
}
if (rows.some(row => row.currentSessionAvailable && row.semanticCompleteness !== true)) {
  throw new Error('Market Explorer current row missing semantic completeness marker');
}

write('data/v20/market-explorer.json', out);
console.log(JSON.stringify(out.summary, null, 2));
