# Breadth Regime Exposure V1 — Frozen Research Hypothesis

Status: research-only. This controller never changes V16 stock ranking and has no authority to enable production execution.

## Hypothesis

A broad-market participation filter derived only from point-in-time OHLCV may reduce V16 drawdown and weak-session exposure without using V16 scores, recommendations, targets/stops, or future outcomes to define the regime.

## Frozen regime inputs

For every V16 signal date, build a cross-sectional market snapshot from `data/history` using only bars with `date <= signalDate` and requiring an exact bar on the signal date.

A symbol is feature-ready only with at least 60 sessions. Compute:

- `breadth20`: percentage of feature-ready symbols closing above EMA20.
- `breadth50`: percentage closing above EMA50.
- `positive20`: percentage with a positive 20-session close return.
- `medianReturn20`: cross-sectional median 20-session close return.

Minimum feature-ready universe: 60 symbols. If unavailable, regime is `UNKNOWN` and exposure defaults to 50%, never zero.

## Frozen regime score and exposure

One supportive point for each condition:

1. `breadth20 >= 55%`
2. `breadth50 >= 50%`
3. `positive20 >= 55%`
4. `medianReturn20 >= 0%`

Exposure mapping:

- score 3–4: `RISK_ON`, exposure `1.00`
- score 2: `NEUTRAL`, exposure `0.50`
- score 0–1: `RISK_OFF`, exposure `0.00`
- insufficient/unknown data: `UNKNOWN`, exposure `0.50`

No threshold or exposure mapping may be altered after inspecting this V1 audit.

## Fixed evaluation

Use the exact blocked walk-forward V16 basket return already produced by `v16-v169-target-hit-audit.py` for each signal date. The controller modifies only exposure:

`controlledReturn = v16BasketNetReturnPct × exposure`

Transaction costs are already included in the V16 basket return and are not double-counted.

## Evidence limitation

This historical window has already been observed elsewhere in the research program. It is post-hoc research evidence, not an untouched final holdout. A positive result can earn only `CANDIDATE_FOR_FRESH_FORWARD_SHADOW_ONLY`; it cannot promote the controller.

## Frozen internal research gate

All checks must pass:

1. At least 30 evaluable V16 sessions.
2. At least 5 sessions classified `RISK_OFF` or `UNKNOWN`/reduced exposure, so the controller is not a no-op.
3. Controlled average basket net return is not lower than baseline by more than 0.15 percentage points.
4. Controlled profit factor is at least baseline profit factor.
5. Controlled maximum drawdown improves by at least 20% relative (absolute drawdown magnitude).
6. Controlled worst session improves by at least 1.0 percentage point.
7. Controlled compounded return remains at least 80% of baseline compounded return.
8. In at least 2 of 3 chronological folds, controlled max drawdown is no worse than baseline and controlled average return is not lower by more than 0.25 percentage points.

If any check fails: `REJECT_EXPOSURE_POLICY_V1_NO_RETUNING`.

If every check passes: `CANDIDATE_FOR_FRESH_FORWARD_SHADOW_ONLY`, still zero production authority until fresh point-in-time evidence accumulates.
