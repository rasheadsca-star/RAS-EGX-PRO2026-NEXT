# Consensus Regime Confidence V1 — Preregistration

Date: 2026-08-28

## Status

**Exploratory / forward-shadow candidate only. Not eligible for production promotion from the existing 60-session sample.**

This policy is specified before its counterfactual run. It was motivated by the locked Attribution V1 report but its thresholds and actions must not be optimized after seeing the counterfactual result.

## Locked upstream pipeline

The upstream V16 Quality Gate V2 pipeline is frozen for this experiment:

1. V16 Quality Gate V2 qualification/ranking unchanged.
2. SEPA-X qualified proxy unchanged.
3. Exact V16 ∩ SEPA intersection unchanged.
4. GANN timing grade, score and entry levels unchanged.
5. Existing Regime Gate classification and base action unchanged.
6. No fixed Top-N and no V16/SEPA rank cutoff.
7. No candidate may be added by this overlay.

Expected locked evaluation universe: **60 sessions / 447 valid consensus candidates**.

## Hypothesis

The remaining first-half instability is primarily an execution-confidence/regime-transition issue. A small capital-protection overlay should suppress clearly weak timing readiness and reduce exposure to immediate/extended entries during high-volatility risk-on phases without changing stock selection.

## Policy — frozen before test

Apply only after the existing Regime Gate:

1. If the existing action is `WAIT` or `BLOCK`, preserve it exactly.
2. If `GANN timing score < 50`, change the final action to `WAIT` and size to `0`.
3. If absolute `triggerDistancePct > 5%`, change the final action to `WAIT` and size to `0`.
4. If the session is `RISK_ON`, `highVolatility = true`, and timing grade is `A` or `C`, cap final size at `0.50`. Do not change entry, trigger, stop or targets.
5. Otherwise preserve the existing final action and size exactly.

Threshold rationale is structural, not a grid search:

- `50` is the neutral midpoint of the 0–100 GANN timing-readiness scale.
- `5%` is an extreme execution-distance guard, not a percentile/rank cutoff.
- High-volatility `A/C` exposure is reduced rather than blocked to test capital protection against breakout/extension whipsaw while retaining the signal.

## Invariants

The counterfactual must assert all of the following:

- exactly 60 evaluation sessions;
- exactly 447 valid candidate rows before and after overlay;
- identical date/ticker candidate keys;
- zero duplicate date/ticker rows;
- identical V16 rank and SEPA rank for every candidate;
- identical timing grade and GANN timing score for every candidate;
- identical entryLow, entryHigh, trigger, stopLoss and target1 for every candidate;
- overlay can only preserve or reduce size; it can never increase size;
- no production/main files are modified.

## Evaluation

Report Full60, First30 and Last30 for baseline and challenger, including PF, compound return, max drawdown, exposure, fill rate, target hit and stop hit.

A same-sample result may only determine whether this frozen rule is worth **forward shadow validation**. It cannot be called production-ready even if every numerical gate improves.

Forward-shadow eligibility criteria for this exploratory run:

- First30 PF >= 1.00 and compound >= 0;
- Last30 PF >= 1.25 and compound > 0;
- Full60 PF >= locked baseline PF 2.07;
- Full60 max drawdown no worse than locked baseline -10.356%;
- candidate/invariant checks all pass;
- no degradation caused by candidate-selection changes (candidate set must be identical by construction).

No parameter may be changed after the run to make these criteria pass. A changed policy requires a new version and a new preregistration.