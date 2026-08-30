import { createHash } from 'node:crypto';

const ROLE_ORDER = Object.freeze(['PRIMARY_1', 'PRIMARY_2', 'CONDITIONAL', 'RESERVE_1', 'RESERVE_2']);

export const V17_PARALLEL_VALIDATION = Object.freeze({
  schemaVersion: 'egx.v17-parallel-sequential-validation.1',
  researchOnly: true,
  productionAuthority: false,
  automaticOrders: false,
  automaticPromotion: false,
  scoringImpact: 'NONE',
  alphaWeight: 0,
  roundTripCostPct: 0.6,
  maxHoldSessions: 3,
  sameBarRule: 'STOP_FIRST',
  nextSessionOnly: true,
  noSameCohortSlotReuse: true,
  roleOrder: ROLE_ORDER,
  arms: Object.freeze({
    V16_CONTROL: Object.freeze({
      id: 'V16_CONTROL',
      label: 'V16.9 Champion Control',
      maxPositions: 2,
      categories: Object.freeze(['PRIMARY_1', 'PRIMARY_2']),
      gapDownPolicy: 'ALLOW_SAME_SESSION_RECOVERY_ENTRY',
      substitution: false,
    }),
    V17_A: Object.freeze({
      id: 'V17_A',
      label: 'V17 Current Governor',
      maxPositions: 2,
      categories: Object.freeze(ROLE_ORDER),
      gapDownPolicy: 'VETO_GAP_DOWN',
      substitution: true,
    }),
    V17_B: Object.freeze({
      id: 'V17_B',
      label: 'V17 Primary Only',
      maxPositions: 2,
      categories: Object.freeze(['PRIMARY_1', 'PRIMARY_2']),
      gapDownPolicy: 'VETO_GAP_DOWN',
      substitution: false,
    }),
    V17_C: Object.freeze({
      id: 'V17_C',
      label: 'V17 Single Best Eligible',
      maxPositions: 1,
      categories: Object.freeze(ROLE_ORDER),
      gapDownPolicy: 'VETO_GAP_DOWN',
      substitution: true,
    }),
  }),
  sequential: Object.freeze({
    priorAlpha: 1,
    priorBeta: 1,
    minEarlyCohorts: 8,
    minEarlyDecisivePairs: 5,
    earlyPositiveProbability: 0.975,
    earlyFutilityProbability: 0.10,
    formalMinCohorts: 20,
    formalMinDecisivePairs: 10,
    formalSuperiorityProbability: 0.99,
    hardMaxCohorts: 40,
  }),
});

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

function finite(v) {
  return Number.isFinite(Number(v));
}

function roleIndex(category) {
  const idx = ROLE_ORDER.indexOf(String(category || ''));
  return idx < 0 ? 999 : idx;
}

function normalizeSignal(signal = {}, signalDate = null) {
  const ticker = String(signal.ticker || '').trim().toUpperCase();
  const entryLow = Number(signal.entryLow);
  const entryHigh = Number(signal.entryHigh);
  const stopLoss = Number(signal.stopLoss ?? signal.stop);
  const target1 = Number(signal.target1);
  if (!ticker || !(entryLow > 0) || !(entryHigh >= entryLow) || !(stopLoss > 0) || !(target1 > entryHigh)) {
    throw new Error('PARALLEL_INVALID_SIGNAL_GEOMETRY');
  }
  return Object.freeze({
    ticker,
    rank: finite(signal.rank) ? Number(signal.rank) : 999,
    category: signal.category ?? null,
    score: finite(signal.score) ? Number(signal.score) : null,
    signalDate,
    entryLow,
    entryHigh,
    stopLoss,
    target1,
    currentSessionEligible: signal.currentSessionEligible !== false,
    referenceOnly: signal.referenceOnly === true,
  });
}

