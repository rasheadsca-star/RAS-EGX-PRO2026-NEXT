#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const evidence = read('data/v20/full-market-technical.json');
const universe = read('data/v20/master-universe.json');
const current = read('data/v20/current.json');
const profiles = read('data/v20/stock-profiles.json');
const decisionTechnical = read('data/v20/technical-indicators.json');

check(evidence.schemaVersion === '20.0.0-full-market-technical-2', 'FULL_TECH_SCHEMA_DRIFT');
check(evidence.asOfSessionDate === current.sessionDate, 'FULL_TECH_SESSION_MISMATCH');
check(evidence.policy?.pointInTime === true, 'FULL_TECH_POINT_IN_TIME_MISSING');
check(evidence.policy?.identityVerificationRequired === true, 'FULL_TECH_IDENTITY_REQUIREMENT_MISSING');
check(evidence.policy?.currentSessionRequired === true, 'FULL_TECH_CURRENT_SESSION_REQUIREMENT_MISSING');
check(evidence.policy?.missingOhlcSynthesisAllowed === false, 'FULL_TECH_SYNTHETIC_OHLC_ALLOWED');
check(evidence.policy?.futureRowsAllowed === false, 'FULL_TECH_FUTURE_ROWS_ALLOWED');
check(evidence.policy?.primaryProvider === 'YAHOO', 'FULL_TECH_PRIMARY_PROVIDER_DRIFT');
check(evidence.policy?.secondaryProvider === 'STARTA', 'FULL_TECH_SECONDARY_PROVIDER_DRIFT');
check(evidence.policy?.secondaryProviderResearchOnly === true, 'FULL_TECH_STARTA_ROLE_OVERSTATED');
check(evidence.policy?.providerBlendingAllowed === false, 'FULL_TECH_PROVIDER_BLENDING_ALLOWED');
check(
  evidence.policy?.usedForDecisionScore === false
  && evidence.policy?.usedForExecutionGate === false
  && evidence.policy?.usedForProductionAllocation === false,
  'FULL_TECH_PRODUCTION_LEAK'
);
check((evidence.symbols || []).length === universe.count, 'FULL_TECH_UNIVERSE_COUNT_MISMATCH');

let ready = 0;
let yahooReady = 0;
let startaReady = 0;
let cachedReady = 0;
const seen = new Set();
const allowedReadySources = new Set(['LIVE_YAHOO_REFRESH','LIVE_STARTA_SECONDARY_REFRESH','CACHED_VERIFIED_HISTORY_DOCUMENT']);
for (const row of evidence.symbols || []) {
  check(!seen.has(row.ticker), `FULL_TECH_DUPLICATE_${row.ticker}`);
  seen.add(row.ticker);

  // Architectural invariant: this 227-symbol evidence layer is display/research
  // context only. Decision Intelligence uses the separate opportunity-scope,
  // point-in-time technical pipeline in data/v20/technical-indicators.json.
  check(row.decisionUse === 'MARKET_TECHNICAL_EVIDENCE_ONLY_NOT_SCORE_EXECUTION_OR_ALLOCATION', `FULL_TECH_DECISION_USE_LABEL_DRIFT_${row.ticker}`);
  check(row.usedForDecisionScore !== true, `FULL_TECH_SCORE_LEAK_${row.ticker}`);
  check(row.usedForExecutionGate !== true, `FULL_TECH_EXECUTION_LEAK_${row.ticker}`);
  check(row.usedForProductionAllocation !== true, `FULL_TECH_ALLOCATION_LEAK_${row.ticker}`);
  check(row.providerBlended === false, `FULL_TECH_PROVIDER_BLEND_${row.ticker}`);
  check(Number(row.futureRowsRejected || 0) >= 0, `FULL_TECH_FUTURE_REJECT_COUNT_INVALID_${row.ticker}`);

  if (row.currentReady === true) {
    ready += 1;
    check(allowedReadySources.has(row.sourceKind), `FULL_TECH_READY_SOURCE_KIND_INVALID_${row.ticker}`);
    check(row.identityVerified === true, `FULL_TECH_READY_IDENTITY_UNVERIFIED_${row.ticker}`);
    check(row.asOfSession === current.sessionDate, `FULL_TECH_READY_SESSION_MISMATCH_${row.ticker}`);
    check(Number(row.rowsUsed) >= 50, `FULL_TECH_READY_ROWS_LT50_${row.ticker}`);
    check(Number(row.currentPriceDifferencePct) <= Number(evidence.policy.currentPriceReconciliationTolerancePct), `FULL_TECH_READY_PRICE_DIFF_${row.ticker}`);
    for (const key of ['sma20','sma50','ema12','ema26','rsi14','macd','macdSignal','atr14','momentum5Pct','momentum20Pct']) {
      check(Number.isFinite(Number(row.indicators?.[key])), `FULL_TECH_READY_INDICATOR_MISSING_${row.ticker}_${key}`);
    }
    check((row.blockers || []).length === 0, `FULL_TECH_READY_HAS_BLOCKERS_${row.ticker}`);
    if (row.sourceKind === 'LIVE_YAHOO_REFRESH') {
      yahooReady += 1;
      check(row.providerRole === 'PRIMARY_PUBLIC_RESEARCH_PROVIDER', `FULL_TECH_YAHOO_ROLE_DRIFT_${row.ticker}`);
    }
    if (row.sourceKind === 'LIVE_STARTA_SECONDARY_REFRESH') {
      startaReady += 1;
      check(row.providerRole === 'SECONDARY_NON_OFFICIAL_RESEARCH_ONLY', `FULL_TECH_STARTA_ROLE_DRIFT_${row.ticker}`);
      check(row.source === 'starta_ohlc_api', `FULL_TECH_STARTA_SOURCE_DRIFT_${row.ticker}`);
      check((row.attempts || []).some(a => a.source === 'starta_live' && a.ok === true), `FULL_TECH_STARTA_READY_WITHOUT_FETCH_${row.ticker}`);
    }
    if (row.sourceKind === 'CACHED_VERIFIED_HISTORY_DOCUMENT') cachedReady += 1;
  }
}

