const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x)));
const round = (x, d = 2) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;
const hasNumber = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

export const META_POLICY = Object.freeze({
  engineId: 'EGX_META_ENGINE_V1',
  researchOnly: true,
  minIndependentFamilies: 2,
  minDataQuality: 70,
  minLiquidityScore: 55,
  minStructuralNetRR: 0.70,
  minAverageExpertReliability: 0.30,
  maxDisagreementForTrade: 0.75,
  thresholds: Object.freeze({ buy: 60, ready: 48, watch: 32 }),
  evidenceWeights: Object.freeze({
    FRESH_INDEPENDENT_FORWARD: 1.00,
    EXACT_WALK_FORWARD: 0.92,
    NATIVE_RECORDED_LIVE: 0.90,
    REUSED_HOLDOUT: 0.72,
    RETROSPECTIVE_POINT_IN_TIME: 0.58,
    RECORDED_BACKFILL: 0.55,
    SNAPSHOT_CURRENT_ONLY: 0.42,
    PROXY_RECONSTRUCTION: 0.30,
    UNKNOWN: 0.20,
  }),
});

function evidenceKey(evidenceClass = '') {
  const e = String(evidenceClass).toUpperCase();
  if (e.includes('FRESH') && e.includes('FORWARD')) return 'FRESH_INDEPENDENT_FORWARD';
  if (e.includes('EXACT') && e.includes('WALK_FORWARD')) return 'EXACT_WALK_FORWARD';
  if (e.includes('NATIVE') && (e.includes('LIVE') || e.includes('RECORDED'))) return 'NATIVE_RECORDED_LIVE';
  if (e.includes('REUSED') && e.includes('HOLDOUT')) return 'REUSED_HOLDOUT';
  if (e.includes('RETROSPECTIVE') && (e.includes('POINT_IN_TIME') || e.includes('POINT-IN-TIME'))) return 'RETROSPECTIVE_POINT_IN_TIME';
  if (e.includes('RECORDED') && e.includes('BACKFILL')) return 'RECORDED_BACKFILL';
  if (e.includes('SNAPSHOT')) return 'SNAPSHOT_CURRENT_ONLY';
  if (e.includes('PROXY') || e.includes('RECONSTRUCT')) return 'PROXY_RECONSTRUCTION';
  return 'UNKNOWN';
}

function wilsonLower(successes, total, z = 1.96) {
  if (!(total > 0) || successes < 0 || successes > total) return null;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return clamp((center - margin) / denom);
}

function normalizedMetricBlend(parts) {
  let num = 0;
  let den = 0;
  for (const part of parts) {
    if (!hasNumber(part.value) || !(part.weight > 0)) continue;
    num += clamp(part.value) * part.weight;
    den += part.weight;
  }
  return den ? num / den : null;
}

export function expertReliability(expert = {}) {
  const evidence = META_POLICY.evidenceWeights[evidenceKey(expert.evidenceClass)] ?? META_POLICY.evidenceWeights.UNKNOWN;
  const oos = expert.oos ?? {};
  const entered = hasNumber(oos.entered) ? Math.max(0, Number(oos.entered)) : null;
  const targets = hasNumber(oos.targetHits) ? Math.max(0, Number(oos.targetHits)) : null;
  const stops = hasNumber(oos.stopHits) ? Math.max(0, Number(oos.stopHits)) : null;
  const profitFactor = hasNumber(oos.profitFactor) ? Math.max(0, Number(oos.profitFactor)) : null;
  const avgNetPct = hasNumber(oos.avgNetPct) ? Number(oos.avgNetPct) : null;

  const sampleReliability = entered == null ? null : 1 - Math.exp(-entered / 30);
  const targetWilson = entered && targets != null ? wilsonLower(Math.min(targets, entered), entered) : null;
  const stopAvoidance = entered && stops != null ? 1 - Math.min(1, stops / entered) : null;
  const pfScore = profitFactor == null ? null : clamp(profitFactor / 2);
  const avgNetScore = avgNetPct == null ? null : clamp(0.5 + avgNetPct / 8);

  const statistical = normalizedMetricBlend([
    { value: sampleReliability, weight: 0.25 },
    { value: targetWilson, weight: 0.25 },
    { value: stopAvoidance, weight: 0.20 },
    { value: pfScore, weight: 0.20 },
    { value: avgNetScore, weight: 0.10 },
  ]);

  const statsMultiplier = statistical == null ? 0.70 : 0.55 + 0.45 * statistical;
  const qualityMultiplier = hasNumber(expert.dataQuality) ? 0.65 + 0.35 * clamp(Number(expert.dataQuality) / 100) : 0.82;
  const reliability = clamp(evidence * statsMultiplier * qualityMultiplier);

  return {
    reliability: round(reliability, 4),
    evidenceKey: evidenceKey(expert.evidenceClass),
    evidenceWeight: evidence,
    statisticalReliability: statistical == null ? null : round(statistical, 4),
    sampleReliability: sampleReliability == null ? null : round(sampleReliability, 4),
    targetWilsonLower95: targetWilson == null ? null : round(targetWilson, 4),
  };
}