function validateSnapshot(snapshot = {}) {
  if (snapshot.status !== 'FROZEN_PRE_OUTCOME_FORWARD_EVIDENCE') throw new Error('PARALLEL_SNAPSHOT_NOT_FROZEN');
  if (snapshot.immutable !== true || snapshot.researchOnly !== true) throw new Error('PARALLEL_SNAPSHOT_AUTHORITY_INVALID');
  if (snapshot.capturedBeforeNextSessionOpen !== true) throw new Error('PARALLEL_PREOPEN_BOUNDARY_INVALID');
  if (!snapshot.snapshotHash) throw new Error('PARALLEL_SNAPSHOT_HASH_REQUIRED');
  if (!Array.isArray(snapshot.v16Signals) || !snapshot.v16Signals.length) throw new Error('PARALLEL_SIGNALS_REQUIRED');
}

export function freezeV17ParallelCohort(snapshot = {}) {
  validateSnapshot(snapshot);
  const orderedSignals = snapshot.v16Signals
    .map((s) => normalizeSignal(s, snapshot.signalSessionDate))
    .filter((s) => s.currentSessionEligible && !s.referenceOnly)
    .sort((a, b) => roleIndex(a.category) - roleIndex(b.category) || a.rank - b.rank || a.ticker.localeCompare(b.ticker));

  const arms = Object.fromEntries(Object.entries(V17_PARALLEL_VALIDATION.arms).map(([id, policy]) => {
    const candidates = orderedSignals.filter((s) => policy.categories.includes(s.category));
    return [id, Object.freeze({
      policy,
      candidateTickers: Object.freeze(candidates.map((s) => s.ticker)),
    })];
  }));

  const payload = {
    schemaVersion: 'egx.v17-parallel-cohort.1',
    status: 'FROZEN_PRE_OUTCOME_PARALLEL_COHORT',
    researchOnly: true,
    productionAuthority: false,
    signalSessionDate: snapshot.signalSessionDate,
    nextTradingSessionDate: snapshot?.marketCalendar?.nextTradingSessionDate ?? null,
    nextSessionOpenAt: snapshot.nextSessionOpenAt ?? snapshot?.marketCalendar?.nextSessionOpenAt ?? null,
    sourceSnapshotHash: snapshot.snapshotHash,
    sourceBundleHash: snapshot.sourceBundleHash ?? null,
    contractHash: sha256(V17_PARALLEL_VALIDATION),
    signals: orderedSignals,
    arms,
    sequential: V17_PARALLEL_VALIDATION.sequential,
  };
  const cohortHash = sha256(payload);
  return Object.freeze({ ...payload, cohortHash });
}

function normalizeBar(bar = {}) {
  const sessionDate = String(bar.sessionDate || bar.date || '').slice(0, 10);
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close ?? bar.last);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new Error('PARALLEL_BAR_DATE_INVALID');
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) throw new Error('PARALLEL_BAR_PRICE_INVALID');
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new Error('PARALLEL_BAR_INCONSISTENT');
  return Object.freeze({ sessionDate, open, high, low, close });
}

function memberNetReturn(entry, exit, costPct) {
  return ((exit / entry) - 1) * 100 - costPct;
}

function entryFill(signal, firstBar, policy) {
  if (firstBar.open < signal.entryLow) {
    if (policy.gapDownPolicy === 'VETO_GAP_DOWN') return Object.freeze({ status: 'VETOED', entryPrice: null, reason: 'NEXT_OPEN_BELOW_ENTRY_LOW' });
    if (firstBar.high >= signal.entryLow) return Object.freeze({ status: 'ENTERED', entryPrice: signal.entryLow, reason: 'SAME_SESSION_GAP_RECOVERY_TO_ENTRY_LOW' });
    return Object.freeze({ status: 'NO_ENTRY', entryPrice: null, reason: 'ENTRY_ZONE_NOT_REACHED_NEXT_SESSION' });
  }
  if (firstBar.open >= signal.entryLow && firstBar.open <= signal.entryHigh) {
    return Object.freeze({ status: 'ENTERED', entryPrice: firstBar.open, reason: 'OPEN_INSIDE_ENTRY_ZONE' });
  }
  if (firstBar.open > signal.entryHigh) {
    if (firstBar.low <= signal.entryHigh) return Object.freeze({ status: 'ENTERED', entryPrice: signal.entryHigh, reason: 'RETRACE_TO_ENTRY_HIGH' });
    return Object.freeze({ status: 'NO_ENTRY', entryPrice: null, reason: 'NO_CHASE_NO_RETRACE' });
  }
  if (firstBar.low <= signal.entryHigh && firstBar.high >= signal.entryLow) {
    return Object.freeze({ status: 'ENTERED', entryPrice: signal.entryHigh, reason: 'ENTRY_ZONE_TOUCHED' });
  }
  return Object.freeze({ status: 'NO_ENTRY', entryPrice: null, reason: 'ENTRY_ZONE_NOT_TOUCHED_NEXT_SESSION' });
}

