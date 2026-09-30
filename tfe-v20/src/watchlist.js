import { POLICY } from './policy.js';

export const WATCHLIST_POLICY = Object.freeze({
  maxCandidates: 20,
  maxFailedNumericGates: 2,
  maxDeficit: Object.freeze({
    core: 8,
    research: 8,
    liquidity: 10,
    supportResistance: 10,
    structuralNetRR: 0.20,
  }),
  criticalReasons: Object.freeze([
    'QUALITY_BLOCKED',
    'INSUFFICIENT_HISTORY',
    'TRADE_PLAN_UNAVAILABLE',
    'DO_NOT_CHASE',
    'BELOW_ENTRY_WAIT',
    'PRICE_RECONCILIATION_REQUIRED',
  ]),
  weights: Object.freeze({
    research: 0.30,
    core: 0.25,
    liquidity: 0.15,
    supportResistance: 0.10,
    structuralNetRR: 0.15,
    dataQuality: 0.05,
  }),
});

const finite = v => Number.isFinite(Number(v));
const num = v => finite(v) ? Number(v) : null;
const round = (v, d = 4) => Number(Number(v).toFixed(d));

function percentileMap(rows, getter) {
  const values = rows
    .map((x, i) => ({ i, v: num(getter(x)) }))
    .filter(x => x.v !== null)
    .sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Map();
  if (!values.length) return out;
  if (values.length === 1) {
    out.set(values[0].i, 1);
    return out;
  }
  for (let p = 0; p < values.length;) {
    let q = p + 1;
    while (q < values.length && values[q].v === values[p].v) q++;
    const avgRank = (p + (q - 1)) / 2;
    const percentile = avgRank / (values.length - 1);
    for (let k = p; k < q; k++) out.set(values[k].i, percentile);
    p = q;
  }
  return out;
}

function numericState(x) {
  const core = num(x.scores?.core);
  const research = num(x.scores?.research);
  const liquidity = num(x.scores?.liquidity);
  const supportResistance = num(x.scores?.supportResistance);
  const dataQuality = num(x.scores?.dataQuality);
  const structuralNetRR = num(x.tradePlan?.structuralNetRR);
  const deficit = {
    core: core === null ? Infinity : Math.max(0, POLICY.minCoreScore - core),
    research: research === null ? Infinity : Math.max(0, POLICY.minResearchScore - research),
    liquidity: liquidity === null ? Infinity : Math.max(0, POLICY.minLiquidityScore - liquidity),
    supportResistance: supportResistance === null ? Infinity : Math.max(0, POLICY.minSrScore - supportResistance),
    structuralNetRR: structuralNetRR === null ? Infinity : Math.max(0, POLICY.minStructuralNetRR - structuralNetRR),
  };
  return { core, research, liquidity, supportResistance, dataQuality, structuralNetRR, deficit };
}

function failedNumericGates(deficit) {
  return Object.entries(deficit).filter(([, v]) => v > 0).map(([k]) => k);
}

function withinNearMissLimits(deficit) {
  const m = WATCHLIST_POLICY.maxDeficit;
  return deficit.core <= m.core
    && deficit.research <= m.research
    && deficit.liquidity <= m.liquidity
    && deficit.supportResistance <= m.supportResistance
    && deficit.structuralNetRR <= m.structuralNetRR;
}

