# EGX Consensus Pipeline V1 — Evidence

Generated from GitHub Actions run `33162332892` on 2026-08-28.

Status: **RESEARCH ACCEPTANCE FAIL (one stability gate only)**

No production engine or UI was changed.

## Locked architecture tested
1. V16 qualifies **all** stocks passing its existing execution conditions and ranks them by V16 execution score. There is no fixed Top-N output.
2. SEPA-X qualifies **all** stocks passing its current recommendation conditions and ranks them. There is no fixed Top-N output.
3. Only the exact ticker intersection of the two qualified lists is passed forward.
4. GANN cannot add stocks. It ranks the common list using execution timing/readiness: A/B/C, trigger proximity, Gann time, breakout and volume.
5. Regime Gate only protects capital through `ALLOW`, `REDUCE_SIZE`, `WAIT`, `BLOCK`.

## Important test-window limitation
The requested 60-session test could not be completed in V1 because the strict walk-forward V16 adapter requires a 20-session model warm-up. The usable evaluation window is **51 sessions, 2026-06-14 through 2026-08-24**. This must be extended to a true 60-session validation before production promotion.

## Qualification breadth
- Average V16-qualified stocks/session: **124.20**
- Average SEPA-qualified stocks/session: **34.86**
- Average common stocks/session: **27.82**
- Sessions with at least one common stock: **51/51**

This confirms that no artificial fixed stock count was used. It also shows that V16 qualification is currently broad and should be calibrated as a quality threshold, not replaced by a fixed Top-N.

## Full 51-session results
| Engine / stage | PF | Compound % | Max DD % | Positive % | Target % | Stop % | Exposure % |
|---|---:|---:|---:|---:|---:|---:|---:|
| V16 qualified walk-forward | 0.99 | +0.260 | -11.171 | 44.1 | 26.0 | 20.7 | 100.0 |
| SEPA-X qualified proxy | 1.27 | +3.597 | -16.999 | 38.8 | 2.3 | 3.5 | 100.0 |
| GANN current ACTIONABLE | 1.39 | +2.531 | -9.712 | 50.8 | 5.5 | 1.7 | 96.1 |
| Raw V16∩SEPA intersection | 1.30 | +0.904 | -11.583 | 44.1 | 6.8 | 0.6 | 100.0 |
| Intersection + GANN timed | 1.30 | +0.904 | -11.583 | 44.1 | 6.8 | 0.6 | 100.0 |
| **Final consensus + Regime Gate** | **1.47** | **+8.534** | **-4.251** | **45.6** | **7.3** | **0.6** | **57.2** |

The final pipeline is the best tested variant in this window on Profit Factor, compounded return and drawdown simultaneously. However, this is research evidence only and does not establish future profitability.

## Stability split
The 51-session window splits into first 30 and remaining 21 sessions.

| Window | Final PF | Compound % | Max DD % | Exposure % |
|---|---:|---:|---:|---:|
| First 30 | 1.00 | **-0.957** | -2.882 | 43.8 |
| Last 21 | 1.70 | **+9.583** | -4.251 | 76.3 |

The only failed acceptance condition is first-period stability because compound return remained slightly negative in the first 30 sessions. Therefore the pipeline must not be merged to production yet.

## Exact V16.9 live common window — 15 sessions
| Engine | PF | Compound % | Max DD % | Positive % |
|---|---:|---:|---:|---:|
| V16.9 LIVE exact | 1.40 | **+14.423** | -5.324 | 53.1 |
| Consensus Final | **1.85** | +7.860 | **-4.251** | 51.2 |

On the exact V16 live dates, Consensus improves PF and drawdown, while V16 remains superior in raw compounded return. These results are not fully apples-to-apples because the strategies differ in concentration, entry/target framework and cash exposure.

## GANN timing diagnostic
`CONSENSUS_INTERSECTION_RAW` and `CONSENSUS_GANN_TIMED` are numerically identical in V1. This means the current experiment does **not** isolate GANN's incremental timing value: the raw comparison already inherits GANN-adjusted entry levels. V2 must use neutral unmodified intersection entry levels for the raw baseline and apply A/B/C trigger/pullback rules only in the GANN-timed stage.

## Acceptance gate
- PF >= 1.25: **PASS**
- Compound positive: **PASS**
- Max drawdown >= -15%: **PASS**
- First-period stability: **FAIL**
- Last-period stability: **PASS**
- PF at least best standalone reference: **PASS**
- Drawdown at least best standalone reference: **PASS**
- GANN timing does not reduce PF: **PASS** (but incremental timing value is not isolated in V1)
- Regime Gate does not worsen drawdown: **PASS**
- Overall: **FAIL**

## Required V2 validation before production
1. Extend strict V16 walk-forward history so the evaluation contains a true 60 sessions.
2. Keep the no-fixed-count design, but define a calibrated V16 **quality qualification threshold** rather than allowing nearly the whole market through. The threshold must be pre-specified and tested out-of-sample; it must not be chosen to optimize this result.
3. Separate raw intersection entry rules from GANN timing rules so GANN's incremental value can be measured directly.
4. Re-run the same locked acceptance criteria without post-result threshold tuning.
