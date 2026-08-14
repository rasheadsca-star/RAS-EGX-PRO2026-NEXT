# V20 Phase 18 — Independent Backtest Readiness Gate

## Verdict

Current V20 Decision Intelligence is **not ready for an independent predictive-performance backtest claim**.

This does not mean the pipeline is untested. Governance, data truth, no-lookahead protections, immutable signals, conservative forward resolution, browser runtime, and release contracts are tested. The missing evidence is specifically a historical or fresh-forward sample that evaluates the **V20 score architecture itself** without reusing evidence that informed its design.

## Why existing V19 evidence is not a V20 score backtest

The V19 58-session Development OOS evidence belongs to the V19 challenger architecture. It cannot be relabeled as performance of a V20 score created later.

The stronger V19 20-session benchmark is explicitly reused/non-independent and post-hoc. It remains useful historical context, but it cannot calibrate, validate, or promote V20 Decision Intelligence.

## Current V20 sample

V20 currently has immutable issued signals concentrated on the current decision session and forward evaluations that remain pending as of the same completed market session. Pending results remain `null`; they are never converted to zero or counted as a loss/win.

Until multiple genuinely subsequent market sessions resolve, fresh V20 forward evidence cannot calibrate the score.

## Required evidence before a calibration claim

A valid V20 score calibration/backtest must include:

1. Frozen score-policy/model version per signal.
2. Point-in-time feature snapshot created before the outcome is known.
3. No future OHLC rows or look-ahead.
4. First accepted post-signal session entry semantics consistent with the frozen evaluation policy.
5. Conservative same-candle target/stop ambiguity.
6. Central round-trip transaction costs.
7. Development, walk-forward, and independent holdout separation.
8. Fresh independent holdout before any production-performance claim.
9. Research opportunity returns separated from Applied Portfolio performance.
10. Immutable signal hashes preserved.

## Claims currently forbidden

Until the required evidence exists, V20 must not claim:

- calibrated alpha from `V20 Research Decision Score`;
- calibrated target probability derived from the score;
- V20 score profitability;
- a V19 Development result as a V20 backtest;
- the reused V19 benchmark as independent V20 validation;
- V18 performance as validation without a reproducible V18 audit;
- pending forward evaluations as zero-return observations.

## Runtime evidence

- `scripts/v20/build-backtest-readiness.cjs`
- `scripts/v20/backtest-readiness-regression.cjs`
- `v20/backtest.html`
- `v20/backtest.js`
- `v20/backtest.css`

The intended machine-readable status is `NOT_READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST` until genuinely independent evidence satisfies the gate.
