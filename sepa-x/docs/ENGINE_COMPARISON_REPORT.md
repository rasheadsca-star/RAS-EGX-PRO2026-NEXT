# SEPA-X vs RC2 vs V16.9 — Evidence Report

Generated: 2026-08-27T16:17:40.740Z

## Verdict

**NO_SINGLE_UNIVERSAL_WINNER**

Use the engine according to horizon: RC2 for conservative target precision, V16.9 for one-session basket ranking, and SEPA-X only for larger 2R+ objectives if its retrospective evidence is adequate.

> The three engines do not optimize the same target or holding horizon. Raw target-hit percentages must not be compared as if their objectives were identical.

## Native evidence

| Engine | Evidence sample | Target / horizon | Hit / Win | Avg net | Profit Factor | Drawdown |
|---|---:|---|---:|---:|---:|---:|
| SEPA-X | 80 entered / 700 signal dates | T1=2R, T2=3R, T3=4R; max 20 sessions | T1 37.5%; T2 22.5%; T3 12.5% | 1.68% | 1.60 | -27.17% |
| RC2 | 67 entered | T1≈0.8R capped by resistance; max 10 sessions | T1 76.1%; Wilson lower 64.7% | 1.32% | 2.44 | N/A in native API summary |
| V16.9 | 35 blocked OOS sessions | 1-session equal-weight basket | Win 54.3% | 1.37% | 2.18 | -10.88% |

## SEPA-X target evidence

- 2R hit rate: **37.5%**
- 3R hit rate: **22.5%**
- 4R hit rate: **12.5%**
- Expectancy: **0.42R**
- Stop before 2R: **43.8%**

## Interpretation

- **RC2** remains the conservative target-precision benchmark because its primary target is materially closer and it reports a statistical lower bound.
- **V16.9** has the cleanest native evidence for one-session top-basket ranking.
- **SEPA-X** is designed for fewer names and larger 2R+ targets; its quality should be judged primarily by 2R/3R/4R hit rate, expectancy in R, and drawdown rather than raw hit rate against RC2.
