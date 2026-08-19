# TFE V20 Fusion RC1 — Validation & Destructive Critic Report

Date: 2026-08-19

## Release audit

- Functional/regression tests: 20/20 passed.
- Destructive/adversarial tests: 13/13 passed.
- Total: 33/33 passed.
- Core invariants covered: immutable RESEARCH_ONLY permissions, no input mutation, invalid-OHLC rejection, date de-duplication, stale/update-failed fail-closed behavior, source-conflict blocking, corporate-action blocking, deterministic ranking, V17 inability to override execution lock, next-session-only simulator entry, transaction-cost inclusion, conservative STOP_FIRST same-bar policy, structural RR floor, pullback cap, and T1 <= T2.

## Historical simulation methodology

Historical experiments used the repository's recorded daily OHLC/volume files. Signals were computed only with bars available on the signal date. Entry was allowed from the following session onward. Pending entries expired after three sessions. Trades were capped at ten sessions. A 0.60% round-trip cost was charged. If target and stop were both inside the same daily bar, the simulator scored the stop first.

## Destructive critic findings during development

### 1. Over-conservative first RC

The first candidate required structural net R/R >= 1.25. On a 10-symbol diagnostic set it produced zero entered trades. This was rejected as impractical rather than reported as 'zero losses'. The gate funnel showed R/R was the choking constraint.

### 2. Overfit optimizer rejected

A constrained optimizer produced an 86.4% T1 development result on 22 entries, but a new blind symbol holdout fell to 50% T1 on four entries. The profile was rejected as overfit.

### 3. Broader unseen checks

A separate unseen-symbol test produced 14 entries with 42.9% T1 overall; the later out-of-time slice produced 44.4% T1, +1.25% average net and PF 1.74 on nine entries. Positive expectancy alone was not treated as sufficient evidence of high precision.

A later cross-validated precision experiment produced 75% T1 on 48 development entries but one fold was materially weak. On a new 27-symbol blind set it produced 17 entries with 64.7% T1, 23.5% stop rate, +0.38% average net and PF 1.27. This improved profile was still not promoted as a guaranteed hit-rate.

A stricter all-fold rule left no eligible optimized profile. A following blind sample happened to show 75% T1 on eight entries, but because the development gate had no valid winner this result was explicitly rejected as approval evidence.

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

RC1 is suitable for live research/shadow operation now. It is **not** certified for automatic execution or Champion promotion. Any future promotion must use fresh, pre-declared out-of-sample evidence and must not reuse previously opened blind sets for tuning.
