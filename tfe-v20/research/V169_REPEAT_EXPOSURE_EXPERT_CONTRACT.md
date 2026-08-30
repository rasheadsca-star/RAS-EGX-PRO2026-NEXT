# V16.9 Repeat Exposure Expert — Frozen One-Shot Contract

## Purpose

Test whether residual V16.9 / RiskAlpha losses are partly caused by **repeated selection concentration at the member level**: the same ticker being selected repeatedly across recent V16.9 baskets, potentially indicating stale crowding / exhausted signal persistence rather than independent fresh opportunity.

This is a separate mechanism from the rejected Breadth, Geometry, Raw Momentum, Pullback, Downside-Fragility Stage-A, Correlation Concentration v1, and RiskAlpha next-open families.

## Frozen signal-time rule

For every selected V16.9 member on its signal date:

1. Use only prior V16.9 basket selections with signal dates strictly earlier than the current signal date.
2. Look back over the **previous 5 V16.9 signal sessions** only.
3. Count how many of those previous 5 baskets contained the same ticker.
4. If the ticker appeared in **at least 2** of those previous 5 baskets, classify it `REPEAT_EXPOSURE_WATCH`.
5. Otherwise classify it `PASS`.
6. For the first sessions without 5 prior baskets, still use all available prior sessions; classification remains valid because it never uses future selections.

The rule `>=2 appearances in the previous 5 baskets` is frozen before outcome testing and must not be changed after reading retrospective results.

## Frozen action under the one-shot test

The Repeat Exposure Expert is a **member-level veto candidate**. In the isolated test, members classified `REPEAT_EXPOSURE_WATCH` are removed; no removed member is replaced. Remaining members are equal-weight renormalized. If no members remain, session return is 0.

Four arms must be reported:

1. **A — V16.9 Champion:** original frozen baseline.
2. **B — RiskAlpha Stage-B:** already-frozen next-open guard only.
3. **C — Repeat Exposure only:** veto `REPEAT_EXPOSURE_WATCH`; no RiskAlpha guard.
4. **D — Combined:** veto if Repeat Exposure is `REPEAT_EXPOSURE_WATCH` OR RiskAlpha is `VETO_GAP_DOWN_RECOVERY_ENTRY`.

The repeat-exposure decision itself may not use next open, next high/low/close, stop/target outcomes, future bars, Meta decisions, or any outcome-derived field.

## Frozen acceptance rule

The candidate is only `PROMISING_RETROSPECTIVE_SHADOW_ONLY` if **all** of the following pass:

### Sample / separation

- at least **12 executable** members flagged `REPEAT_EXPOSURE_WATCH` after considering the V16.9 execution universe;
- flagged executable members show material adverse separation from PASS executable members by at least one of:
  - stop rate >= PASS stop rate + **10 percentage points**, or
  - average next-close return <= PASS average next-close return - **1.00 percentage point**;
- split the 45 signal dates chronologically into 3 folds;
- a fold is eligible when it contains at least **4 flagged executable** members;
- at least **2 eligible folds** are required;
- at least **2 eligible folds** must show the adverse direction (higher stop rate or lower average next-close return for flagged members).

### Incremental value over frozen RiskAlpha

Combined vs RiskAlpha must satisfy all of:

- Max Drawdown improvement >= **+1.00 percentage point**;
- Profit Factor delta >= **0.000**;
- average net return delta >= **-0.10 percentage point**;
- residual stop-rate reduction >= **+3.00 percentage points**;
- conservative target-rate change >= **-5.00 percentage points**.

No threshold may be retuned if this one-shot result fails.

## Destructive-critic validity gates

The audit is invalid if any of the following occurs:

- any current or future basket is included in the repeat count;
- any outcome field affects the repeat-exposure classification;
- the 5-session lookback or >=2 repeat threshold changes after outcome inspection;
- a removed member is replaced after observing outcomes;
- the pinned 45-session V16.9 evidence lineage changes;
- rejected Breadth, ATR geometry, Raw Momentum/Pullback variables, or Correlation v1 thresholds are smuggled into this candidate;
- fresh-forward evidence is rewritten;
- retrospective evidence grants positive production/scoring authority.

## Authority lock

- `researchOnly = true`
- Champion = `V16.9`
- `scoringImpact = NONE`
- `alphaWeight = 0`
- `productionAuthority = false`
- `promotionEligible = false`
- `retuningAllowedAfterOutcome = false`
- PR #68 remains Draft/Open/Unmerged
- no `main` mutation
- no production deployment

Even a retrospective pass remains zero-weight shadow evidence and requires separately preregistered fresh-forward confirmation.
