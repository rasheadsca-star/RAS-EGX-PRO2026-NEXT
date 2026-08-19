# TFE V20 Fusion RC2 — Developer Handoff

RC2 is the merged research engine inside `develop/v20-integrated-decision-platform`. It preserves the strongest parts of the original standalone EGX scorer while retaining the TFE hard-gate architecture, full-market scan, V20 provenance, V17 safety overlay, publication controls, and recorded-session simulator.

It does **not** modify MAIN APP, V17, or the existing V20 Native engine.

## What RC2 merges

### Preserved from the original standalone engine

- The original `scoreBars()` technical core.
- SMA50 / SMA200 trend logic.
- RSI(14).
- MACD histogram / acceleration.
- ATR volatility penalty.
- Volume confirmation.
- Explainable component-by-component technical breakdown.

### Preserved from TFE RC1

- Full-market fresh-history universe.
- Fail-closed data-quality gate.
- Liquidity eligibility.
- Multi-method support/resistance confluence.
- Entry zone, stop, T1 and structural T2.
- Structural net R/R floor after modeled transaction cost.
- `DO_NOT_CHASE` / `BELOW_ENTRY_WAIT` hard rejection.
- Price-reconciliation publication hold.
- V20 Native as provenance only, never a scoring input.
- V17 safety overlay, never an execution override.
- Next-session-only, STOP_FIRST recorded-session simulation.

### Added in RC2

- Per-symbol historical-confidence layer using Wilson 95% lower bound.
- Evidence-aware weighting: Wilson can contribute **0% to 25%** of ranking depending on sample reliability; missing historical evidence is neutral, not treated as zero quality.
- Historical confidence is calculated **only after all hard gates pass** and can never rescue a stale, illiquid, low-score, poor-R/R, or DO_NOT_CHASE setup.
- Decision Log JSON/CSV including actual fusion weights, historical sample size, Wilson confidence, trade plan, quality state, V17 status, and runtime source commit.
- New anti-rescue/adversarial regression tests.

## Immutable research-only contract

- `researchOnly = true`
- `executionAllowed = false`
- `productionAllocation = false`
- `automaticOrders = false`
- `automaticChampionPromotion = false`

V17 cannot turn execution on. V20 Native cannot become a TFE scoring input.

## Fixed hard gates

- Minimum history: **60 sessions**
- Original technical score: **>= 70**
- Research score: **>= 72**
- Liquidity score: **>= 55** plus liquidity eligibility
- S/R confluence: **>= 55** with at least **2 strong methods**
- Structural net R/R: **>= 0.70** after **0.60%** round-trip modeled cost
- Maximum pullback distance: **0.70 ATR**
- Entry expiry: **3 sessions**
- Maximum hold: **10 sessions**
- T1: **0.8R precision target capped by structural resistance**
- T2: structural resistance
- Same-bar target/stop ambiguity: **STOP_FIRST**

## Fusion ranking

Ranking occurs only after hard-gate eligibility.

- Research weight range: **75%–100%**
- Wilson historical-confidence weight range: **0%–25%**
- Full Wilson weight requires at least **5 qualifying historical trades**
- With zero qualifying historical trades: `Fusion Rank = Research Score`

This avoids the two failure modes found during destructive review: historical results rescuing an invalid current setup, and missing historical evidence unfairly acting like a zero score.

## Production review runtime

`https://egx-tfe-v20-fusion-rc2.vercel.app`

Reviewed runtime source commit:

`779b336d4baf52d9185b2c05da24033231a75730`

Every runtime response exposes `x-tfe-source-commit` so the reviewer can match deployed behavior to reviewed source.

## Endpoints

- `/health`
- `/scan?limit=20`
- `/analyze?ticker=ETEL`
- `/simulate?ticker=ETEL`
- `/simulate?scope=market&symbols=220`
- `/decision-log?format=json&limit=50`
- `/decision-log?format=csv&limit=50`
- `/ablation`

## Final RC2 audit — 2026-08-19

The exact final source commit was loaded into an independent runtime audit harness.

- Syntax checked files: **13/13 passed**
- Tests: **53/53 passed**
- Failed: **0**

The RC2-specific destructive checks include explicit tests that Wilson/historical confidence cannot rescue:

- stale data
- illiquid data
- technical score below the gate
- structural R/R below 0.70
- DO_NOT_CHASE
- an otherwise ineligible item with a synthetic Fusion score of 100

It also verifies that missing historical evidence is neutral and that historical weight increases gradually with sample reliability.

## Current full-market scan

Session: **2026-08-19**

- Scanned: **188**
- Technically eligible: **4**
- Publishable research candidates: **3**
- Withheld for price reconciliation: **1**
- Rejected by hard gates: **184**

Current publishable research candidates:

1. `COPR` — Pending Pullback
2. `FAIT` — Pending Pullback
3. `MPCO` — Pending Pullback

`MILS` is technically eligible but withheld because its current price-conflict signal exceeds the publication threshold.

The three current publishable candidates have no completed historical trades matching **all** RC2 hard gates inside the currently recorded history window. RC2 therefore assigns Wilson weight = 0 and leaves their Fusion Rank equal to Research Score. It does not invent confidence.

## Recorded full-market simulator — RC2

- Symbols completed: **188/188**
- Errors: **0**
- Entered trades: **64**
- T1 hit rate: **73.4%**
- Stop rate: **18.8%**
- Positive trade rate: **73.4%**
- Average net result after 0.60% modeled round-trip cost: **+1.23% per entered trade**
- Profit factor: **2.33**
- Wilson 95% lower bound for T1 hit rate: **61.5%**

## RC1 → RC2 comparison

| Metric | RC1 | RC2 | Change |
|---|---:|---:|---:|
| Entered trades | 120 | 64 | -46.7% |
| T1 hit rate | 65.8% | 73.4% | +7.6 pp |
| Stop rate | 27.5% | 18.8% | -8.7 pp |
| Avg net / entered trade | +0.66% | +1.23% | +0.57 pp |
| Profit factor | 1.49 | 2.33 | +0.84 |
| Wilson 95% lower T1 | 57.0% | 61.5% | +4.5 pp |

RC2 is deliberately more selective. The historical evidence currently shows a meaningful improvement in quality metrics in exchange for materially fewer trades. This is a trade-off, not a free improvement, and must be tracked forward.

## Review status

RC2 is suitable for **research/shadow operation** and third-party review now. It is not certified for automatic execution or Champion promotion.

Historical results are evidence, not a guarantee. Forward out-of-sample sessions must be accumulated without tuning on them before any promotion decision.

See `docs/VALIDATION_REPORT.md` for the destructive-review record and rejected failure modes.
