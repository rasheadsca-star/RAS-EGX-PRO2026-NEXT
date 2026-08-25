# SEPA-X vs RC2 vs V16.9 — Evidence Report

Generated: 2026-08-25T21:34:56.511Z

## Verdict

**NO_SINGLE_UNIVERSAL_WINNER**

Use the engine according to horizon: RC2 for conservative target precision, V16.9 for one-session basket ranking, and SEPA-X only for larger 2R+ objectives if its retrospective evidence is adequate.

> The three engines do not optimize the same target or holding horizon. Raw target-hit percentages must not be compared as if their objectives were identical.

## Native evidence

| Engine | Evidence sample | Target / horizon | Hit / Win | Avg net | Profit Factor | Drawdown |
|---|---:|---|---:|---:|---:|---:|
| SEPA-X | 47 entered / 200 signal dates | T1=2R, T2=3R, T3=4R; max 20 sessions | T1 34.0%; T2 21.3%; T3 8.5% | 0.79% | 1.25 | -27.14% |
| RC2 | 67 entered | T1≈0.8R capped by resistance; max 10 sessions | T1 76.1%; Wilson lower 64.7% | 1.31% | 2.45 | N/A in native API summary |
| V16.9 | 35 blocked OOS sessions | 1-session equal-weight basket | Win 54.3% | 1.37% | 2.18 | -10.88% |

## SEPA-X target evidence

- 2R hit rate: **34.0%**
- 3R hit rate: **21.3%**
- 4R hit rate: **8.5%**
- Expectancy: **0.15R**
- Stop before 2R: **53.2%**

## Interpretation

- **RC2** remains the conservative target-precision benchmark because its primary target is materially closer and it reports a statistical lower bound.
- **V16.9** has the cleanest native evidence for one-session top-basket ranking.
- **SEPA-X** is designed for fewer names and larger 2R+ targets; its quality should be judged primarily by 2R/3R/4R hit rate, expectancy in R, and drawdown rather than raw hit rate against RC2.
