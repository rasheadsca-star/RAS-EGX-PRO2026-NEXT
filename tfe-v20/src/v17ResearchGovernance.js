export const V17_RESEARCH_GOVERNANCE = Object.freeze({
  schemaVersion: 'egx.v17-research-governance.1',
  researchOnly: true,
  productionAuthority: false,
  automaticOrders: false,
  automaticPromotion: false,
  scoringImpact: 'NONE',
  alphaWeight: 0,
  championCore: 'V16_SELECTION_CORE',
  maxConcurrentObservedPositions: 2,
  priorityOrder: Object.freeze(['PRIMARY_1', 'PRIMARY_2', 'CONDITIONAL', 'RESERVE_1', 'RESERVE_2']),
  criticalSources: Object.freeze(['v16', 'regime', 'triple']),
  optionalSources: Object.freeze(['v20', 'metaShadow']),
  frozenEntryRule: 'NEXT_SESSION_ONLY',
  frozenFillRule: 'ENTRY_ZONE_TOUCH_NO_GAP_DOWN_FILL',
  frozenSameBarRule: 'STOP_FIRST',
  frozenMaxHoldSessions: 3,
  frozenRoundTripCostPct: 0.6,
  noSameObservationSlotReuse: true,
  outcomeRetuningAllowed: false,
});

export function assessV17ResearchReadiness(snapshot = {}) {
  const blockers = [];
  const warnings = [];
  const signalDate = String(snapshot.signalSessionDate || '');
  const sources = snapshot.sources || {};
  const policy = snapshot.policy || {};

  if (snapshot.status !== 'FROZEN_PRE_OUTCOME_FORWARD_EVIDENCE') blockers.push('SNAPSHOT_NOT_FROZEN');
  if (snapshot.immutable !== true) blockers.push('SNAPSHOT_NOT_IMMUTABLE');
  if (snapshot.researchOnly !== true) blockers.push('SNAPSHOT_NOT_RESEARCH_ONLY');
  if (snapshot.capturedBeforeNextSessionOpen !== true) blockers.push('PREOPEN_BOUNDARY_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) blockers.push('SIGNAL_DATE_INVALID');

  if (policy.entryRule !== V17_RESEARCH_GOVERNANCE.frozenEntryRule) blockers.push('ENTRY_RULE_DRIFT');
  if (policy.entryFillRule !== V17_RESEARCH_GOVERNANCE.frozenFillRule) blockers.push('FILL_RULE_DRIFT');
  if (policy.sameBarTargetStop !== V17_RESEARCH_GOVERNANCE.frozenSameBarRule) blockers.push('SAME_BAR_RULE_DRIFT');
  if (Number(policy.maxHoldSessions) !== V17_RESEARCH_GOVERNANCE.frozenMaxHoldSessions) blockers.push('HOLD_RULE_DRIFT');
  if (Number(policy.roundTripCostPct) !== V17_RESEARCH_GOVERNANCE.frozenRoundTripCostPct) blockers.push('COST_RULE_DRIFT');
  if (policy.productionAuthority !== false) blockers.push('PRODUCTION_AUTHORITY_INVALID');

  for (const id of V17_RESEARCH_GOVERNANCE.criticalSources) {
    if (!sources[id]) blockers.push(`CRITICAL_SOURCE_MISSING:${id}`);
    else if (String(sources[id].sessionDate || '') !== signalDate) blockers.push(`CRITICAL_SOURCE_STALE:${id}`);
  }
  for (const id of V17_RESEARCH_GOVERNANCE.optionalSources) {
    if (!sources[id]) warnings.push(`OPTIONAL_SOURCE_MISSING:${id}`);
    else if (String(sources[id].sessionDate || '') !== signalDate) warnings.push(`OPTIONAL_SOURCE_STALE:${id}`);
  }

  if (!Array.isArray(snapshot.v16Signals) || snapshot.v16Signals.length === 0) blockers.push('NO_FROZEN_SIGNALS');

  return Object.freeze({
    ready: blockers.length === 0,
    status: blockers.length ? 'BLOCKED' : 'READY_FOR_RESEARCH_OBSERVATION',
    evidenceQuality: blockers.length ? 'INVALID' : warnings.length ? 'DEGRADED_OPTIONAL_INPUTS' : 'CLEAN',
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    productionAuthority: false,
  });
}