export function evaluateParallelMember({ signal, bars, policy } = {}) {
  const normalized = normalizeSignal(signal, signal?.signalDate ?? null);
  const orderedBars = (bars || []).map(normalizeBar).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  if (!orderedBars.length) return Object.freeze({ ticker: normalized.ticker, complete: false, status: 'WAIT_DATA', entered: false });
  const firstBar = orderedBars[0];
  const fill = entryFill(normalized, firstBar, policy);
  if (fill.status === 'VETOED') return Object.freeze({ ticker: normalized.ticker, complete: true, status: 'VETOED', entered: false, reason: fill.reason, netReturnPct: 0 });
  if (fill.status === 'NO_ENTRY') return Object.freeze({ ticker: normalized.ticker, complete: true, status: 'NO_ENTRY', entered: false, reason: fill.reason, netReturnPct: 0 });

  const entry = Number(fill.entryPrice);
  const considered = orderedBars.slice(0, V17_PARALLEL_VALIDATION.maxHoldSessions);
  for (let i = 0; i < considered.length; i += 1) {
    const bar = considered[i];
    const stopHit = bar.low <= normalized.stopLoss;
    const targetHit = bar.high >= normalized.target1;
    if (stopHit || targetHit) {
      const useStop = stopHit;
      const status = useStop ? 'STOP' : 'TARGET';
      const exit = useStop ? normalized.stopLoss : normalized.target1;
      return Object.freeze({
        ticker: normalized.ticker,
        complete: true,
        entered: true,
        status,
        entryPrice: entry,
        exitPrice: exit,
        entryDate: firstBar.sessionDate,
        exitDate: bar.sessionDate,
        sessionsObserved: i + 1,
        stopFirstApplied: stopHit && targetHit,
        netReturnPct: memberNetReturn(entry, exit, V17_PARALLEL_VALIDATION.roundTripCostPct),
      });
    }
  }

  if (considered.length >= V17_PARALLEL_VALIDATION.maxHoldSessions) {
    const finalBar = considered[V17_PARALLEL_VALIDATION.maxHoldSessions - 1];
    return Object.freeze({
      ticker: normalized.ticker,
      complete: true,
      entered: true,
      status: 'TIME_EXIT',
      entryPrice: entry,
      exitPrice: finalBar.close,
      entryDate: firstBar.sessionDate,
      exitDate: finalBar.sessionDate,
      sessionsObserved: V17_PARALLEL_VALIDATION.maxHoldSessions,
      netReturnPct: memberNetReturn(entry, finalBar.close, V17_PARALLEL_VALIDATION.roundTripCostPct),
    });
  }

  return Object.freeze({
    ticker: normalized.ticker,
    complete: false,
    entered: true,
    status: 'OPEN',
    entryPrice: entry,
    entryDate: firstBar.sessionDate,
    sessionsObserved: considered.length,
    netReturnPct: null,
  });
}

