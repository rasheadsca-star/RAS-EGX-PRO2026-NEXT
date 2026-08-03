#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = file => path.join(ROOT, file);
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(P(file), 'utf8')); } catch { return fallback; } };
function write(file, value) {
  const target = P(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
const decision = read('data/stable/v15-practical-decision.json');
const price = read('data/stable/v15-price-truth.json');
const evaluation = read('data/stable/v15-recommendation-evaluation.json');
const fundamentals = read('data/stable/v16-fundamental-analysis.json');
const raw = read('data/fundamentals/v16-fundamental-raw.json');
const official = read('data/stable/v16-official-disclosures.json');
const regime = read('data/stable/v16-market-regime.json');
const live = read('data/stable/v16-live-evidence.json');
const correlation = read('data/stable/v16-correlation-risk.json');
const alerts = read('data/stable/v16-alerts.json');
const browser = read('data/stable/v16-browser-test-status.json', { status: 'PENDING', generatedAt: null });
const review = read('data/review/v16-3-whole-app-review.json');
const now = new Date().toISOString();
const out = {
  schemaVersion: '16.3.0',
  generatedAt: now,
  lastAutomaticScanAt: now,
  productInterface: 'EGX_PROFESSIONAL_V16_3',
  releaseComponents: ['V16.2_LIVE_EVIDENCE', 'V16.2_OFFICIAL_DISCLOSURES', 'V16.2_FINANCIAL_COVERAGE', 'V16.2_MARKET_REGIME', 'V16.3_CORRELATION_RISK', 'V16.3_ALERTS', 'V16.3_BROWSER_TESTS'],
  evidenceTier: live.evidenceTier || decision.evidenceTier || 'RESEARCH',
  professionalEvidenceReady: live.professionalEvidenceReady === true,
  automation: {
    enabled: true,
    cadence: 'HOURLY_AFTER_MARKET_CLOSE',
    cron: '20 13-17 * * 0-4',
    tradingDays: 'SUNDAY_THROUGH_THURSDAY',
    attemptsPerTradingDay: 5,
    timezoneReference: 'UTC_WITH_CAIRO_AFTER_CLOSE_GUARD'
  },
  sessionDate: decision.sessionDate || null,
  expectedLatestSession: decision.expectedLatestSession || price.expectedSession || null,
  recommendationGeneratedAt: decision.generatedAt || null,
  recommendationsReady: decision.practicalReady === true,
  recommendationCount: Array.isArray(decision.recommendations) ? decision.recommendations.length : 0,
  recommendationTickers: Array.isArray(decision.recommendations) ? decision.recommendations.map(row => row.ticker) : [],
  priceTruth: {
    ready: price.ready === true,
    executionGrade: price.executionGrade === true,
    acceptedRows: price.acceptedRows || 0,
    source: price.source?.name || null,
    sourceGeneratedAt: price.source?.generatedAt || null
  },
  fundamentals: {
    generatedAt: fundamentals.generatedAt || null,
    parserVersion: raw.parserVersion || null,
    marketUniverse: fundamentals.summary?.marketUniverse || raw.universeCount || 0,
    rawCoverage: fundamentals.summary?.rawCoverage || raw.coverageCount || 0,
    coveragePct: raw.coveragePct || null,
    scoredCompanies: fundamentals.summary?.scoredCompanies || 0,
    freshStatements: fundamentals.summary?.freshStatements || 0,
    staleStatements: fundamentals.summary?.staleStatements || 0,
    currentRecommendationCoverage: fundamentals.summary?.currentRecommendationFinancialCoverage || 0,
    officialVerifiedCompanies: fundamentals.summary?.officialVerifiedCompanies || official.summary?.verifiedRecords || 0,
    coverageTargetPct: 80
  },
  officialDisclosures: {
    generatedAt: official.generatedAt || null,
    verifiedRecords: official.summary?.verifiedRecords || 0,
    auditedRecords: official.summary?.auditedRecords || 0,
    remoteFeedStatus: official.remoteFeed?.status || 'NOT_CONFIGURED'
  },
  marketRegime: {
    generatedAt: regime.generatedAt || null,
    regime: regime.regime || 'UNKNOWN',
    labelAr: regime.labelAr || null,
    score: regime.score ?? null,
    riskMultiplier: regime.riskMultiplier ?? null,
    maxTradeRiskPct: regime.maxTradeRiskPct ?? null
  },
  liveEvidence: {
    generatedAt: live.generatedAt || evaluation.generatedAt || null,
    archivedRecommendations: live.summary?.archivedRecommendations || evaluation.summary?.archivedRecommendations || 0,
    enteredTrades: live.summary?.enteredTrades || evaluation.summary?.enteredTrades || 0,
    resolvedTrades: live.summary?.resolvedTrades || evaluation.summary?.resolvedTrades || 0,
    profitFactor: live.summary?.profitFactor ?? null,
    maxDrawdownPct: live.summary?.maxDrawdownPct ?? null,
    averageAlphaVsMarketPct: live.summary?.averageAlphaVsMarketPct ?? null
  },
  portfolioRisk: {
    generatedAt: correlation.generatedAt || null,
    highCorrelationPairCount: correlation.summary?.highCorrelationPairCount || 0,
    largestSector: correlation.summary?.largestSector || null,
    suggestedMaximumPositions: correlation.summary?.suggestedMaximumPositions || null,
    suggestedMaximumOpenRiskPct: correlation.summary?.suggestedMaximumOpenRiskPct || null
  },
  alerts: {
    generatedAt: alerts.generatedAt || null,
    total: alerts.summary?.total || 0,
    critical: alerts.summary?.critical || 0,
    high: alerts.summary?.high || 0
  },
  browserTests: browser,
  wholeApplicationReview: {
    generatedAt: review.generatedAt || null,
    scope: review.scope?.type || null,
    acceptance: review.acceptance || null,
    openChecks: review.summary?.openChecks ?? null,
    blockingFindings: review.summary?.blockingFindings ?? null
  }
};
write('data/stable/v15-update-status.json', out);
console.log(out);
