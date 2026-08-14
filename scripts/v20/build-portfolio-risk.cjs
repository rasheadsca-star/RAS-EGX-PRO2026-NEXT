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
function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function clamp(value, min, max) {
  const n = finite(value, min);
  return Math.max(min, Math.min(max, n));
}

const current = read('data/v20/current.json');
const policy = read('data/v20/policy-registry.json');
const v17Gate = read('data/v17/resilient-session-status.json');

const p = policy?.portfolio || {};
const maxTotal = clamp(Math.min(
  finite(current?.portfolio?.maximumTotalAllocationPct, 50),
  finite(p.maximumTotalAllocationPct, 50),
), 0, 100);
const maxPositions = Math.max(1, Math.floor(finite(p.maximumPositions, 4)));
const maxSingle = clamp(finite(p.maximumSinglePositionPct, 12.5), 0, maxTotal);
const state = current?.portfolio?.riskState || 'CASH_PRESERVATION';
const stateCap = clamp(finite(p?.riskStateExposureCapsPct?.[state], 0), 0, maxTotal);
const globalExecutionOpen = current?.executionStatus === 'EXECUTION_GRADE' && v17Gate?.executionGrade === true;
const appliedBudgetPct = globalExecutionOpen ? Math.min(maxTotal, stateCap) : 0;

function validActionable(row) {
  const t1 = row?.tradePlan?.target1Metrics || {};
  return row?.status === 'ACTIONABLE'
    && row?.liquidityExecutionEligible === true
    && row?.supportResistance?.executionEligible === true
    && row?.supportResistance?.sessionAligned === true
    && Number.isFinite(Number(row?.tradePlan?.entryLow))
    && Number.isFinite(Number(row?.tradePlan?.entryHigh))
    && Number.isFinite(Number(row?.tradePlan?.stop))
    && Number.isFinite(Number(row?.tradePlan?.target1))
    && t1.valid === true;
}

const actionable = (current.opportunities || []).filter(validActionable).slice(0, maxPositions);
const appliedWeight = actionable.length > 0
  ? Math.min(maxSingle, appliedBudgetPct / actionable.length)
  : 0;
const appliedWeightByTicker = new Map(actionable.map(row => [row.ticker, round(appliedWeight, 4)]));

const shadowCandidates = (current.opportunities || [])
  .filter(row => {
    const rr = finite(row?.tradePlan?.target1Metrics?.netRiskReward);
    return ['WATCH', 'ACTIONABLE'].includes(row?.status)
      && row?.liquidityExecutionEligible === true
      && row?.supportResistance
      && row?.supportResistance?.sessionAligned === true
      && rr !== null
      && rr > 0;
  })
  .slice(0, maxPositions);

const shadowBudgetPct = Math.min(maxTotal, stateCap || maxTotal);
const shadowRaw = shadowCandidates.map(row => {
  const score = clamp(finite(row.opportunityScore, 0), 0, 100);
  const dataConfidence = clamp(finite(row?.confidence?.dataConfidencePct, 0), 0, 100);
  const netRR = clamp(finite(row?.tradePlan?.target1Metrics?.netRiskReward, 0), 0, 5);
  const quality = (score / 100) * (dataConfidence / 100) * (netRR / 5);
  return { ticker: row.ticker, quality };
});
const shadowQualityTotal = shadowRaw.reduce((sum, row) => sum + row.quality, 0);
const shadowWeightByTicker = new Map();
for (const row of shadowRaw) {
  const normalized = shadowQualityTotal > 0 ? shadowBudgetPct * row.quality / shadowQualityTotal : 0;
  shadowWeightByTicker.set(row.ticker, round(Math.min(maxSingle, normalized), 4));
}
const shadowExposurePct = round([...shadowWeightByTicker.values()].reduce((a, b) => a + b, 0), 4);

