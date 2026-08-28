# Consensus Trigger Distance Forward V1 — Preregistration

Date: 2026-08-28

## Status

**Forward-shadow research only. Not production eligible from the existing 60-session sample.**

This hypothesis is frozen after the completed Regime Confidence V1 counterfactual. The completed 2026-06-01 through 2026-08-24 sample may not be reused to tune or accept this rule.

## Locked upstream pipeline

The upstream V16 Quality Gate V2 consensus pipeline remains unchanged:

1. V16 Quality Gate V2 qualification/ranking unchanged.
2. SEPA-X qualified proxy unchanged.
3. Exact V16 ∩ SEPA intersection unchanged.
4. GANN timing grade, score and native entry/trigger/stop/target levels unchanged.
5. Existing Regime Gate action and sizing unchanged.
6. No fixed Top-N, no V16/SEPA rank cutoff, and no blended selection score.
7. No candidate can be added by this overlay.

## Frozen forward-only rule

Apply only after the existing Regime Gate:

- If the existing action is WAIT or BLOCK, preserve it.
- If `abs(triggerDistancePct) > 5%`, change the final action to WAIT and effective size to 0.
- Otherwise preserve the existing action and size exactly.
- Entry, trigger, stop, targets, ranking, timing grade and GANN timing score are never changed.

The 5% threshold is frozen before forward observation. It must not be changed in response to subsequent results.

## Validation window

Only sessions strictly after the locked retrospective window are eligible:

- Earliest eligible session: **2026-08-25**.
- No row dated 2026-08-24 or earlier may contribute to forward acceptance statistics.
- Results may be accumulated as data becomes available, but the policy itself is frozen.

For a first formal forward decision, require at least:

- **20 evaluable sessions**, and
- **50 consensus candidate rows** before the overlay.

Until both minimums are met, report results as `INSUFFICIENT_FORWARD_SAMPLE` and make no promotion decision.

## Integrity invariants

Every forward evaluation must assert:

- identical candidate keys before and after overlay;
- zero added candidates;
- zero duplicate date/ticker keys;
- identical V16 and SEPA ranks;
- identical GANN timing grade and timing score;
- identical entryLow, entryHigh, trigger, stopLoss and target1;
- overlay size never exceeds baseline size;
- all acceptance rows are dated 2026-08-25 or later;
- no production/main files are modified.

## Metrics

Report baseline versus challenger for the same forward rows:

- Profit Factor;
- compounded basket return;
- maximum drawdown;
- fill rate;
- target hit rate;
- stop hit rate;
- effective exposure;
- number of rows blocked specifically by the >5% distance rule.

## Forward acceptance gate

The rule is eligible for further promotion review only when the minimum forward sample is met and all of the following are true:

- Profit Factor is not worse than the locked forward baseline;
- compounded return is not worse than the locked forward baseline;
- maximum drawdown is not worse than the locked forward baseline;
- stop-hit rate is not worse than the locked forward baseline;
- all integrity invariants pass.

This is deliberately a non-degradation gate rather than a requirement to reproduce the same-sample retrospective uplift. Any future production decision still requires a separate review of sample adequacy, regime coverage, and execution realism.

## Prohibited actions

- No threshold tuning on the 2026-06-01 through 2026-08-24 sample.
- No fixed stock count.
- No candidate additions.
- No changing SEPA/GANN/Regime logic during this test.
- No promoting the prior same-sample trigger-distance decomposition as validated evidence.
- No production merge from this preregistration alone.
