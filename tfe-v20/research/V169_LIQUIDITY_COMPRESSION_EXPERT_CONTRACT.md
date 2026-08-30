# V16.9 Liquidity Compression Expert — Frozen One-Shot Contract

## Purpose

Test whether residual V16.9 / RiskAlpha losses are partly caused by **signal-time liquidity deterioration**: recent trading volume drying up materially versus the ticker's own immediately preceding baseline before the V16.9 signal.

This is a separate mechanism from rejected Breadth, Geometry, Raw Momentum, Pullback, Downside-Fragility Stage-A, Correlation Concentration v1, Repeat Exposure v1, and the RiskAlpha next-open guard.

## Frozen signal-time rule

For every selected V16.9 member on its signal date:

1. Use only daily volume observations with dates **on or before the signal date**.
2. Take the latest **5** available sessions ending on the signal date or earlier as the recent window.
3. Take the immediately preceding **20** sessions as the baseline window.
4. Require at least 4 positive-volume observations in the recent 5 and at least 15 positive-volume observations in the prior 20; otherwise classify `UNAVAILABLE`.
5. Compute the median positive volume in each window.
6. Compute `recentMedianVolume / priorMedianVolume`.
7. If this ratio is **<= 0.60**, classify `LIQUIDITY_COMPRESSION_WATCH`; otherwise classify `PASS`.

The 5/20 windows, positive-volume requirements and 0.60 threshold are frozen before outcome testing and must not be changed afterward.

## Frozen action under the one-shot test

This is a **member-level veto candidate**. In the isolated test, `LIQUIDITY_COMPRESSION_WATCH` members are removed; no replacement is allowed. Remaining members are equal-weight renormalized. If no members remain, session return is 0.

Four arms must be reported:

1. **A — V16.9 Champion**.
2. **B — RiskAlpha Stage-B only**.
3. **C — Liquidity Compression only**.
4. **D — Combined:** veto if Liquidity Compression flags the member OR RiskAlpha vetoes it.

## Frozen acceptance rule

The diagnostic sample is restricted to members **not vetoed by RiskAlpha Stage-B**, so the known gap-down recovery mechanism cannot be credited to liquidity compression.

The candidate is only `PROMISING_RETROSPECTIVE_SHADOW_ONLY` if all checks pass:

- at least **12 executable residual members** flagged `LIQUIDITY_COMPRESSION_WATCH`;
- flagged residual executable members show material adverse separation from residual PASS executable members by at least one of:
  - stop rate >= PASS + **10 percentage points**, or
  - average next-close return <= PASS - **1.00 percentage point**;
- split the 45 signal dates chronologically into 3 folds;
- each eligible fold has at least **4 flagged residual executable** members;
- at least **2 eligible folds** and **2 adverse-direction folds**;
- Combined vs RiskAlpha:
  - Max Drawdown improvement >= **+1.00 percentage point**;
  - Profit Factor delta >= **0.000**;
  - average net return delta >= **-0.10 percentage point**;
  - residual stop-rate reduction >= **+3.00 percentage points**;
  - target-rate change >= **-5.00 percentage points**.

No threshold may be retuned if this one-shot fails.

## Destructive-critic validity gates

Invalid if:

- any volume observation after signal date enters either window;
- any next-session price, outcome, target/stop, Meta decision or future field affects classification;
- the 5/20 windows, positive-volume minimums or 0.60 threshold change after outcome inspection;
- removed members are replaced after observing outcomes;
- the pinned 45-session lineage changes;
- Breadth, ATR geometry, Raw Momentum/Pullback, Correlation v1 or Repeat Exposure v1 are blended into this candidate;
- fresh-forward evidence is rewritten;
- retrospective evidence gets production/scoring authority.

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