function signalDirection(signal = '') {
  const s = String(signal).toUpperCase();
  if (['STRONG_BUY', 'BUY', 'RESEARCH_BUY_ZONE', 'ENTER', 'ACTIONABLE'].includes(s)) return 1;
  if (['READY', 'NEAR_ENTRY', 'RESEARCH_PENDING_PULLBACK', 'PENDING_PULLBACK', 'WATCH TRIGGER'].includes(s)) return 0.75;
  if (['WATCH', 'HOLD', 'WAIT'].includes(s)) return 0.25;
  if (['SELL', 'EXIT', 'STRONG_SELL'].includes(s)) return -1;
  if (['REJECT', 'REJECTED', 'AVOID'].includes(s)) return -0.5;
  return 0;
}

function expertContribution(expert) {
  const reliability = expertReliability(expert);
  const direction = signalDirection(expert.signal ?? expert.decision);
  const score01 = hasNumber(expert.score) ? clamp(Number(expert.score) / 100) : 0.50;
  const conviction = 0.70 + 0.30 * score01;
  const weight = conviction * reliability.reliability;
  return { ...reliability, direction, score01: round(score01, 4), conviction: round(conviction, 4), weight: round(weight, 6), contribution: direction * weight };
}

function aggregateIndependentFamilies(contributions) {
  const groups = new Map();
  for (const item of contributions.filter((x) => x.direction !== 0 && x.reliability > 0)) {
    const family = String(item.family ?? item.id ?? 'UNKNOWN').toUpperCase();
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(item);
  }
  const families = [];
  for (const [family, members] of groups.entries()) {
    const totalMemberWeight = members.reduce((s, x) => s + x.weight, 0);
    const maxWeight = Math.max(...members.map((x) => x.weight));
    const directionalMean = totalMemberWeight ? members.reduce((s, x) => s + x.direction * x.weight, 0) / totalMemberWeight : 0;
    const signs = new Set(members.map((x) => Math.sign(x.direction)).filter(Boolean));
    families.push({
      family,
      memberCount: members.length,
      memberIds: members.map((x) => x.id),
      intraFamilyConflict: signs.size > 1,
      weight: maxWeight,
      direction: directionalMean,
      contribution: directionalMean * maxWeight,
      reliability: Math.max(...members.map((x) => x.reliability)),
    });
  }
  return families;
}

function regimeFactor(regime = 'NEUTRAL') {
  switch (String(regime).toUpperCase()) {
    case 'BULL': case 'RISK_ON': return 1.00;
    case 'NEUTRAL': case 'SIDEWAYS': return 0.86;
    case 'BEAR': case 'RISK_OFF': return 0.62;
    case 'STRESS': case 'CRASH': return 0.38;
    default: return 0.78;
  }
}

function hardGate(candidate) {
  const quality = candidate.quality ?? {};
  const liquidity = candidate.liquidity ?? {};
  const plan = candidate.tradePlan ?? null;
  const reasons = [];

  if (quality.state === 'BLOCKED' || quality.staleData === true) reasons.push('DATA_QUALITY_BLOCKED');
  if (!hasNumber(quality.score)) reasons.push('DATA_QUALITY_UNKNOWN');
  else if (Number(quality.score) < META_POLICY.minDataQuality) reasons.push('DATA_QUALITY_LOW');

  if (!hasNumber(liquidity.score)) reasons.push('LIQUIDITY_UNKNOWN');
  else if (Number(liquidity.score) < META_POLICY.minLiquidityScore) reasons.push('LIQUIDITY_LOW');

  if (!plan) {
    reasons.push('TRADE_PLAN_UNAVAILABLE');
  } else {
    const required = [plan.entryLow, plan.entryHigh, plan.stop, plan.target1];
    if (!required.every(hasNumber) || !(Number(plan.stop) < Number(plan.entryHigh) && Number(plan.target1) > Number(plan.entryLow))) reasons.push('INVALID_TRADE_PLAN');
    if (!hasNumber(plan.structuralNetRR)) reasons.push('STRUCTURAL_RR_UNKNOWN');
    else if (Number(plan.structuralNetRR) < META_POLICY.minStructuralNetRR) reasons.push('STRUCTURAL_RR_LOW');
    if (plan.alignmentState && ['DO_NOT_CHASE', 'BELOW_ENTRY_WAIT'].includes(String(plan.alignmentState).toUpperCase())) reasons.push(String(plan.alignmentState).toUpperCase());
  }
  return reasons;
}

