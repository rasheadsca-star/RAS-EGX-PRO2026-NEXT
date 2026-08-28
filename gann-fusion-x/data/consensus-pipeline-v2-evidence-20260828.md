# EGX Consensus Pipeline V2 — True 60-Session Evidence

Generated from GitHub Actions run `33162869092` on 2026-08-28.

Overall research acceptance: **FAIL** — only first-half stability failed. No production engine or UI was changed.

## Validated architecture
1. V16 qualifies and ranks all stocks that pass its existing execution conditions. No fixed Top-N output is used.
2. SEPA-X qualifies and ranks all stocks that pass its current recommendation conditions. No fixed Top-N output is used.
3. Only the exact ticker intersection of V16-qualified and SEPA-qualified lists is passed to GANN.
4. GANN cannot add stocks and acts as timing/readiness sequencer only. The raw intersection keeps SEPA entry/stop/target; GANN then applies B=wait for trigger and C=wait for pullback while preserving SEPA stop/target.
5. Regime Gate only manages capital exposure with ALLOW / REDUCE_SIZE / WAIT / BLOCK.

## Test validity
- Strict V16 walk-forward output generated 62 sessions after an 11-session initial warm-up.
- The two most recent outputs lack a full 3-session future evaluation window.
- CI asserted exactly **60 evaluable sessions**, from **2026-06-01 through 2026-08-24**.
- Holding period: 3 sessions.
- Round-trip cost: 0.6%.
- Same-bar stop and target: stop-first conservative rule.
- No future leakage is allowed in candidate generation.

## Qualification breadth
- Average V16 qualified/session: **120.50** evaluable candidates (120.90 pre-future-window summary).
- Average SEPA qualified/session: **35.43**.
- Average exact intersection/session: **27.42**.
- At least one common stock existed in **60/60 sessions**.

The V16 gate is therefore broad in this adapter. No fixed stock count should be introduced, but a future production version may need a pre-specified quality qualification threshold rather than accepting almost the full market.

## Full 60-session results
| Engine / stage | PF | Compound % | Max DD % | Positive % | Target % | Stop % | Fill % | Exposure % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| V16 qualified walk-forward | 0.91 | -7.682 | -18.208 | 42.6 | 25.8 | 23.3 | 97.8 | 100.0 |
| SEPA-X qualified proxy | 1.11 | -4.567 | -21.504 | 36.8 | 2.1 | 4.4 | 96.3 | 100.0 |
| GANN current ACTIONABLE | 1.25 | +1.131 | -10.945 | 48.8 | 4.8 | 3.4 | 52.4 | 95.0 |
| Raw V16∩SEPA intersection | 1.18 | -2.038 | -23.870 | 41.0 | 2.3 | 4.5 | 98.8 | 100.0 |
| Intersection + GANN timing only | 1.21 | +0.562 | -13.609 | 42.1 | 4.0 | 0.8 | 54.6 | 100.0 |
| **Final Consensus + Regime Gate** | **1.41** | **+7.463** | **-5.351** | **43.5** | **4.5** | **0.8** | **57.9** | **53.6** |

## Incremental value of GANN timing
Compared with the raw V16∩SEPA intersection:
- PF improved from **1.18 to 1.21**.
- Compound moved from **-2.038% to +0.562%**.
- Max drawdown improved from **-23.870% to -13.609%**.
- Stop hit rate fell from **4.5% to 0.8%**.
- Target hit rate rose from **2.3% to 4.0%**.
- Fill rate fell from **98.8% to 54.6%**, which is expected because GANN waits for trigger/pullback rather than forcing entry.

This supports the intended role of GANN as an execution-timing filter rather than a stock selector.

## Incremental value of the Regime Gate
Compared with the GANN-timed intersection:
- PF improved from **1.21 to 1.41**.
- Compound improved from **+0.562% to +7.463%**.
- Max drawdown improved from **-13.609% to -5.351%**.
- Average capital exposure fell to **53.6%**.

Regime counts over the 60 sessions:
- RISK_ON: 39
- RISK_ON_DETERIORATING: 13
- RANGE: 8
- RISK_OFF: 0

Candidate-level gate actions:
- ALLOW: 870
- REDUCE_SIZE: 409
- WAIT: 368

## First 30 / Last 30 stability
| Window | Final PF | Compound % | Max DD % | Exposure % | Positive % |
|---|---:|---:|---:|---:|---:|
| First 30 | **0.63** | **-3.399** | -5.351 | 27.2 | 29.4 |
| Last 30 | **1.64** | **+11.244** | -3.971 | 80.1 | 48.3 |

The first half remains structurally weak. The final pipeline protects capital well but does not create a profitable edge in that regime. This is the single failed acceptance condition and prevents production promotion.

## Exact V16.9 live common window — 15 sessions
| Engine | PF | Compound % | Max DD % | Positive % |
|---|---:|---:|---:|---:|
| V16.9 LIVE exact | 1.40 | **+14.423** | -5.324 | 53.1 |
| Consensus Final | **1.89** | +8.364 | **-3.971** | 51.2 |

The consensus pipeline improves PF and drawdown on the exact V16 live dates, while V16 remains stronger in raw compounded return. The comparison is not perfectly apples-to-apples because concentration, entry logic, stop/target framework and cash exposure differ.

## Acceptance gate
- PF >= 1.25: **PASS**
- Compound positive: **PASS**
- Max DD >= -15%: **PASS**
- First 30 stable: **FAIL**
- Last 30 stable: **PASS**
- PF at least best standalone reference: **PASS**
- Drawdown at least best standalone reference: **PASS**
- GANN timing does not reduce PF: **PASS**
- Regime Gate does not worsen drawdown: **PASS**
- Overall: **FAIL**

## Research conclusion
The agreed architecture is supported by the test: intersection + GANN timing + Regime protection materially improves risk-adjusted performance and capital preservation. It is not ready for production because the first 30 sessions remain loss-making and the V16 qualification layer is too broad. No fixed Top-N should be introduced; any next qualification refinement must be a pre-specified quality threshold and tested out-of-sample without tuning to these results.
