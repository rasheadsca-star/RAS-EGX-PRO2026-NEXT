# SEPA-X vs RC2 vs V16.9 — Evidence Report

Generated: 2026-08-27T13:37:01.424Z

## Verdict

**NO_SINGLE_UNIVERSAL_WINNER**

Use the engine according to horizon: RC2 for conservative target precision, V16.9 for one-session basket ranking, and SEPA-X only for larger 2R+ objectives if its retrospective evidence is adequate.

> The three engines do not optimize the same target or holding horizon. Raw target-hit percentages must not be compared as if their objectives were identical.

## Native evidence

| Engine | Evidence sample | Target / horizon | Hit / Win | Avg net | Profit Factor | Drawdown |
|---|---:|---|---:|---:|---:|---:|
| SEPA-X | 53 entered / 200 signal dates | T1=2R, T2=3R, T3=4R; max 20 sessions | T1 39.6%; T2 22.6%; T3 11.3% | 2.07% | 1.71 | -25.40% |
| RC2 | 67 entered | T1≈0.8R capped by resistance; max 10 sessions | T1 76.1%; Wilson lower 64.7% | 1.32% | 2.44 | N/A in native API summary |
| V16.9 | 35 blocked OOS sessions | 1-session equal-weight basket | Win 54.3% | 1.37% | 2.18 | -10.88% |

## SEPA-X target evidence

- 2R hit rate: **39.6%**
- 3R hit rate: **22.6%**
- 4R hit rate: **11.3%**
- Expectancy: **0.37R**
- Stop before 2R: **47.2%**

## Interpretation

- **RC2** remains the conservative target-precision benchmark because its primary target is materially closer and it reports a statistical lower bound.
- **V16.9** has the cleanest native evidence for one-session top-basket ranking.
- **SEPA-X** is designed for fewer names and larger 2R+ targets; its quality should be judged primarily by 2R/3R/4R hit rate, expectancy in R, and drawdown rather than raw hit rate against RC2.
