# V16.9 Correlation Concentration Expert — Frozen One-Shot Contract

## Purpose

Test whether residual V16.9 / RiskAlpha losses are partly caused by **portfolio concentration disguised as diversification**: several selected stocks moving together before the signal date, so equal-weight basket construction does not provide independent risk diversification.

This is a separate mechanism from the rejected Breadth, Geometry, Raw Momentum, Pullback, Downside-Fragility Stage-A, and RiskAlpha next-open families.

## Frozen signal-time rule

For every frozen V16.9 basket on its signal date:

1. Use only adjusted close data available **through the signal date**.
2. For each selected ticker, derive the latest 20 close-to-close returns ending on or before the signal date.
3. Align pairwise return observations by date.
4. A pair is eligible only when at least 15 common return observations exist.
5. Compute Pearson correlation for every eligible pair.
6. Compute the median eligible pairwise correlation for the basket.
7. If the basket has at least 3 selected members and median pairwise correlation is **>= 0.60**, classify it `CORRELATED_BASKET_WATCH`.
8. Otherwise classify it `PASS`. If there are not enough eligible pairs, classify it `UNAVAILABLE`.

The threshold **0.60 is frozen before outcome testing** as a material-positive-correlation risk threshold. It must not be changed after reading the retrospective result.

## Frozen action under the one-shot test

The correlation expert is a **session-level abstention candidate**. In the isolated test, a `CORRELATED_BASKET_WATCH` session is skipped entirely; its counterfactual session return is 0 and no removed member is replaced.

Four arms must be reported:

1. **A — V16.9 Champion:** original frozen baseline.
2. **B — RiskAlpha Stage-B:** the already-frozen next-open guard only.
3. **C — Correlation Concentration only:** skip `CORRELATED_BASKET_WATCH` sessions; no RiskAlpha guard.
4. **D — Combined:** first apply the frozen session-level correlation abstention; for non-abstained sessions apply the already-frozen RiskAlpha Stage-B member veto.

The correlation decision itself may not use next open, next high/low/close, stop/target outcomes, future bars, Meta decisions, or any outcome-derived field.

## Frozen acceptance rule

The candidate is only `PROMISING_RETROSPECTIVE_SHADOW_ONLY` if **all** of the following pass:

### Sample / separation

- at least **8** flagged `CORRELATED_BASKET_WATCH` sessions;
- because the research target is the **32 residual STOPs after the frozen RiskAlpha Stage-B guard**, member stop-rate separation is measured only on executable members that **survive RiskAlpha Stage-B**; the correlation classification itself remains signal-time only and cannot see the Stage-B result;
- flagged sessions show material adverse separation from PASS sessions by at least one of:
  - residual member stop rate >= PASS residual member stop rate + **10 percentage points**, or
  - RiskAlpha-adjusted average session net return <= PASS RiskAlpha-adjusted average session net return - **1.00 percentage point**;
- split the 45 signal dates chronologically into 3 folds;
- a fold is eligible when it contains at least **2** flagged sessions;
- at least **2 eligible folds** are required;
- at least **2 eligible folds** must show the adverse direction (higher residual stop rate or lower RiskAlpha-adjusted average session return for flagged sessions).

### Incremental value over frozen RiskAlpha

Combined vs RiskAlpha must satisfy all of:

- Max Drawdown improvement >= **+1.00 percentage point**;
- Profit Factor delta >= **0.000**;
- average net return delta >= **-0.10 percentage point**;
- session win-rate delta >= **-5.00 percentage points**.

No threshold may be retuned if this one-shot result fails.

## Destructive-critic validity gates

The audit is invalid if any of the following occurs:

- a return observation later than the signal date enters the correlation window;
- outcome dates or next-session prices affect the correlation classification;
- the 0.60 correlation threshold changes after outcome inspection;
- the 20-return lookback or 15-common-observation minimum changes after outcome inspection;
- a skipped session or removed member is replaced after observing outcomes;
- the pinned 45-session V16.9 evidence lineage changes;
- Breadth, ATR geometry, rejected Raw Momentum/Pullback variables, or outcome-derived fields are smuggled into this candidate;
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
