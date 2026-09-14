import { clamp, round } from './math.js';

const DEFAULT_POLICY = Object.freeze({
  minDataQuality: 75,
  minNetRiskReward: 1.15,
  minExpectedEdgePct: 0.35,
  minMetaScore: 62,
  readyScore: 72,
  buyScore: 80,
  maxSingleEngineWeight: 0.55,
  maxCorrelatedFamilyWeight: 0.70,
  minIndependentFamiliesForBuy: 2,
  minEvidenceReliabilityForBuy: 0.45,
  noTradeLiquidityScore: 45,
  costPenaltyMultiplier: 1,
  riskPenaltyMultiplier: 1
});

const EVIDENCE_FACTORS = Object.freeze({
  FRESH_FORWARD_INDEPENDENT: 1,
  WALK_FORWARD_POINT_IN_TIME: 0.90,
  HOLDOUT_REUSED_DIAGNOSTIC: 0.72,
  RETROSPECTIVE_POINT_IN_TIME: 0.62,
  RETROSPECTIVE_PROXY: 0.40,
  CURRENT_SNAPSHOT_ONLY: 0.25,
  UNVERIFIED: 0.10
});

function n(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function safe01(v, fallback = 0) {
  const x = n(v, fallback);
  return clamp(x, 0, 1);
}

export function evidenceFactor(evidenceClass) {
  return EVIDENCE_FACTORS[String(evidenceClass || 'UNVERIFIED').toUpperCase()] ?? EVIDENCE_FACTORS.UNVERIFIED;
}

export function wilsonReliability({ sampleSize = 0, wilsonLowerPct = null, hitRatePct = null } = {}) {
  const nObs = Math.max(0, n(sampleSize, 0));
  const score = n(wilsonLowerPct, n(hitRatePct, 50));
  const sampleReliability = 1 - Math.exp(-nObs / 30);
  return clamp((score / 100) * sampleReliability, 0, 1);
}

function normalizedSignal(engine) {
  const direct = n(engine.signalScore, null);
  if (direct != null) return clamp(direct, 0, 100);
  const confidence = n(engine.confidencePct, null);
  if (confidence != null) return clamp(confidence, 0, 100);
  const vote = String(engine.signal || engine.decision || '').toUpperCase();
  if (['STRONG_BUY', 'BUY', 'RESEARCH_BUY_ZONE', 'READY'].includes(vote)) return 85;
  if (['PENDING', 'WATCH', 'RESEARCH_PENDING_PULLBACK'].includes(vote)) return 62;
  if (['NEUTRAL', 'HOLD'].includes(vote)) return 50;
  if (['SELL', 'EXIT', 'AVOID', 'REJECTED'].includes(vote)) return 20;
  return 50;
}

function engineReliability(engine) {
  const evidence = evidenceFactor(engine.evidenceClass);
  const historical = engine.sampleSize != null || engine.wilsonLowerPct != null || engine.hitRatePct != null
    ? wilsonReliability(engine)
    : safe01(engine.reliability, 0.50);
  const freshness = safe01(engine.freshness, 1);
  const dataQuality = clamp(n(engine.dataQuality, 100) / 100, 0, 1);
  return clamp(evidence * (0.50 + 0.50 * historical) * freshness * dataQuality, 0, 1);
}

function capWeights(items, policy) {
  if (!items.length) return items;
  const totalRaw = items.reduce((s, x) => s + x.rawWeight, 0);
  if (!(totalRaw > 0)) return items.map(x => ({ ...x, weight: 0 }));

  let weighted = items.map(x => ({
    ...x,
    weight: Math.min(x.rawWeight / totalRaw, policy.maxSingleEngineWeight)
  }));

  const families = new Map();
  for (const x of weighted) {
    const family = x.family || x.id;
    const arr = families.get(family) || [];
    arr.push(x);
    families.set(family, arr);
  }

  for (const [, group] of families) {
    const familyWeight = group.reduce((s, x) => s + x.weight, 0);
    if (familyWeight <= policy.maxCorrelatedFamilyWeight) continue;
    const scale = policy.maxCorrelatedFamilyWeight / familyWeight;
    const ids = new Set(group.map(x => x.id));
    weighted = weighted.map(x => ids.has(x.id) ? ({ ...x, weight: x.weight * scale }) : x);
  }

  return weighted;
}

function marketRegimeMultiplier(regime) {
  const r = String(regime || 'NEUTRAL').toUpperCase();
  if (['RISK_ON', 'BULL', 'TREND_UP'].includes(r)) return 1.05;
  if (['RISK_OFF', 'BEAR', 'TREND_DOWN'].includes(r)) return 0.82;
  if (['HIGH_VOLATILITY', 'STRESS'].includes(r)) return 0.75;
  return 1;
}

function classify(metaScore, gates, policy) {
  if (gates.blocking.length) return 'NO_TRADE';
  if (metaScore >= policy.buyScore && gates.independentFamilyCount >= policy.minIndependentFamiliesForBuy && gates.evidenceReliability >= policy.minEvidenceReliabilityForBuy) return 'BUY';
  if (metaScore >= policy.readyScore) return 'READY';
  if (metaScore >= policy.minMetaScore) return 'WATCH';
  return 'NO_TRADE';
}

export function analyzeMetaOpportunity(input, customPolicy = {}) {
  const policy = { ...DEFAULT_POLICY, ...customPolicy };
  const engines = Array.isArray(input?.engines) ? input.engines : [];
  const dataQuality = n(input?.dataQuality, 0);
  const liquidityScore = n(input?.liquidityScore, 0);
  const netRiskReward = n(input?.netRiskReward, 0);
  const expectedEdgePct = n(input?.expectedEdgePct, 0);
  const estimatedRoundTripCostPct = Math.max(0, n(input?.estimatedRoundTripCostPct, 0));
  const riskPenalty = Math.max(0, n(input?.riskPenalty, 0));

  const prepared = engines.map((engine, index) => {
    const id = String(engine.id || `ENGINE_${index + 1}`);
    const reliability = engineReliability(engine);
    const signalScore = normalizedSignal(engine);
    const priorWeight = Math.max(0, n(engine.priorWeight, 1));
    return {
      id,
      family: String(engine.family || id),
      signalScore,
      reliability,
      rawWeight: reliability * priorWeight,
      evidenceClass: String(engine.evidenceClass || 'UNVERIFIED')
    };
  }).filter(x => x.rawWeight > 0);

  const weighted = capWeights(prepared, policy);
  const allocatedWeight = clamp(weighted.reduce((s, x) => s + x.weight, 0), 0, 1);
  const abstentionWeight = clamp(1 - allocatedWeight, 0, 1);

  const consensusScore = weighted.reduce((s, x) => s + x.signalScore * x.weight, 0) + 50 * abstentionWeight;
  const evidenceReliability = weighted.reduce((s, x) => s + x.reliability * x.weight, 0);
  const independentFamilyCount = new Set(weighted.filter(x => x.weight >= 0.10).map(x => x.family)).size;

  const regimeMultiplier = marketRegimeMultiplier(input?.marketRegime);
  const netEdgeAfterCosts = expectedEdgePct - estimatedRoundTripCostPct * policy.costPenaltyMultiplier;
  const edgeComponent = clamp(50 + netEdgeAfterCosts * 12, 0, 100);
  const rrComponent = clamp(35 + (netRiskReward - 0.5) * 30, 0, 100);
  const executionQuality = clamp(0.40 * dataQuality + 0.35 * liquidityScore + 0.25 * rrComponent, 0, 100);

  let metaScore = 0.55 * consensusScore + 0.20 * edgeComponent + 0.15 * executionQuality + 0.10 * (evidenceReliability * 100);
  metaScore = metaScore * regimeMultiplier - riskPenalty * policy.riskPenaltyMultiplier;
  metaScore = clamp(metaScore, 0, 100);

  const blocking = [];
  if (dataQuality < policy.minDataQuality) blocking.push('DATA_QUALITY_GATE_FAIL');
  if (liquidityScore < policy.noTradeLiquidityScore) blocking.push('LIQUIDITY_GATE_FAIL');
  if (netRiskReward < policy.minNetRiskReward) blocking.push('NET_RR_GATE_FAIL');
  if (netEdgeAfterCosts < policy.minExpectedEdgePct) blocking.push('EDGE_AFTER_COSTS_TOO_LOW');
  if (!weighted.length) blocking.push('NO_RELIABLE_ENGINE_EVIDENCE');

  const gates = {
    blocking,
    independentFamilyCount,
    evidenceReliability: round(evidenceReliability, 3),
    netEdgeAfterCostsPct: round(netEdgeAfterCosts, 3),
    allocatedEngineWeight: round(allocatedWeight, 3),
    abstentionWeight: round(abstentionWeight, 3)
  };

  const decision = classify(metaScore, gates, policy);
  return {
    ticker: input?.ticker ?? null,
    decision,
    metaScore: round(metaScore, 1),
    components: {
      consensusScore: round(consensusScore, 1),
      edgeComponent: round(edgeComponent, 1),
      executionQuality: round(executionQuality, 1),
      evidenceReliability: round(evidenceReliability * 100, 1),
      regimeMultiplier,
      abstentionWeight: round(abstentionWeight, 3)
    },
    gates,
    engineContributions: weighted
      .sort((a, b) => b.weight - a.weight)
      .map(x => ({
        id: x.id,
        family: x.family,
        signalScore: round(x.signalScore, 1),
        reliability: round(x.reliability, 3),
        weight: round(x.weight, 3),
        evidenceClass: x.evidenceClass
      })),
    policy: {
      minDataQuality: policy.minDataQuality,
      minNetRiskReward: policy.minNetRiskReward,
      minExpectedEdgePct: policy.minExpectedEdgePct,
      minIndependentFamiliesForBuy: policy.minIndependentFamiliesForBuy
    },
    methodology: {
      missingEvidence: 'LOW_WEIGHT_NOT_NEGATIVE_SIGNAL',
      correlatedEngines: 'FAMILY_WEIGHT_CAPPED_WITH_NEUTRAL_ABSTENTION_MASS',
      transactionCosts: 'DEDUCTED_BEFORE_EDGE_GATE',
      abstention: 'EXPLICIT_NO_TRADE_AND_NEUTRAL_UNALLOCATED_WEIGHT',
      evidenceClasses: 'FRESH_FORWARD_GT_WALK_FORWARD_GT_RETROSPECTIVE_GT_PROXY'
    }
  };
}

export function rankMetaOpportunities(items) {
  return [...(items || [])]
    .filter(Boolean)
    .sort((a, b) => {
      const order = { BUY: 4, READY: 3, WATCH: 2, NO_TRADE: 1 };
      return (order[b.decision] || 0) - (order[a.decision] || 0)
        || (b.metaScore || 0) - (a.metaScore || 0)
        || String(a.ticker || '').localeCompare(String(b.ticker || ''));
    })
    .map((x, i) => ({ ...x, rank: i + 1 }));
}