current.opportunities = (current.opportunities || []).map(row => ({
  ...row,
  suggestedPositionWeightPct: appliedWeightByTicker.get(row.ticker) || 0,
  shadowPositionWeightPct: shadowWeightByTicker.get(row.ticker) || 0,
}));

const recommendedExposurePct = round([...appliedWeightByTicker.values()].reduce((a, b) => a + b, 0), 4);
const cashPct = round(100 - recommendedExposurePct, 4);

current.portfolio = {
  ...current.portfolio,
  riskState: state,
  constructionMode: p.productionConstruction || 'CHAMPION_COMPATIBLE_EQUAL_WEIGHT',
  maximumTotalAllocationPct: maxTotal,
  riskStateExposureCapPct: stateCap,
  appliedBudgetPct,
  recommendedExposurePct,
  cashPct,
  appliedPositionCount: actionable.length,
  maximumPositions: maxPositions,
  maximumSinglePositionPct: maxSingle,
  totalPlannedAllocationGuardPassed: recommendedExposurePct <= maxTotal + 1e-9,
  automaticOrders: false,
  adaptiveWeightingProductionAllowed: false,
  shadowResearch: {
    enabled: p.adaptiveWeightingShadowResearchAllowed === true,
    researchOnly: true,
    weightingMethod: 'QUALITY_WEIGHTED_SCORE_X_DATA_CONFIDENCE_X_NET_RR_CAPPED',
    exposurePct: shadowExposurePct,
    appliedToProductionPortfolio: false,
    candidateCount: shadowCandidates.length,
  },
  unfilledMemberPolicy: p.unfilledMemberPolicy || 'KEEP_CASH',
};

const report = {
  schemaVersion: '20.0.0-portfolio-risk-1',
  generatedAt: new Date().toISOString(),
  sessionDate: current.sessionDate,
  executionStatus: current.executionStatus,
  globalExecutionOpen,
  riskState: state,
  productionConstruction: current.portfolio.constructionMode,
  maximumTotalAllocationPct: maxTotal,
  riskStateExposureCapPct: stateCap,
  appliedBudgetPct,
  appliedExposurePct: recommendedExposurePct,
  cashPct,
  appliedPositions: actionable.map(row => ({
    ticker: row.ticker,
    rank: row.rank,
    positionWeightPct: appliedWeightByTicker.get(row.ticker) || 0,
    status: row.status,
    netRiskReward: finite(row?.tradePlan?.target1Metrics?.netRiskReward),
  })),
  shadowResearchPlan: {
    researchOnly: true,
    notExecutionAdvice: true,
    weightingMethod: current.portfolio.shadowResearch.weightingMethod,
    exposurePct: shadowExposurePct,
    positions: shadowCandidates.map(row => ({
      ticker: row.ticker,
      rank: row.rank,
      shadowPositionWeightPct: shadowWeightByTicker.get(row.ticker) || 0,
      opportunityScore: finite(row.opportunityScore),
      dataConfidencePct: finite(row?.confidence?.dataConfidencePct),
      netRiskReward: finite(row?.tradePlan?.target1Metrics?.netRiskReward),
    })),
  },
  invariants: {
    v17FinalGateAuthoritative: true,
    closedGateMeansZeroAppliedExposure: !globalExecutionOpen ? recommendedExposurePct === 0 : true,
    automaticOrders: false,
    automaticPromotion: false,
    adaptiveProductionWeighting: false,
    failedOrUnfilledAllocationRemainsCash: true,
  },
};

write('data/v20/current.json', current);
write('data/v20/portfolio-risk.json', report);

console.log(JSON.stringify({
  riskState: report.riskState,
  globalExecutionOpen,
  appliedExposurePct: report.appliedExposurePct,
  cashPct: report.cashPct,
  appliedPositions: report.appliedPositions.length,
  shadowResearchPositions: report.shadowResearchPlan.positions.length,
  shadowResearchExposurePct: report.shadowResearchPlan.exposurePct,
}, null, 2));
