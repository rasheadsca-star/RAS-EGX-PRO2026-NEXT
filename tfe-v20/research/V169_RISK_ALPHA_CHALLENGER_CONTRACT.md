# V16.9-RiskAlpha Challenger Contract

## Status
Research-only challenger. V16.9 remains Champion. No production authority, no score/ranking mutation, no merge to main, and no automatic promotion.

## Objective
Reduce a specifically observed V16.9 downside execution mechanism while preserving or improving profitability. The first locked mechanism is the Gap-Down Recovery Trap: the next session opens below the frozen V16.9 entry-low boundary.

## Frozen v0.1 intervention
- Keep the exact V16.9 ranking and selected basket.
- Keep the exact frozen entry zone, stop and target geometry.
- Do not replace a vetoed member with the next-ranked stock.
- Veto only when `nextOpen < frozenEntryLow`.
- Equal-weight the members that remain after the veto.
- If all members are vetoed, the challenger is NO_TRADE with 0% session return and no transaction cost.
- Apply the same 0.60% round-trip cost to a traded challenger session.
- The signal-time downside-fragility predictor remains Shadow/zero-weight and is not required for the structural v0.1 guard.

## One-shot retrospective acceptance gate
Thresholds are frozen before reading the v0.1 result and must not be retuned on this evidence window.

Required simultaneously:
- at least 30 aligned sessions;
- at least 5 vetoed members;
- Average Net Return improvement >= 0.15 percentage points;
- Profit Factor improvement >= 0.15;
- Maximum Drawdown improvement >= 1.0 percentage point;
- executable Stop Rate reduction >= 5 percentage points;
- conservative Target Rate degradation no worse than 5 percentage points.

A retrospective pass means only `PROMISING_RETROSPECTIVE_ZERO_WEIGHT_ONLY`. It is not promotion evidence.

## Forward acceptance
RiskAlpha must be evaluated prospectively from frozen pre-outcome V16.9 signals under the same entry, cost, stop/target ordering and holding rules used by the Fresh Forward evidence contract. Forward results must report at least Net/Average Basket Return, Profit Factor, Max Drawdown, Stop Rate, Target Rate, sample size and the economic value of vetoes versus missed winners.

No promotion is allowed from a small sample. V16.9 remains Champion until stable forward superiority is demonstrated across a sufficient sample and more than one market condition.

## Governance
`scoringImpact=NONE`, `alphaWeight=0`, `productionAuthority=false`, `promotionEligible=false`, `retuningAllowedAfterAudit=false`.
