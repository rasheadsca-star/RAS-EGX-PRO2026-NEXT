import { POLICY } from './policy.js';
import { analyzeTickerBase } from './engine.js';
import { normalizeBars } from './quality.js';
import { round, avg } from './math.js';

const hasNumber = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(x)));

function piecewise(x, points) {
  if (!Number.isFinite(Number(x))) return 0;
  x = Number(x);
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1], [x2, y2] = points[i];
    if (x <= x2) {
      const t = (x - x1) / Math.max(1e-12, x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return points.at(-1)[1];
}

function planScore(plan) {
  if (!plan) return 0;
  const rr = piecewise(plan.structuralNetRR, [[0,0],[.5,25],[.7,42],[1,58],[1.25,68],[1.5,78],[2,90],[3,100]]);
  const align = ({ IN_ENTRY_RANGE:100, NEAR_ENTRY_PULLBACK:85, PENDING_PULLBACK:70, DO_NOT_CHASE:25, BELOW_ENTRY_WAIT:20 })[plan.alignmentState] ?? 20;
  return .72 * rr + .28 * align;
}

function assessWithPlan(base, plan) {
  const researchScore = round(
    .35 * base.scores.technical
    + .15 * base.liquidity.score
    + .20 * base.supportResistance.score
    + .20 * planScore(plan)
    + .10 * base.quality.score,
    1,
  );
  const reasons = [];
  if (base.quality.state === 'BLOCKED') reasons.push('QUALITY_BLOCKED');
  if (base.scores.technical < POLICY.minCoreScore) reasons.push('CORE_SCORE_LOW');
  if (researchScore < POLICY.minResearchScore) reasons.push('RESEARCH_SCORE_LOW');
  if (base.liquidity.score < POLICY.minLiquidityScore || !base.liquidity.eligible) reasons.push('LIQUIDITY_GATE_FAIL');
  if (base.supportResistance.score < POLICY.minSrScore || base.supportResistance.methodCount < POLICY.minSrMethods) reasons.push('SR_CONFLUENCE_FAIL');
  if (!plan) reasons.push('TRADE_PLAN_UNAVAILABLE');
  if (plan && plan.structuralNetRR < POLICY.minStructuralNetRR) reasons.push('STRUCTURAL_RR_LOW');
  if (plan && ['DO_NOT_CHASE','BELOW_ENTRY_WAIT'].includes(plan.alignmentState)) reasons.push(plan.alignmentState);
  return { eligible: reasons.length === 0, researchScore, reasons };
}

function clusterResistanceMethods(sr, entryHigh, stop) {
  const risk = Math.max(0, entryHigh - stop);
  const tolerance = Math.max(entryHigh * 0.003, risk * 0.15);
  const points = (sr?.methods ?? [])
    .filter((m) => !['ATR_REFERENCE', 'SMA20_SUPPORT'].includes(String(m.name)))
    .filter((m) => hasNumber(m.resistance) && Number(m.resistance) > entryHigh)
    .map((m) => ({ name: String(m.name), value: Number(m.resistance), weight: hasNumber(m.weight) ? Number(m.weight) : 1 }))
    .sort((a, b) => a.value - b.value);

  const clusters = [];
  for (const p of points) {
    let c = clusters.find((x) => Math.abs(x.center - p.value) <= tolerance);
    if (!c) {
      c = { center: p.value, weightedSum: 0, weight: 0, methods: [], values: [] };
      clusters.push(c);
    }
    c.weightedSum += p.value * p.weight;
    c.weight += p.weight;
    c.center = c.weightedSum / c.weight;
    c.methods.push(p.name);
    c.values.push(p.value);
  }
  return clusters.sort((a, b) => a.center - b.center).map((c, index) => ({
    index,
    center: round(c.center, 4),
    methods: [...new Set(c.methods)],
    methodCount: new Set(c.methods).size,
    totalWeight: round(c.weight, 3),
    tolerance: round(tolerance, 4),
  }));
}

export function buildResistanceLadderPlan(base) {
  const p = base?.tradePlan;
  if (!p) return null;
  const clusters = clusterResistanceMethods(base.supportResistance, p.entryHigh, p.stop);
  if (!clusters.length) return { ...p, labVariant: 'RESISTANCE_LADDER_V1', labFallback: 'NO_TRUE_RESISTANCE_CLUSTER' };

  // Preregistered rule: the nearest true resistance remains an explicit obstacle;
  // if a second distinct true resistance exists, it becomes the structural target.
  // The choice is NOT conditioned on clearing the 0.70 RR gate.
  const obstacle = clusters[0];
  const targetCluster = clusters[1] ?? clusters[0];
  const target2 = targetCluster.center;
  const cost = p.entryHigh * POLICY.roundTripCostPct / 100;
  const effectiveRisk = p.entryHigh - p.stop + cost;
  if (!(effectiveRisk > 0 && target2 > p.entryHigh)) return null;
  const target1 = Math.min(target2, p.entryHigh + POLICY.precisionTargetR * effectiveRisk);
  const structuralNetRR = (target2 - p.entryHigh - cost) / effectiveRisk;
  const precisionNetRR = (target1 - p.entryHigh - cost) / effectiveRisk;

  return {
    ...p,
    target1: round(target1, 4),
    target2: round(target2, 4),
    structuralNetRR: round(structuralNetRR, 3),
    precisionNetRR: round(precisionNetRR, 3),
    labVariant: 'RESISTANCE_LADDER_V1',
    labFallback: clusters.length < 2 ? 'ONLY_ONE_TRUE_RESISTANCE_CLUSTER' : null,
    firstObstacle: obstacle,
    targetCluster,
    resistanceClusters: clusters,
  };
}

export function buildPlanVariant(base, variant = 'BASELINE_CURRENT') {
  if (variant === 'BASELINE_CURRENT') return base?.tradePlan ? { ...base.tradePlan, labVariant: 'BASELINE_CURRENT' } : null;
  if (variant === 'RESISTANCE_LADDER_V1') return buildResistanceLadderPlan(base);
  throw new Error(`UNKNOWN_PLAN_VARIANT:${variant}`);
}

function fill(bar, plan) {
  if (bar.open >= plan.entryLow && bar.open <= plan.entryHigh) return bar.open;
  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) return plan.entryHigh;
  if (bar.open < plan.entryLow) return null;
  if (bar.low <= plan.entryHigh && bar.high >= plan.entryLow) return plan.entryHigh;
  return null;
}