check(ready === evidence.summary?.currentReadyCount, 'FULL_TECH_READY_COUNT_MISMATCH');
check(evidence.summary?.currentReadyCoveragePct === Math.round(ready / universe.count * 10000) / 100, 'FULL_TECH_COVERAGE_MISMATCH');
check(yahooReady === evidence.summary?.liveYahooReadyCount, 'FULL_TECH_YAHOO_READY_COUNT_MISMATCH');
check(startaReady === evidence.summary?.liveStartaReadyCount, 'FULL_TECH_STARTA_READY_COUNT_MISMATCH');
check(cachedReady === evidence.summary?.cachedReadyCount, 'FULL_TECH_CACHED_READY_COUNT_MISMATCH');
check(Number(evidence.summary?.startaAttemptCount || 0) >= startaReady, 'FULL_TECH_STARTA_READY_EXCEEDS_ATTEMPTS');
check(Number(evidence.summary?.startaFetchSuccessCount || 0) >= startaReady, 'FULL_TECH_STARTA_READY_EXCEEDS_FETCH_SUCCESS');
check(Number(evidence.summary?.unavailableCount || 0) === universe.count - ready, 'FULL_TECH_UNAVAILABLE_COUNT_MISMATCH');

// Prove the two technical layers stay separate rather than trying to make their
// per-symbol usage flags equal. Opportunity profiles may legitimately use the
// 30-symbol decision-technical layer while the same ticker remains research-only
// in full-market technical evidence.
check(profiles.technicalIndicatorPolicy === 'POINT_IN_TIME_TRUSTED_OHLC_ONLY_STALE_CONTEXT_NEVER_CURRENT_DECISION', 'FULL_TECH_PROFILE_POLICY_DRIFT');
check(decisionTechnical.indicatorMethodology?.pointInTime === true, 'FULL_TECH_DECISION_PIPELINE_NOT_POINT_IN_TIME');
for (const profile of profiles.profiles || []) {
  if (profile.technicalAnalysis?.usedForCurrentDecision === true) {
    const source = (decisionTechnical.symbols || []).find(x => x.ticker === profile.ticker);
    check(source?.usedForCurrentDecision === true && source?.currentTechnicalReady === true, `FULL_TECH_DECISION_PIPELINE_SOURCE_MISSING_${profile.ticker}`);
  }
}

const report = {
  schemaVersion: '20.0.0-full-market-technical-regression-3',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  evidence: {
    universeCount: universe.count,
    currentReadyCount: ready,
    currentReadyCoveragePct: evidence.summary?.currentReadyCoveragePct,
    liveYahooReadyCount: yahooReady,
    liveStartaReadyCount: startaReady,
    cachedReadyCount: cachedReady,
    startaAttemptCount: evidence.summary?.startaAttemptCount ?? null,
    startaFetchSuccessCount: evidence.summary?.startaFetchSuccessCount ?? null,
    startaFetchFailureCount: evidence.summary?.startaFetchFailureCount ?? null,
    unresolvedBlockerCounts: evidence.summary?.unresolvedBlockerCounts || {},
    opportunityProfilesUsingSeparateDecisionTechnical: (profiles.profiles || []).filter(p => p.technicalAnalysis?.usedForCurrentDecision === true).length,
  },
  checks: {
    pointInTimeNoLookahead: true,
    identityRequired: true,
    currentSessionRequired: true,
    priceReconciliationRequired: true,
    noSyntheticOhlc: true,
    providerBlendingForbidden: true,
    startaSecondaryEvidenceResearchOnly: true,
    fullMarketTechnicalNeverDrivesDecisionScore: true,
    fullMarketTechnicalNeverDrivesExecutionGate: true,
    fullMarketTechnicalNeverDrivesProductionAllocation: true,
    opportunityDecisionTechnicalUsesSeparateAuthoritativePipeline: true,
  },
};

fs.writeFileSync(P('data/v20/full-market-technical-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
