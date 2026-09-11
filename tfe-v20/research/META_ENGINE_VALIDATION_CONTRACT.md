# EGX Meta-Engine V1 — Validation & Destroyer-Critic Contract

## Objective
Promote the meta-engine only if it produces a material, reproducible out-of-sample improvement over the strongest comparable legacy baseline under the same data, execution and cost assumptions.

## Non-negotiable anti-bias rules
1. Every historical feature must be point-in-time and cut at the signal date.
2. No future OHLC row may enter feature generation, ranking, filtering or calibration.
3. Historical universe membership must be archived when available; reconstructed current-universe tests are diagnostic only.
4. Missing engine evidence is neutral/downweighted, never converted to a bearish signal.
5. Same-session target+stop ambiguity is scored conservatively as stop-first when intraday ordering is unavailable.
6. Entry must occur next session or later; same-bar entry/exit is forbidden.
7. Corporate actions and adjusted prices must be consistent across all compared engines.
8. Identical transaction cost, slippage, liquidity and position-size rules must be used for all engines.
9. Correlated engines from the same underlying family may not count as independent consensus.
10. Parameter tuning and model selection are forbidden on the final holdout.

## Evidence hierarchy
FRESH_FORWARD_INDEPENDENT > WALK_FORWARD_POINT_IN_TIME > HOLDOUT_REUSED_DIAGNOSTIC > RETROSPECTIVE_POINT_IN_TIME > RETROSPECTIVE_PROXY > CURRENT_SNAPSHOT_ONLY > UNVERIFIED.

## Primary baseline
The strongest leader-eligible comparable baseline is MAIN APP V16.9.2 until a newer engine beats it under the same contract. Current stored diagnostic: 20 sessions, 65 selections, 55 executable, 40.00% conservative target hit, 38.18% stop touch, target-minus-stop edge +1.82 percentage points.

## Secondary references
- V19 V6: comparable diagnostic, but its holdout was reused during development; not fresh independent evidence.
- V20 Native retrospective: point-in-time reconstruction with no future feature rows, but only 8 completed sessions and possible survivorship bias; not leader-eligible.
- V17: shares the same underlying V16.9 method and must not be double-counted as independent alpha.

## Promotion metrics
A candidate must be evaluated on:
- Conservative target-hit rate
- Stop-touch rate
- Target-minus-stop edge
- Net expectancy after costs
- Profit factor
- Max drawdown
- Sharpe and Sortino
- Calmar
- MFE / MAE
- Turnover and exposure
- Precision@Top-K
- Entry miss / no-entry rate
- Probability calibration (Brier score and calibration bins)
- Coverage and abstention rate

## Material improvement gate
All conditions are required before production promotion:
1. No critical data-lineage, look-ahead, execution-timing or survivorship defect.
2. Net expectancy after costs > baseline.
3. Target-minus-stop edge improves by at least +5 percentage points OR the improvement is statistically/bootstrapped robust with materially lower drawdown.
4. Stop-touch rate must not deteriorate by more than 3 percentage points unless expectancy and drawdown improve materially.
5. Max drawdown must be no worse than baseline by more than 10% relative.
6. Improvement must persist across at least 3 walk-forward folds and not be concentrated in one month, sector or ticker.
7. Top-K improvement must remain after realistic liquidity constraints.
8. Final independent holdout must remain untouched until all design choices are frozen.

## Destroyer-Critic loop
For each candidate revision:
1. Developer produces code + frozen configuration + exact input hashes.
2. Critic attempts to break data lineage, time alignment, execution realism, independence, calibration, stability, missing-data handling and UI truthfulness.
3. Every finding is classified Critical / High / Medium / Low with reproducible evidence.
4. Developer fixes findings without changing the final holdout.
5. Tests are rerun from scratch.
6. Repeat until there are zero known Critical/High findings and no new material Medium finding.
7. Only then run the final independent holdout once.

## Forbidden claims
Do not claim guaranteed profit, guaranteed hit rate, perfect engine, full historical coverage, calibrated probability or production superiority unless the corresponding evidence gate is actually satisfied.
