# TFE V20 Fusion RC2 — Validation & Destructive Critic Report

Date: 2026-08-19

## Final reviewed runtime

Production review URL:

`https://egx-tfe-v20-fusion-rc2.vercel.app`

Runtime source commit:

`779b336d4baf52d9185b2c05da24033231a75730`

The runtime is pinned to this immutable commit and returns it through the `x-tfe-source-commit` header.

## Final audit

The exact final source commit was fetched by an independent Vercel audit runtime.

- Syntax-checked modules/files: **13/13 passed**
- Tests: **53**
- Passed: **53**
- Failed: **0**

The suite contains the complete RC1 regression/adversarial coverage plus RC2 tests for the restored original scorer, Wilson confidence, evidence-aware weighting, and historical-confidence anti-rescue invariants.

## What was merged for RC2

RC2 deliberately combines three strengths from the reviewed standalone engine with the existing TFE architecture:

1. **Original `scoreBars()` restored as the technical core**
   - SMA50 / SMA200
   - RSI(14)
   - MACD
   - ATR volatility penalty
   - volume confirmation
   - explainable breakdown

2. **Wilson historical confidence**
   - historical T1 success is not accepted at face value
   - Wilson 95% lower bound penalizes tiny samples
   - historical confidence is evaluated only after current hard-gate eligibility

3. **Decision Log**
   - JSON/CSV snapshot contains rank, price, technical score, research score, Fusion score, actual Fusion weights, liquidity, S/R, entry, stop, T1/T2, R/R, historical sample, Wilson, quality state, V17 status, and runtime source commit

## Hard-gate precedence

Historical success is never allowed to rescue a current setup that fails one of the following:

- data quality
- original technical score < 70
- research score < 72
- liquidity score/eligibility
- S/R confluence
- trade-plan availability
- structural net R/R < 0.70
- `DO_NOT_CHASE`
- `BELOW_ENTRY_WAIT`

Dedicated RC2 tests prove these anti-rescue rules.

## Evidence-aware Wilson weighting

The first RC2 implementation used a fixed 75% Research / 25% historical component. Destructive review found an important statistical issue: a symbol with **no** qualifying historical trades was effectively penalized as if its historical quality were zero.

That behavior was rejected and fixed.

Final behavior:

- no historical evidence => historical weight = 0%, Research weight = 100%
- partial sample => Wilson weight increases gradually
- >= 5 qualifying historical trades => maximum Wilson weight = 25%
- missing evidence is **neutral**, not negative evidence
- Wilson can never bypass the hard gates

The runtime exposes each recommendation's actual `fusionWeights` for audit.

## Historical simulator methodology

For every signal:

- only bars available at the signal date are used
- current metadata/warnings are excluded from historical signals to prevent metadata look-ahead
- entry begins the next session or later
- pending entry expires after 3 sessions
- maximum hold is 10 sessions
- 0.60% round-trip modeled cost is charged
- if stop and T1 are both inside one daily bar, the simulator uses **STOP_FIRST**
- the same hard-gated technical/trade-plan logic is reused in historical simulation

## RC2 full-market recorded simulation

Universe: **188 current-history symbols**

- Symbols completed: **188/188**
- Errors: **0**
- Entered trades: **64**
- T1 hit rate: **73.4%**
- Stop rate: **18.8%**
- Positive trade rate: **73.4%**
- Average net result: **+1.23% per entered trade** after modeled costs
- Profit factor: **2.33**
- Wilson 95% lower bound for T1 hit rate: **61.5%**

These are historical research results, not a forecast or guarantee.

## RC1 vs RC2

| Metric | RC1 | RC2 | Difference |
|---|---:|---:|---:|
| Entered trades | 120 | 64 | -46.7% |
| T1 hit rate | 65.8% | 73.4% | +7.6 pp |
| Stop rate | 27.5% | 18.8% | -8.7 pp |
| Positive trade rate | 65.8% | 73.4% | +7.6 pp |
| Avg net / trade | +0.66% | +1.23% | +0.57 pp |
| Profit factor | 1.49 | 2.33 | +0.84 |
| Wilson 95% lower T1 | 57.0% | 61.5% | +4.5 pp |

Interpretation: RC2 is materially more selective. Historical precision, average net result, profit factor and confidence lower bound improved, while trade count fell materially. This trade-off must be evaluated with forward data rather than optimized further on the same history.

## Current market scan — 2026-08-19

- Scanned: **188**
- Technically eligible: **4**
- Publishable: **3**
- Withheld for price reconciliation: **1**
- Rejected by hard gates: **184**

Publishable research candidates:

1. `COPR` — `RESEARCH_PENDING_PULLBACK`
2. `FAIT` — `RESEARCH_PENDING_PULLBACK`
3. `MPCO` — `RESEARCH_PENDING_PULLBACK`

`MILS` passed technical gates but is withheld for price reconciliation because the high-conflict publication threshold was triggered.

The current three publishable candidates have zero completed historical trades matching **all** RC2 hard gates inside the currently available history window. Final RC2 therefore assigns historical weight = 0 and does not manufacture a Wilson estimate for them.

## Destructive-review issues inherited from RC1 and retained as fixes

### Over-conservative R/R profile

An early policy requiring R/R >= 1.25 produced zero entered trades. Rejected.

### Overfit optimizer

An 86.4% development result fell to 50% on a new blind sample. Rejected.

### False hard block from stale local reference

Local price-reference divergence was initially treated as identity failure and blocked almost the market. Upstream reference freshness did not justify that assumption. Final behavior separates identity failure from price-reconciliation review.

### Branch-cache/runtime drift

Fetching runtime source by branch name created source ambiguity. Final deployments use immutable commit SHAs.

### UI/API schema drift

A KPI once used an outdated API property after eligibility was split into technical and publication states. Fixed and regression-reviewed.

## New destructive-review findings in RC2

### Uploaded-engine ranking could bypass intended policy

Review of the standalone merged candidate showed that ranking could remain allowed despite cases such as low R/R, stale data, weak liquidity, weak technical score, or `DO_NOT_CHASE`. RC2 does not adopt that ranking behavior; those conditions are hard gates before historical confidence.

### Missing-history penalty

The first RC2 Fusion implementation treated absence of historical evidence as zero historical quality. This was caught before final release and changed to evidence-aware dynamic weighting.

### Metadata transparency

Runtime ranking metadata and Decision Log were updated to expose adaptive weight ranges and the actual per-recommendation weights so documentation and behavior are auditable.

## Safety invariants

The final runtime keeps:

- `researchOnly = true`
- `executionAllowed = false`
- `productionAllocation = false`
- `automaticOrders = false`
- `automaticChampionPromotion = false`

V17 cannot unlock execution. V20 Native is discovery/provenance only and cannot directly change the TFE score.

## Release judgment

**RC2: PASS for research/shadow operation and third-party review.**

It is **not** approved for automatic execution or automatic Champion promotion.

The next legitimate evidence step is forward out-of-sample tracking using frozen RC2 logic. Previously opened historical/blind sets must not be reused to tune thresholds for a claimed forward result.
