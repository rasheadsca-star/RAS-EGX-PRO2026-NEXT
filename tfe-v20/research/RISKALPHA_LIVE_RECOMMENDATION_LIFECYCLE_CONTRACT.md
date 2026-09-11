# RiskAlpha Live Recommendation Lifecycle — Frozen Research Contract

Status: RESEARCH / SHADOW ONLY

## Objective
Add automated, periodic recommendation management above frozen V16.9 recommendations without rewriting the original signal, entry zone, stop, target, score, or signal date.

## Immutable original recommendation
The original V16.9 recommendation is evidence. It is never overwritten after publication. Every later action is a timestamped lifecycle event.

## Allowed lifecycle states
- WAIT
- ALLOW / WAIT_ENTRY
- VETOED
- ENTERED / HOLD
- PROTECT_PROFIT
- TARGET
- STOP
- EXIT_PROTECT
- NO_ENTRY / EXPIRED
- TIME_EXIT

## Frozen entry rule
Use the existing Fresh Forward rule exactly:
- NEXT_SESSION_ONLY
- ENTRY_ZONE_TOUCH_NO_GAP_DOWN_FILL
- If the next session opens below frozen `entryLow`, veto delayed recovery entry.
- If the next session opens validly but never touches the frozen entry zone, there is no entry.

## Frozen exit / management rules
- Original stop and target remain unchanged as benchmark geometry.
- Same-observation stop and target => STOP_FIRST.
- Maximum hold = 3 observed sessions.
- Time exit = third observed session close.
- Research protection overlay: after entry, reaching +1.0R arms break-even protection.
- The break-even protection is active only from the NEXT observation, never retroactively within the observation that first reached +1.0R.
- No outcome-based retuning is allowed.

## Authority locks
- researchOnly = true
- scoringImpact = NONE
- alphaWeight = 0
- productionAuthority = false
- No automatic promotion.
- V16.9 remains Champion unless separate forward evidence proves otherwise.

## Destructive critic rules
Reject any implementation that:
1. changes original recommendation values after an outcome is known;
2. accepts non-monotonic observations or rewrites history;
3. uses a future observation to improve an earlier decision;
4. activates break-even protection retroactively inside the same OHLC observation;
5. allows a delayed recovery fill after a next-open gap below entryLow;
6. changes thresholds after forward outcomes are seen;
7. grants production authority or positive alpha weight from retrospective evidence.

## Monitoring intent
A periodic monitor may append a new lifecycle event only when a newer market observation exists. Repeated identical observations must not alter historical evidence. The UI should always display both:
- Original Recommendation (frozen)
- Live Management Decision (current timestamped state)

This contract does not authorize modification of `main`, merging PR #68, or production deployment.
