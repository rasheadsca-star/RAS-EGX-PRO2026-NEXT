# V20 Phase 3.1 — Trade Plan Current-Price Alignment Guard

## Why this guard exists

The V20 risk/reward audit found material discrepancies between legacy R/R values and conservative cost-aware R/R, and it also found current prices outside some recorded entry ranges. The cause of such differences is not assumed. V20 does not label them as a split, stale price, or corporate action without verified source evidence.

## Current-price alignment states

Every current long trade plan is classified as one of:

- `IN_ENTRY_RANGE`: current price is inside the recorded entry range and the long-plan price relationship is valid.
- `BELOW_ENTRY_RANGE_WAITING`: valid plan, but price is below the entry range; wait for the zone.
- `ABOVE_ENTRY_RANGE_DO_NOT_CHASE`: valid plan, but price is above the entry range; do not chase.
- `REBUILD_REQUIRED`: the distance between current price and entry midpoint exceeds the defensive operational hard-review threshold; rebuild/verify the plan before it can become actionable.
- `INVALID_RELATION`: the long relationship `stop < entryLow <= entryHigh < target1` is not valid or required price fields are unavailable.

## Defensive thresholds

The registry uses:

- 5% distance as a warning threshold.
- 20% distance as a hard-review threshold.

Distance is calculated as `ABS(entryMidpoint-currentPrice)/currentPrice*100`.

These thresholds are operational sanity guards, not calibrated alpha thresholds and not a claim about expected performance.

## Execution invariant

A row can only be `ACTIONABLE` when all pre-existing global/data/liquidity/support-resistance requirements pass **and** the trade-plan alignment is eligible with state `IN_ENTRY_RANGE`.

Rows outside the entry range are forced to `WAIT` unless they are already `AVOID`. Rebuild-required and invalid plans also remain `WAIT`/`AVOID` with zero execution confidence and zero applied portfolio weight.

V17 remains the authoritative final global execution gate. This V20 guard can only make a decision more conservative; it cannot open execution.