function thresholdCloseness(s) {
  const ratios = [
    s.core === null ? 0 : Math.min(1, s.core / POLICY.minCoreScore),
    s.research === null ? 0 : Math.min(1, s.research / POLICY.minResearchScore),
    s.liquidity === null ? 0 : Math.min(1, s.liquidity / POLICY.minLiquidityScore),
    s.supportResistance === null ? 0 : Math.min(1, s.supportResistance / POLICY.minSrScore),
    s.structuralNetRR === null ? 0 : Math.min(1, s.structuralNetRR / POLICY.minStructuralNetRR),
  ];
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

export function buildHighPotentialWatchlist(analyses = [], limit = WATCHLIST_POLICY.maxCandidates) {
  const rows = Array.isArray(analyses) ? analyses : [];
  const rankMaps = {
    research: percentileMap(rows, x => x.scores?.research),
    core: percentileMap(rows, x => x.scores?.core),
    liquidity: percentileMap(rows, x => x.scores?.liquidity),
    supportResistance: percentileMap(rows, x => x.scores?.supportResistance),
    structuralNetRR: percentileMap(rows, x => x.tradePlan?.structuralNetRR),
    dataQuality: percentileMap(rows, x => x.scores?.dataQuality),
  };
  const criticalSet = new Set(WATCHLIST_POLICY.criticalReasons);
  const enriched = rows.map((x, i) => {
    const s = numericState(x);
    const reasons = Array.isArray(x.reasonCodes) ? x.reasonCodes : [];
    const criticalReasons = reasons.filter(r => criticalSet.has(r));
    if (x.quality?.publicationHold) criticalReasons.push('PRICE_RECONCILIATION_REQUIRED');
    const failedGates = failedNumericGates(s.deficit);
    const w = WATCHLIST_POLICY.weights;
    const relativeOpportunityScore = 100 * (
      w.research * (rankMaps.research.get(i) ?? 0) +
      w.core * (rankMaps.core.get(i) ?? 0) +
      w.liquidity * (rankMaps.liquidity.get(i) ?? 0) +
      w.supportResistance * (rankMaps.supportResistance.get(i) ?? 0) +
      w.structuralNetRR * (rankMaps.structuralNetRR.get(i) ?? 0) +
      w.dataQuality * (rankMaps.dataQuality.get(i) ?? 0)
    );
    const closeness = thresholdCloseness(s);
    const watchlistEligible = x.eligible !== true
      && criticalReasons.length === 0
      && failedGates.length > 0
      && failedGates.length <= WATCHLIST_POLICY.maxFailedNumericGates
      && withinNearMissLimits(s.deficit)
      && ['IN_ENTRY_RANGE', 'NEAR_ENTRY_PULLBACK', 'PENDING_PULLBACK'].includes(x.tradePlan?.alignmentState);
    const candidateScore = 0.70 * relativeOpportunityScore + 0.30 * closeness * 100;
    return {
      source: x,
      state: s,
      reasons,
      criticalReasons: [...new Set(criticalReasons)],
      failedGates,
      relativeOpportunityScore: round(relativeOpportunityScore, 2),
      thresholdClosenessPct: round(closeness * 100, 2),
      candidateScore: round(candidateScore, 2),
      watchlistEligible,
    };
  });

  const candidates = enriched
    .filter(x => x.watchlistEligible)
    .sort((a, b) => b.candidateScore - a.candidateScore
      || (b.state.research ?? -Infinity) - (a.state.research ?? -Infinity)
      || (b.state.core ?? -Infinity) - (a.state.core ?? -Infinity)
      || String(a.source.ticker).localeCompare(String(b.source.ticker)))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || WATCHLIST_POLICY.maxCandidates)))
    .map((x, idx) => ({
      rank: idx + 1,
      ticker: x.source.ticker,
      nameAr: x.source.nameAr ?? null,
      nameEn: x.source.nameEn ?? null,
      sessionDate: x.source.sessionDate ?? null,
      price: x.source.price ?? null,
      watchlistOnly: true,
      recommendation: false,
      executionAllowed: false,
      decision: 'HIGH_POTENTIAL_WATCHLIST',
      candidateScore: x.candidateScore,
      relativeOpportunityScore: x.relativeOpportunityScore,
      thresholdClosenessPct: x.thresholdClosenessPct,
      scores: x.source.scores ?? null,
      tradePlan: x.source.tradePlan ?? null,
      quality: x.source.quality ?? null,
      failedGates: x.failedGates,
      deficits: Object.fromEntries(Object.entries(x.state.deficit).map(([k,v]) => [k, Number.isFinite(v) ? round(v, 3) : null])),
      reasonCodes: x.reasons,
      label: 'WATCHLIST_ONLY_NOT_A_RECOMMENDATION',
    }));

  return {
    policy: WATCHLIST_POLICY,
    candidates,
    summary: {
      analyzed: rows.length,
      officialEligible: rows.filter(x => x.eligible === true).length,
      highPotential: candidates.length,
      criticalRejected: enriched.filter(x => x.criticalReasons.length > 0).length,
      otherRejected: enriched.filter(x => x.source.eligible !== true && x.criticalReasons.length === 0 && !x.watchlistEligible).length,
    },
  };
}