function summarize(trades, expired = []) {
  const n = trades.length;
  if (!n) return { trades, expired, summary: { entered:0,target1Pct:null,stopPct:null,positivePct:null,avgNetPct:null,profitFactor:null,wilson95LowerTarget1Pct:null,expectancyPct:null,maxTradeDrawdownPct:null } };
  const t1 = trades.filter((x) => x.outcome === 'TARGET1').length;
  const stop = trades.filter((x) => x.outcome.startsWith('STOP')).length;
  const wins = trades.filter((x) => x.netPct > 0), losses = trades.filter((x) => x.netPct < 0);
  const gp = wins.reduce((s,x)=>s+x.netPct,0), gl = Math.abs(losses.reduce((s,x)=>s+x.netPct,0));
  const p = t1 / n, z = 1.96, den = 1 + z*z/n;
  const lower = Math.max(0, (p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)) / den);
  let equity = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    equity += t.netPct;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return { trades, expired, summary: {
    entered:n,
    target1Pct:round(t1/n*100,1),
    stopPct:round(stop/n*100,1),
    positivePct:round(wins.length/n*100,1),
    avgNetPct:round(avg(trades.map(x=>x.netPct)),2),
    expectancyPct:round(avg(trades.map(x=>x.netPct)),2),
    profitFactor:gl?round(gp/gl,2):gp>0?'INF':null,
    wilson95LowerTarget1Pct:round(lower*100,1),
    maxTradeDrawdownPct:round(maxDd,2),
  }};
}

export function backtestPlanVariant({ ticker, rows, variant = 'BASELINE_CURRENT', minBars = POLICY.minBars, step = 1 }) {
  const bars = normalizeBars(rows).bars, trades = [], expired = [];
  let i = minBars - 1;
  while (i < bars.length - 1) {
    const base = analyzeTickerBase({ ticker, rows: bars.slice(0, i + 1), historyMeta: { warnings: [] }, expectedSessionDate: null, includeOverlay: false });
    if (!base.tradePlan) { i += step; continue; }
    const plan = buildPlanVariant(base, variant);
    const assessment = assessWithPlan(base, plan);
    if (!assessment.eligible || !plan) { i += step; continue; }

    let entry = null;
    const end = Math.min(bars.length - 1, i + POLICY.entryExpirySessions);
    for (let j = i + 1; j <= end; j++) {
      const price = fill(bars[j], plan);
      if (price != null) { entry = { j, price }; break; }
    }
    if (!entry) { expired.push({ ticker, signalDate: bars[i].date, variant }); i = end + 1; continue; }

    const maxExit = Math.min(bars.length - 1, entry.j + POLICY.maxHoldSessions - 1);
    let exit = null;
    for (let j = entry.j; j <= maxExit; j++) {
      const b = bars[j], stopHit = b.low <= plan.stop, t1Hit = b.high >= plan.target1;
      if (stopHit && t1Hit) { exit = { j, price: plan.stop, outcome: 'STOP_SAME_BAR' }; break; }
      if (stopHit) { exit = { j, price: plan.stop, outcome: 'STOP' }; break; }
      if (t1Hit) { exit = { j, price: plan.target1, outcome: 'TARGET1' }; break; }
    }
    if (!exit) exit = { j: maxExit, price: bars[maxExit].close, outcome: 'TIME_EXIT' };

    trades.push({
      ticker,
      variant,
      signalDate: bars[i].date,
      entryDate: bars[entry.j].date,
      exitDate: bars[exit.j].date,
      outcome: exit.outcome,
      netPct: round((exit.price - entry.price) / entry.price * 100 - POLICY.roundTripCostPct, 2),
      researchScore: assessment.researchScore,
      technicalScore: base.scores.technical,
      structuralNetRR: plan.structuralNetRR,
      target1: plan.target1,
      target2: plan.target2,
      firstObstacle: plan.firstObstacle ?? null,
      targetCluster: plan.targetCluster ?? null,
    });
    i = exit.j + 1;
  }
  return summarize(trades, expired);
}

export function assessPlanVariant(base, variant) {
  const plan = buildPlanVariant(base, variant);
  return { plan, ...assessWithPlan(base, plan) };
}

export const PLAN_LAB_GOVERNANCE = Object.freeze({
  researchOnly: true,
  variants: ['BASELINE_CURRENT', 'RESISTANCE_LADDER_V1'],
  ladderRuleChosenBeforeBacktest: true,
  ladderRuleConditionedOnRrThreshold: false,
  syntheticResistanceEligibleForTarget: false,
  productionPromotionAllowed: false,
});