export function evaluateMetaCandidate(candidate = {}) {
  const experts = Array.isArray(candidate.experts) ? candidate.experts.filter(Boolean) : [];
  const blocks = hardGate(candidate);
  const contributions = experts.map((expert) => ({
    id: expert.id ?? expert.name ?? 'EXPERT',
    family: expert.family ?? expert.engineFamily ?? expert.id ?? expert.name ?? 'UNKNOWN',
    signal: expert.signal ?? expert.decision ?? 'UNKNOWN',
    ...expertContribution(expert),
  }));
  const families = aggregateIndependentFamilies(contributions);
  const totalWeight = families.reduce((s, x) => s + Math.abs(x.weight), 0);
  const signed = families.reduce((s, x) => s + x.contribution, 0);
  const rawAgreement = totalWeight ? Math.abs(signed) / totalWeight : 0;
  const disagreement = 1 - rawAgreement;
  const avgReliability = families.length ? families.reduce((s, x) => s + x.reliability, 0) / families.length : 0;
  const directionalEdge = totalWeight ? signed / totalWeight : 0;

  const qualityScore = hasNumber(candidate.quality?.score) ? clamp(Number(candidate.quality.score) / 100) : 0;
  const liquidityScore = hasNumber(candidate.liquidity?.score) ? clamp(Number(candidate.liquidity.score) / 100) : 0;
  const rr = hasNumber(candidate.tradePlan?.structuralNetRR) ? Number(candidate.tradePlan.structuralNetRR) : 0;
  const rrFactor = hasNumber(candidate.tradePlan?.structuralNetRR) ? clamp((rr - 0.50) / 1.50, 0.25, 1) : 0;
  const marketFactor = regimeFactor(candidate.market?.regime);
  const regimeConfidence = hasNumber(candidate.market?.confidence) ? 0.7 + 0.3 * clamp(Number(candidate.market.confidence) / 100) : 0.88;

  const contextFactor = qualityScore * (0.65 + 0.35 * liquidityScore) * rrFactor * marketFactor * regimeConfidence;
  const edgeScore = 100 * directionalEdge * contextFactor;
  const confidence = 100 * (0.45 * rawAgreement + 0.25 * avgReliability + 0.15 * qualityScore + 0.15 * marketFactor);

  if (families.length < META_POLICY.minIndependentFamilies) blocks.push('INSUFFICIENT_INDEPENDENT_EXPERTS');
  if (avgReliability < META_POLICY.minAverageExpertReliability) blocks.push('EXPERT_EVIDENCE_TOO_WEAK');
  if (disagreement > META_POLICY.maxDisagreementForTrade) blocks.push('EXPERT_DISAGREEMENT_HIGH');
  if (directionalEdge <= 0) blocks.push('NON_POSITIVE_CONSENSUS_EDGE');

  let decision = 'NO_TRADE';
  if (!blocks.length) {
    if (edgeScore >= META_POLICY.thresholds.buy) decision = 'BUY';
    else if (edgeScore >= META_POLICY.thresholds.ready) decision = 'READY';
    else if (edgeScore >= META_POLICY.thresholds.watch) decision = 'WATCH';
  }

  return {
    ticker: String(candidate.ticker ?? '').toUpperCase(),
    engineId: META_POLICY.engineId,
    decision,
    researchOnly: true,
    edgeScore: round(edgeScore, 2),
    confidence: round(confidence, 2),
    agreement: round(rawAgreement * 100, 2),
    disagreement: round(disagreement * 100, 2),
    independentFamilyCount: families.length,
    averageExpertReliability: round(avgReliability, 4),
    context: {
      dataQuality: hasNumber(candidate.quality?.score) ? round(qualityScore * 100, 1) : null,
      liquidity: hasNumber(candidate.liquidity?.score) ? round(liquidityScore * 100, 1) : null,
      structuralNetRR: hasNumber(candidate.tradePlan?.structuralNetRR) ? round(rr, 3) : null,
      marketRegime: candidate.market?.regime ?? 'UNKNOWN',
      contextFactor: round(contextFactor, 4),
    },
    blocks: [...new Set(blocks)],
    experts: contributions,
    families,
    tradePlan: candidate.tradePlan ?? null,
    methodology: {
      missingEvidence: 'OMITTED_NOT_ZERO',
      missingTradeCriticalInputs: 'FAIL_CLOSED_NO_TRADE',
      evidenceWeighting: 'FRESH_FORWARD_GT_WALK_FORWARD_GT_RETROSPECTIVE_GT_PROXY',
      engineScores: 'DAMPED_CONVICTION_ONLY_NOT_CROSS_ENGINE_CALIBRATION',
      correlatedExperts: 'COLLAPSED_TO_ENGINE_FAMILY_CAP',
      hardRiskGatesCanBeBypassedByConsensus: false,
      abstentionAllowed: true,
      productionExecutionAllowed: false,
    },
  };
}

const priority = Object.freeze({ BUY: 4, READY: 3, WATCH: 2, NO_TRADE: 1 });

export function rankMetaCandidates(candidates = []) {
  return candidates.map(evaluateMetaCandidate).sort((a, b) =>
    (priority[b.decision] ?? 0) - (priority[a.decision] ?? 0)
    || b.edgeScore - a.edgeScore
    || b.confidence - a.confidence
    || (b.context.structuralNetRR ?? 0) - (a.context.structuralNetRR ?? 0)
    || a.ticker.localeCompare(b.ticker)
  ).map((x, i) => ({ ...x, rank: i + 1 }));
}
