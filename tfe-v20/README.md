# TFE V20 Fusion RC2 — Developer Handoff

`TFE_V20_FUSION_RC2` is the research/shadow engine in branch `develop/v20-integrated-decision-platform`, under `tfe-v20/`. It combines a frozen standalone-reference technical scorer with TFE hard gates, data-quality controls, liquidity and support/resistance validation, trade-plan construction, evidence-aware Wilson ranking, V20/V17 overlays, recorded-session simulation, Decision Log, and the V16.9 professional UI adapter.

It does **not** modify MAIN APP, V16 production source, V17 source, or V20 Native source. It is **not approved for automatic execution or automatic Champion promotion**.

## Provenance and build history

The `tfe-v20/` tree was assembled rapidly during 19–20 August 2026. It must not be described as a long-hardened production engine.

The files `src/originalScore.js` and `src/originalIndicators.js` are the technical scorer/indicator implementation **adopted from the standalone reference implementation and frozen inside RC2**. The phrase means RC2 intentionally keeps that implementation stable while layering TFE gates around it; it does **not** mean those files existed historically in this repository before RC2 was assembled.

## Alpha / overlay separation

RC2 now uses explicit data-source separation:

- **Alpha market-history branch:** `main`
  - `data/history-summary.json`
  - `data/history/<ticker>.json`
- **Overlay branch:** `develop/v20-integrated-decision-platform`
  - V20 Native discovery/provenance snapshots
  - V17 safety overlay and recorded research diagnostics

Market-history scoring never falls back to the overlay branch. V20 Native remains discovery/provenance only and is not an Alpha scoring input. V17 can never enable execution.

Remote JSON loading uses a short in-process cache (default 5 minutes), ETag conditional requests when available, a 10-second timeout, and two bounded retries. These are operational hardening only and do not alter scores or recommendations.

## Technical core

The frozen reference `scoreBars()` technical core uses:

- SMA50 / SMA200 trend logic
- RSI(14)
- MACD histogram / acceleration
- ATR volatility penalty
- Volume confirmation
- Component-level explainability

The same scorer is used by live analysis and recorded historical simulation.

## Immutable research-only contract

- `researchOnly = true`
- `executionAllowed = false`
- `productionAllocation = false`
- `automaticOrders = false`
- `automaticChampionPromotion = false`

## Fixed hard gates

These thresholds are unchanged by the hardening work:

- Minimum history: **60 sessions**
- Technical score: **>= 70**
- Research score: **>= 72**
- Liquidity score: **>= 55** plus liquidity eligibility
- S/R confluence: **>= 55** with at least **2 strong methods**
- Structural net R/R: **>= 0.70** after **0.60%** modeled round-trip cost
- Maximum pullback distance: **0.70 ATR**
- Entry expiry: **3 sessions**
- Maximum hold: **10 sessions**
- T1: **0.8R precision target capped by structural resistance**
- T2: structural resistance
- Same-bar target/stop ambiguity: **STOP_FIRST**
- `DO_NOT_CHASE` and `BELOW_ENTRY_WAIT`: hard rejection
- Price conflict >= configured publication threshold: publication hold / reconciliation required

## Fusion ranking

Historical confidence is calculated **only after all current hard gates pass**.

- Research weight range: **75%–100%**
- Wilson historical-confidence weight range: **0%–25%**
- Full historical weight requires at least **5 qualifying historical trades**
- With zero qualifying historical trades: `Fusion Rank = Research Score`

Historical confidence cannot rescue stale, illiquid, low-score, poor-R/R, or alignment-rejected setups. Missing history is neutral rather than a zero-quality penalty.

## Historical evidence warning

Historical statistics are **evidence, not a probability forecast or guarantee of future target achievement**. The currently recorded sample is small and concentrated in a limited market period. Any displayed T1 rate, profit factor, average net return, or Wilson bound must be interpreted as retrospective research evidence only.

Before any real-money use, RC2 requires materially longer history, multiple market regimes (bull/bear/sideways), forward out-of-sample tracking, and stronger official/cross-source market-data verification.

## API security and runtime provenance

Runtime responses now:

- never return JavaScript stack traces to clients on unexpected 500 errors;
- log internal stack details server-side only;
- expose engine identity through `x-tfe-engine`;
- expose the deployment source commit through `x-tfe-source-commit` when `VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA`, or `TFE_SOURCE_COMMIT` is available;
- include `sourceCommit` in `/health`, `/scan`, analysis/simulation responses, and Decision Log rows.

The Decision Log no longer relies on reading an unset response header to infer provenance.

## V16.9 professional UI adapter

The production UI is branded:

**EGX Pro Professional V16.9 UI CLAUDE**

Primary views:

1. Decision Board / recommendation cards and filters
2. Full-market search
3. Experimental local portfolio and position sizing
4. Manual supplemental fundamental worksheet
5. Live evidence / Decision Log / simulator and model-comparison view

Portfolio and fundamental helpers are local/browser-only and are **not Alpha inputs**. UI-only `market-index` and `history` adapters declare `scoringImpact: NONE`.

## Endpoints

- `/health`
- `/scan?limit=20`
- `/analyze?ticker=ETEL`
- `/simulate?ticker=ETEL`
- `/simulate?scope=market&symbols=220`
- `/decision-log?format=json&limit=50`
- `/decision-log?format=csv&limit=50`
- `/ablation`
- `/market-index`
- `/history?ticker=COPR&limit=120`

## Independently reproduced pre-hardening baseline

An independent Claude review on 19–20 August 2026 reproduced the pre-hardening research baseline by running the code rather than trusting documentation:

- tests: **65/65 passed**
- recorded full-market simulator: **64 entered trades**
- T1: **73.4%**
- Stop: **18.8%**
- Avg net after modeled cost: **+1.23%**
- Profit factor: **2.33**
- Wilson 95% lower T1 bound: **61.5%**
- scan: **188 scanned / 4 technically eligible / 3 publishable / 1 withheld**
- publishable at that session: `COPR`, `FAIT`, `MPCO`
- `MILS`: withheld for price reconciliation

Those numbers are a reproduced historical baseline, **not forward accuracy claims**.

## Independent-review hardening — 20 August 2026

The following changes were made without changing `engine.js`, `policy.js`, scoring weights, hard-gate thresholds, trade-plan formulas, or recommendation ranking logic:

1. Sanitized unexpected API error responses; stack traces remain server-side only.
2. Replaced dead Decision Log commit-header inference with real runtime commit provenance.
3. Separated Alpha market-history data (`main`) from V20/V17 overlays (development branch).
4. Added bounded cache / ETag / timeout / retry behavior to remote JSON fetching.
5. Corrected technical-scorer provenance wording and documented the rapid build window.
6. Added API hardening regression tests.

## Review status

Current status remains:

**PASS WITH CONDITIONS for research/shadow use only.**

Not approved for automatic execution, production capital allocation, or automatic Champion promotion. The next evidence milestone is longer, multi-regime, genuinely forward/out-of-sample validation without tuning on those future sessions.
