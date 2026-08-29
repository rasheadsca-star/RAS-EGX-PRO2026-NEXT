# V16.9 Downside Fragility Expert — Research Contract

## Objective

Target one specific V16.9 loss mechanism instead of adding another broad market filter: a recommendation that opens the next session below the frozen lower entry boundary and later becomes executable under the historical open-rule path. Loss Anatomy labels this **Gap-Down Recovery Trap**.

The existing 45-session anatomy found 9 historically executable cases in this state: 0% target rate, 55.56% stop rate, and -2.8069% average next-close return. Those fields are post-outcome diagnostics only; they are not inputs to the signal-time expert.

## Two stages, deliberately separated

### Stage A — signal-time fragility challenger

At the frozen signal date, use only the stock's own historical overnight open gaps through that date. No market breadth, momentum, RSI, target/stop outcome, future open, future bar, Meta decision, or V16 outcome is visible.

The one-shot rule is frozen before its audit:

- last 20 observable overnight gaps;
- a historical downside gap is `<= -1.0%`;
- downside-gap frequency must be `>= 15%` (at least 3 of 20);
- historical 10th-percentile gap must be `<= -1.5%`;
- both conditions are required for `FRAGILE_WATCH`.

These thresholds may not be retuned after reading the audit. If the one-shot candidate fails, it is rejected.

### Stage B — next-open structural execution guard

At the actual next-session open, compare only the observed opening price with the already frozen `entryLow`:

`nextOpen < frozenEntryLow => VETO_GAP_DOWN_RECOVERY_ENTRY`

There is no fitted threshold. This is an execution-state relation, not a signal-close alpha factor. It must not inspect intraday high/low, stop/target touches, close, or later bars before deciding.

The Fresh Forward policy already protects the same mechanism by disallowing a gap-down recovery fill. Therefore Stage B is **not additional alpha** and must never be double-counted as a Meta improvement. Its purpose is to isolate and name the historical failure mechanism and keep the protection independently testable.

## Destructive-critic gates

The expert is invalid if any of the following occurs:

- any feature bar later than the signal date changes Stage A;
- any outcome field changes Stage B;
- ATR-derived recommendation geometry is used as a predictive feature;
- thresholds are retuned after seeing this audit;
- the expert receives positive weight from this retrospective window;
- the existing Fresh Forward gap-down no-fill rule is counted a second time as incremental Meta alpha.

## One-shot retrospective acceptance test for Stage A

This test is diagnostic, not promotion evidence. The fixed Stage A rule is only retained as a forward shadow challenger if all are true:

- at least 15 fragile executable observations;
- fragile observations are materially worse than PASS observations: either stop rate worse by at least 10 percentage points or average next-close return worse by at least 1 percentage point;
- actual structural Gap-Down Recovery Traps are enriched among fragile names by at least 5 percentage points;
- at least two chronological thirds contain at least 4 fragile executable observations;
- at least two eligible thirds support the fragility direction.

Failure means `REJECTED_ONE_SHOT_NO_RETUNE`.

## Authority lock

For both stages:

- `scoringImpact = NONE`
- `alphaWeight = 0`
- `productionAuthority = false`
- `promotionEligible = false`
- V16.9 remains Champion
- PR #68 remains Draft
- no merge, `main` mutation, or production deployment
- the existing Fresh Forward snapshot and policy remain unchanged

Any future positive weight requires separate independent forward evidence under a preregistered acceptance decision.