export function evaluateParallelArm({ cohort, armId, barsByTicker } = {}) {
  if (!cohort || cohort.schemaVersion !== 'egx.v17-parallel-cohort.1') throw new Error('PARALLEL_COHORT_INVALID');
  const arm = cohort.arms?.[armId];
  if (!arm) throw new Error(`PARALLEL_ARM_UNKNOWN:${armId}`);
  const policy = arm.policy;
  const byTicker = new Map(cohort.signals.map((s) => [s.ticker, s]));
  const members = [];
  let usedSlots = 0;

  for (const ticker of arm.candidateTickers) {
    const signal = byTicker.get(ticker);
    if (usedSlots >= policy.maxPositions) {
      members.push(Object.freeze({ ticker, complete: true, status: 'NOT_SELECTED_CAP', entered: false, netReturnPct: 0 }));
      continue;
    }
    const result = evaluateParallelMember({ signal, bars: barsByTicker?.[ticker] || [], policy });
    members.push(result);
    if (result.entered) usedSlots += 1;
  }

  const activeMembers = members.filter((m) => m.entered);
  const complete = members.every((m) => m.complete !== false);
  const portfolioNetReturnPct = complete
    ? activeMembers.reduce((sum, m) => sum + Number(m.netReturnPct || 0), 0) / policy.maxPositions
    : null;

  return Object.freeze({
    armId,
    complete,
    maxPositions: policy.maxPositions,
    slotsUsed: usedSlots,
    entered: activeMembers.length,
    stops: members.filter((m) => m.status === 'STOP').length,
    targets: members.filter((m) => m.status === 'TARGET').length,
    timeExits: members.filter((m) => m.status === 'TIME_EXIT').length,
    vetoes: members.filter((m) => m.status === 'VETOED').length,
    noEntries: members.filter((m) => m.status === 'NO_ENTRY').length,
    portfolioNetReturnPct,
    members: Object.freeze(members),
    researchOnly: true,
    productionAuthority: false,
  });
}

export function evaluateParallelCohort({ cohort, barsByTicker } = {}) {
  const arms = Object.fromEntries(Object.keys(V17_PARALLEL_VALIDATION.arms).map((id) => [id, evaluateParallelArm({ cohort, armId: id, barsByTicker })]));
  return Object.freeze({
    schemaVersion: 'egx.v17-parallel-cohort-result.1',
    cohortHash: cohort.cohortHash,
    signalSessionDate: cohort.signalSessionDate,
    nextTradingSessionDate: cohort.nextTradingSessionDate,
    arms: Object.freeze(arms),
    researchOnly: true,
    productionAuthority: false,
  });
}

function combination(n, k) {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let out = 1;
  for (let i = 1; i <= kk; i += 1) out = out * (n - kk + i) / i;
  return out;
}

export function betaPosteriorProbabilityAboveHalf(wins, losses) {
  if (!Number.isInteger(wins) || !Number.isInteger(losses) || wins < 0 || losses < 0) throw new Error('PARALLEL_BETA_COUNTS_INVALID');
  const a = V17_PARALLEL_VALIDATION.sequential.priorAlpha + wins;
  const b = V17_PARALLEL_VALIDATION.sequential.priorBeta + losses;
  const n = a + b - 1;
  let probability = 0;
  for (let k = 0; k <= a - 1; k += 1) probability += combination(n, k) * (0.5 ** n);
  return probability;
}

function compoundReturn(returns) {
  const wealth = returns.reduce((w, r) => w * (1 + Number(r) / 100), 1);
  return (wealth - 1) * 100;
}

function maxDrawdown(returns) {
  let wealth = 1;
  let peak = 1;
  let worst = 0;
  for (const r of returns) {
    wealth *= 1 + Number(r) / 100;
    peak = Math.max(peak, wealth);
    const dd = (wealth / peak - 1) * 100;
    worst = Math.min(worst, dd);
  }
  return worst;
}

function armAggregate(results, armId) {
  const completed = results.filter((r) => r?.arms?.[armId]?.complete && finite(r.arms[armId].portfolioNetReturnPct));
  const returns = completed.map((r) => Number(r.arms[armId].portfolioNetReturnPct));
  const entered = completed.reduce((s, r) => s + Number(r.arms[armId].entered || 0), 0);
  const stops = completed.reduce((s, r) => s + Number(r.arms[armId].stops || 0), 0);
  const targets = completed.reduce((s, r) => s + Number(r.arms[armId].targets || 0), 0);
  return Object.freeze({
    completedCohorts: completed.length,
    averageReturnPct: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null,
    compoundedReturnPct: returns.length ? compoundReturn(returns) : null,
    maxDrawdownPct: returns.length ? maxDrawdown(returns) : null,
    entered,
    stops,
    targets,
    stopRatePct: entered ? stops / entered * 100 : 0,
    targetRatePct: entered ? targets / entered * 100 : 0,
  });
}

