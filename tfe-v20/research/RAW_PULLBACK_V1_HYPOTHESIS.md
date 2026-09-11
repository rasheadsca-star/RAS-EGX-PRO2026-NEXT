# Raw Trend Pullback Recovery V1 — Frozen Research Hypothesis

Status: research-only, zero alpha weight by default.

## Why this expert exists

The current research program has repeatedly identified entry timing / chasing extended prices as a weakness. This expert tests a distinct hypothesis from the rejected cross-sectional momentum V1: within an established uptrend, a controlled pullback followed by same-session recovery may improve entry quality and/or confirm V16 opportunities without reading any legacy engine's candidates, scores, recommendations, targets, stops, or outcomes.

## Frozen generation policy before first outcome audit

Inputs: adjusted OHLCV from `data/history`, truncated to `date <= signalDate` only.

- Minimum history: 90 sessions.
- Trend: EMA20 > EMA50 and EMA50 is rising versus its value 10 sessions earlier.
- Pullback: close is 2%–12% below the adjusted 20-session high.
- Recovery: signal close > previous close and close location within the signal bar is at least 60%.
- Liquidity: at least 15 non-zero-volume days in the latest 20 sessions.
- Score: equal-weight cross-sectional percentile of EMA50 trend slope, recovery from 5-session low, close-location value, and median 20-session traded value.
- Confirmation threshold: score >= 70.
- Standalone selection: top 3 eligible names per session.
- No outcome-derived feature, threshold, coefficient, candidate list, rank, or target/stop input is permitted.

## Fixed execution for research audit

- Standalone: next-session open through third-session close.
- Confirmation comparison: exact V16 entry zone / stop / target; next-session zone touch; three sessions; conservative STOP_FIRST.
- Round-trip transaction cost: 0.60%.

## Evidence limitation

The historical window used by this research program has already been observed in earlier experiments. Therefore the newest third of the available V16 audit sessions is an internal diagnostic slice only, **not an untouched holdout**. No historical result from this V1 audit can make the expert promotion-eligible.

## Frozen internal research gate

All conditions below must pass for V1 to earn only `CANDIDATE_FOR_FRESH_FORWARD_SHADOW_ONLY` status:

1. Diagnostic slice has at least 12 sessions.
2. Standalone diagnostic sample has at least 24 filled trades.
3. Standalone diagnostic average basket return is positive after costs.
4. Standalone diagnostic profit factor is at least 1.10.
5. Standalone diagnostic max drawdown is no worse than -15%.
6. V16-confirmed diagnostic sample has at least 12 filled trades.
7. Confirmed average net return improves by at least +0.25 percentage points versus expert-available V16 baseline.
8. Confirmed stop-hit rate is not worse than baseline.
9. Confirmed profit factor is not worse than baseline.
10. Confirmed max drawdown is not worse than baseline.
11. Positive confirmation direction occurs in at least 2 of 3 chronological folds.

If any condition fails, disposition is `REJECT_ALPHA_WEIGHT_ZERO`. Do not retune V1 thresholds on the observed outcomes.

If every condition passes, the expert still receives zero production alpha weight and must enter fresh point-in-time forward shadow before any consideration for positive weight.
