# TFE V20 Fusion RC1 — Validation & Destructive Critic Report

Date: 2026-08-19

## Final release audit

The exact deployed source revision was loaded by an independent Vercel test runner and executed with Node's test runner.

- Total tests: **38**
- Passed: **38**
- Failed: **0**
- Destructive/adversarial tests: **15/15 passed**

Core invariants covered:

- immutable `RESEARCH_ONLY` permissions
- V17 can never override the execution lock
- no caller-input mutation
- invalid-OHLC rejection
- duplicate-date suppression
- stale/update-failed history fails closed
- explicit symbol-identity failure fails closed
- corporate-action and unofficial-seed safety blocks
- stale local-reference divergence is review evidence rather than a false identity block
- `latest_close_conflict >= 20%` creates a publication hold requiring reconciliation
- deterministic ranking
- V20 Native score remains provenance only
- next-session-or-later simulator entry
- 0.60% round-trip cost included
- conservative `STOP_FIRST` same-bar ambiguity
- structural net R/R floor >= 0.70
- pullback distance cap <= 0.70 ATR
- precision T1 never exceeds structural T2

## Freshness architecture

The original V20 Native discovery snapshot available to the branch is dated 2026-08-16, while V17 is dated 2026-08-13. RC1 therefore does not restrict the current scan to that older candidate list.

The final scanner uses the recorded full-market history summary to create a fresh current universe and only keeps symbols that:

- have verified symbol identity in the history layer
- have at least 60 recorded sessions
- are not marked stale or update-failed
- have a last recorded session equal to the market's latest recorded session

V20 Native is then attached as an overlay/provenance source where a symbol matches. It does not supply the TFE ranking score.

Final current universe on 2026-08-19: **188 symbols**.

## Historical simulation methodology

Historical experiments use the repository's recorded daily OHLC/volume files. For every signal:

- indicators are calculated only from bars available at the signal date
- entry is allowed from the following session onward
- pending entry expires after three sessions
- maximum holding period is ten sessions
- a 0.60% round-trip transaction cost is charged
- if target and stop are both inside one daily candle, the simulator records the stop first
- present-day quality warnings and present-day symbol-verification metadata are deliberately excluded from past signals to avoid metadata look-ahead

## Final full-market recorded simulator

The final fixed policy was simulated across all 188 current-history candidates.

- Symbols requested: **188**
- Symbols completed: **188**
- Errors: **0**
- Entered trades: **120**
- T1 hit rate: **65.8%**
- Stop rate: **27.5%**
- Positive trade rate: **65.8%**
- Average net result: **+0.66% per entered trade** after the 0.60% modeled round-trip cost
- Profit factor: **1.49**
- Wilson 95% lower bound for T1 hit rate: **57.0%**

This is the principal historical evidence for RC1. It is materially more informative than the earlier tiny per-symbol samples, but remains historical evidence rather than a promise of future results.

## Final current scan

Current scan result on session 2026-08-19:

- scanned: **188**
- technically eligible: **11**
- publishable research candidates: **10**
- withheld for price reconciliation: **1**
- rejected by technical/quality gates: **177**

The withheld candidate was `MILS`, where the technical setup passed but `latest_close_conflict` exceeded the 20% publication threshold. RC1 keeps the setup visible for audit but refuses to publish it as a research candidate until price reconciliation.

All current candidates remain research-only; broker execution, allocation, order placement and automatic Champion promotion are disabled.

## Destructive critic findings during development

### 1. Over-conservative first RC — rejected

The first candidate required structural net R/R >= 1.25. On a 10-symbol diagnostic set it produced zero entered trades. This was rejected as impractical rather than reported as "zero losses". The gate funnel showed R/R was the choking constraint.

### 2. In-sample optimizer — rejected for overfit

A constrained optimizer produced an 86.4% T1 development result on 22 entries, but a new blind-symbol holdout fell to 50% T1 on four entries. The profile was rejected as overfit.

### 3. Broader unseen checks

A separate unseen-symbol test produced 14 entries with 42.9% T1 overall; the later out-of-time slice produced 44.4% T1, +1.25% average net and PF 1.74 on nine entries. Positive expectancy alone was not treated as sufficient evidence of high precision.

A later cross-validated precision experiment produced 75% T1 on 48 development entries but one fold was materially weak. On a new 27-symbol blind set it produced 17 entries with 64.7% T1, 23.5% stop rate, +0.38% average net and PF 1.27. This improved profile was still not promoted as a guaranteed hit-rate.

A stricter all-fold rule left no eligible optimized profile. A following blind sample happened to show 75% T1 on eight entries, but because the development gate had no valid winner this result was explicitly rejected as approval evidence.

### 4. False hard-block from stale local reference — found and fixed

An intermediate critic pass noticed large `symbolVerification.evidence.localDifferencePct` values and initially converted them into hard blocks. That change then rejected almost the entire market.

Inspection of the upstream history builder showed why: the local-reference adapter can return a cached reference, while `latest_close_conflict` is calculated without guaranteeing that the local reference date equals the Yahoo latest-session date. Exact symbol/exchange/currency verification may still be valid even when the cached local price is old.

The intermediate hard-block was therefore rejected as a false-negative bug. Final behavior:

- explicit symbol identity failure => hard block
- stale/update failure/corporate-action/unofficial seed => hard block
- local-reference price divergence with otherwise verified identity => REVIEW
- very high close conflict >=20% => publication hold requiring price reconciliation

### 5. Runtime branch-cache drift — found and fixed

An early Vercel loader fetched source by branch name and briefly received an older raw GitHub branch representation. This created a deployment/source ambiguity.

Final runtime fetches an **immutable commit SHA**, and every response carries `x-tfe-source-commit`. The deployed application and the developer-review source can therefore be matched exactly.

### 6. UI schema drift — found and fixed

After separating technical eligibility from publication eligibility, the dashboard KPI still referenced the old `eligibleTotal` response field. The API was correct but the KPI could display `NaN`.

The UI was corrected to use `publicationEligibleTotal` and now also exposes `withheldForPriceReconciliation` explicitly.

## Why RC1 uses the fixed policy

The final RC uses fixed, reviewable thresholds instead of selecting the best historical profile after seeing holdout results:

- Core >= 70
- Fusion research >= 72
- Liquidity >= 55 and eligible
- S/R confluence >= 55 with at least two strong methods
- Structural net R/R >= 0.70 after costs
- Pullback distance <= 0.70 ATR
- Precision T1 = 0.8R capped at structural resistance
- Structural resistance retained as T2

This is deliberately less optimized than the best in-sample profile. The objective is a practical research engine whose failure modes are visible and whose numbers are not dressed up for review.

## Remaining evidence requirement

RC1 is suitable for live **research/shadow operation now**. It is **not** certified for automatic execution or Champion promotion. Future promotion must use fresh, pre-declared out-of-sample evidence and must not reuse previously opened blind sets for tuning.
