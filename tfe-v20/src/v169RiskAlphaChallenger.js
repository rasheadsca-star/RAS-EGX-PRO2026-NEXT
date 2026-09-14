import { assessNextOpenRecoveryTrap } from './downsideFragilityExpert.js';

export const V169_RISK_ALPHA_POLICY = Object.freeze({
  schemaVersion: 'egx.v169-riskalpha-challenger.1',
  challenger: 'V16.9-RiskAlpha',
  baseChampion: 'V16.9',
  purpose: 'Reduce a specifically observed V16.9 downside execution mechanism without changing ranking, score, entry geometry, stops or targets.',
  rankingMutation: false,
  scoreMutation: false,
  entryZoneMutation: false,
  stopMutation: false,
  targetMutation: false,
  entryGuard: 'VETO_IF_NEXT_OPEN_BELOW_FROZEN_ENTRY_LOW',
  vetoReplacement: 'NONE',
  remainingBasketPolicy: 'EQUAL_WEIGHT_RENORMALIZE_REMAINING_MEMBERS',
  noTradeReturnPct: 0,
  roundTripCostPct: 0.60,
  signalTimeFragilityExpert: 'SHADOW_ONLY_ZERO_WEIGHT',
  scoringImpact: 'NONE',
  alphaWeight: 0,
  productionAuthority: false,
  promotionEligible: false,
  retuningAllowedAfterAudit: false,
  freshForwardLedgerChanged: false,
});

function finite(v) {
  return Number.isFinite(Number(v));
}

function mean(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function round(v, d = 4) {
  return Number.isFinite(v) ? Number(v.toFixed(d)) : null;
}

export function classifyRiskAlphaMember(member = {}) {
  const decision = assessNextOpenRecoveryTrap({
    frozenEntryLow: member.entryLow,
    nextOpen: member.nextOpen,
  });
  return Object.freeze({
    ticker: String(member.ticker || '').toUpperCase(),
    decision: decision.decision,
    reason: decision.reason,
    veto: decision.decision === 'VETO_GAP_DOWN_RECOVERY_ENTRY',
    gapBelowEntryLowPct: decision.gapBelowEntryLowPct ?? null,
    scoringImpact: 'NONE',
    alphaWeight: 0,
    productionAuthority: false,
  });
}

export function evaluateRiskAlphaSession(session = {}) {
  const members = Array.isArray(session.members) ? session.members : [];
  const classified = members.map((member) => ({
    member,
    guard: classifyRiskAlphaMember(member),
  }));
  const kept = classified.filter((x) => !x.guard.veto);
  const vetoed = classified.filter((x) => x.guard.veto);
  const keptReturns = kept
    .map((x) => Number(x.member.nextCloseReturnPct))
    .filter(Number.isFinite);

  const noTrade = kept.length === 0 || keptReturns.length === 0;
  const challengerNetReturnPct = noTrade
    ? V169_RISK_ALPHA_POLICY.noTradeReturnPct
    : mean(keptReturns) - V169_RISK_ALPHA_POLICY.roundTripCostPct;

  return Object.freeze({
    signalDate: String(session.signalDate || ''),
    outcomeDate: String(session.outcomeDate || ''),
    originalBasketSize: members.length,
    keptCount: kept.length,
    vetoedCount: vetoed.length,
    vetoedTickers: vetoed.map((x) => x.guard.ticker),
    noTrade,
    baselineNetReturnPct: finite(session.netReturnPct) ? Number(session.netReturnPct) : null,
    challengerNetReturnPct: round(challengerNetReturnPct, 4),
    guardDecisions: classified.map((x) => x.guard),
  });
}

export function aggregateRiskAlphaReturns(values = []) {
  const xs = values.map(Number).filter(Number.isFinite);
  let gains = 0;
  let losses = 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  for (const value of xs) {
    gains += Math.max(0, value);
    losses += Math.abs(Math.min(0, value));
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;
  return Object.freeze({
    sessions: xs.length,
    averageNetReturnPct: round(mean(xs), 4),
    medianNetReturnPct: round(median, 4),
    winningSessionPct: round(xs.length ? xs.filter((v) => v > 0).length / xs.length * 100 : 0, 3),
    profitFactor: round(losses > 0 ? gains / losses : null, 3),
    compoundedNetReturnPct: round((equity - 1) * 100, 3),
    maximumDrawdownPct: round(maxDrawdownPct, 3),
    bestSessionPct: round(xs.length ? Math.max(...xs) : 0, 3),
    worstSessionPct: round(xs.length ? Math.min(...xs) : 0, 3),
  });
}

export function summarizeOutcomeMembers(sessions = [], keepPredicate = () => true) {
  const members = sessions.flatMap((s) => Array.isArray(s.members) ? s.members : []).filter(keepPredicate);
  const executable = members.filter((m) => Boolean(m.executableByOpenRule));
  const stops = executable.filter((m) => Boolean(m.stopTouched)).length;
  const conservativeTargets = executable.filter((m) => Boolean(m.conservativeTargetHit)).length;
  return Object.freeze({
    members: members.length,
    executable: executable.length,
    stops,
    conservativeTargets,
    stopRatePct: round(executable.length ? stops / executable.length * 100 : 0, 2),
    conservativeTargetRatePct: round(executable.length ? conservativeTargets / executable.length * 100 : 0, 2),
  });
}