function sequentialStatus({ n, decisive, probability, avgDelta, armStats, controlStats }) {
  const s = V17_PARALLEL_VALIDATION.sequential;
  const safetyNonWorse = armStats.stopRatePct <= controlStats.stopRatePct && armStats.maxDrawdownPct >= controlStats.maxDrawdownPct;
  const formalPass = n >= s.formalMinCohorts
    && decisive >= s.formalMinDecisivePairs
    && probability >= s.formalSuperiorityProbability
    && avgDelta > 0
    && safetyNonWorse
    && armStats.compoundedReturnPct > controlStats.compoundedReturnPct;

  if (formalPass) return 'FORMAL_RESEARCH_CHALLENGER_PASS';
  if (n >= s.hardMaxCohorts) return 'NO_MATERIAL_EDGE_UNDER_FROZEN_CONTRACT';
  if (n < s.minEarlyCohorts || decisive < s.minEarlyDecisivePairs) return 'INSUFFICIENT_EVIDENCE';
  if (probability <= s.earlyFutilityProbability && avgDelta <= 0) return 'EARLY_FUTILITY';
  if (probability >= s.earlyPositiveProbability && avgDelta > 0 && armStats.stopRatePct <= controlStats.stopRatePct) return 'EARLY_POSITIVE_RESEARCH_EVIDENCE';
  return 'CONTINUE_FROZEN_TEST';
}

export function evaluateV17SequentialEvidence(results = []) {
  const valid = (results || []).filter((r) => r?.schemaVersion === 'egx.v17-parallel-cohort-result.1');
  const controlStats = armAggregate(valid, 'V16_CONTROL');
  const challengers = {};

  for (const armId of ['V17_A', 'V17_B', 'V17_C']) {
    const paired = valid.filter((r) => r.arms?.V16_CONTROL?.complete && r.arms?.[armId]?.complete
      && finite(r.arms.V16_CONTROL.portfolioNetReturnPct) && finite(r.arms[armId].portfolioNetReturnPct));
    const deltas = paired.map((r) => Number(r.arms[armId].portfolioNetReturnPct) - Number(r.arms.V16_CONTROL.portfolioNetReturnPct));
    const wins = deltas.filter((d) => d > 0).length;
    const losses = deltas.filter((d) => d < 0).length;
    const ties = deltas.length - wins - losses;
    const probability = betaPosteriorProbabilityAboveHalf(wins, losses);
    const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const armStats = armAggregate(paired, armId);
    const pairedControlStats = armAggregate(paired, 'V16_CONTROL');
    const status = sequentialStatus({
      n: paired.length,
      decisive: wins + losses,
      probability,
      avgDelta,
      armStats,
      controlStats: pairedControlStats,
    });
    challengers[armId] = Object.freeze({
      status,
      completedPairedCohorts: paired.length,
      decisivePairs: wins + losses,
      pairedWins: wins,
      pairedLosses: losses,
      pairedTies: ties,
      posteriorProbabilityBetterThanControl: probability,
      meanPairedDeltaPct: avgDelta,
      arm: armStats,
      control: pairedControlStats,
      researchOnly: true,
      productionAuthority: false,
    });
  }

  return Object.freeze({
    schemaVersion: 'egx.v17-parallel-sequential-evidence.1',
    control: controlStats,
    challengers: Object.freeze(challengers),
    hardMaxCohorts: V17_PARALLEL_VALIDATION.sequential.hardMaxCohorts,
    researchOnly: true,
    productionAuthority: false,
    automaticPromotion: false,
  });
}
