# EGX PRO V20 — Research Release Report

## Release identity

- Product: **EGX PRO V20 — Integrated Investment Decision Platform**
- Branch: `develop/v20-integrated-decision-platform`
- Persisted evidence head after validated release: `196671922074bcc05ef6ab6d089c319a3de77e75`
- Validated source commit: `aaf6190352ad052ef2d3fa665fdd2d6885839fc9`
- Main validation run: `31849558384` (run number 50)
- Decision session: `2026-08-13`
- Release classification: **`RESEARCH_RELEASE_CANDIDATE_EXECUTION_BLOCKED`**
- Independent final status: **`RESEARCH_PLATFORM_READY_EXECUTION_NOT_READY`**

This is a research and investment-decision-support release candidate. It is **not** an Execution Grade release, is **not** a profitability claim, and has **not** been deployed to a dedicated public V20 target.

## Acceptance result

The independent critic passed **14/14 validators** with:

- critical findings: 0
- research blockers: 0
- production blockers: 5
- research platform ready: true
- execution ready: false
- applied production exposure: 0%
- cash: 100%

The active production Champion remains `V16_9_EQUAL_WEIGHT_BASKET`. V19 remains a shadow/research challenger and automatic promotion is disabled.

## Current production blockers

Execution Grade remains blocked by the authoritative V17 gate for exactly these reasons:

1. `INTERNAL_SR_COVERAGE_BELOW_95`
2. `INTERNAL_SR_FRESHNESS_BELOW_98`
3. `CRITICAL_FIELDS_BELOW_95`
4. `CRITICAL_SOURCE_CONFLICT`
5. `INTERNAL_SR_NOT_EXECUTION_CANDIDATE`

V20 does not override these blockers. A BULLISH market regime, a high research score, local portfolio holdings, or a local row-level flag cannot open the execution gate.

## Market and data coverage

- master universe: 227 symbols
- current-session rows: 215 / 227 = 94.71%
- semantically complete current rows: 182
- semantically partial current rows: 33
- current opportunity scope: 30
- MARKET_ONLY scope: 197

No stale/misaligned price is presented as current. Non-positive/missing OHLC remains null rather than being fabricated as zero.

## Technical evidence

### Full technical set

Full point-in-time technical evidence (RSI/MACD/ATR/SMA/EMA/momentum) is intentionally narrower:

- 21 / 30 opportunity symbols current-ready = 70%
- 21 / 227 of the full market universe = 9.25%

Only session-aligned, price-reconciled, point-in-time trusted OHLC can drive the current technical component.

### Verified full-market trend context

A separate current Market Trend Context is now available from the verified Market Regime evidence:

- 151 / 227 symbols = 66.52% of the full market universe
- 130 MARKET_ONLY symbols receive verified current trend context
- fields include SMA20/SMA50, 1/5/20-session return context, volatility20 and relative volume where verified

This context is **not** labeled a full technical indicator set and cannot create a V20 Research Score, recommendation status, ACTIONABLE state, production allocation, or Execution Grade.

## Decision Intelligence

V20 Research Decision Intelligence is explicitly `SHADOW_RESEARCH_ONLY_UNCALIBRATED`.

Score semantics are separated from confidence and permission:

**Score ≠ Confidence ≠ Execution Permission**

The score uses transparent research components:

- legacy opportunity reference: 25%
- current data evidence: 20%
- liquidity: 15%
- support/resistance evidence: 10%
- conservative Net R/R after transaction costs: 15%
- trade-plan current-price alignment: 10%
- current point-in-time technical evidence: 5%

Defensive caps prevent high legacy scores from masking invalid/rebuild-required plans, source conflicts, missing critical evidence, or do-not-chase states. The research score cannot infer Model Confidence, open the V17 gate, create ACTIONABLE, alter position weight, replace the Champion, or promote a Challenger.

## Risk/reward and trade-plan truth

The primary R/R metric is conservative Net R/R after the central 0.60% round-trip cost. Legacy R/R remains audit-only.

- 20 / 30 legacy R/R rows materially differ from the current conservative methodology.
- trade-plan alignment is fail-closed.
- ACTIONABLE requires current price inside the issued entry range and the authoritative global execution gate to be open.
- price above range is do-not-chase.
- hard price-scale/staleness mismatch requires plan rebuild without inventing a corporate-action cause.

## Performance and forward evidence

Performance evidence remains separated by evidence class. There is no single blended headline return.

- V19 Development OOS: 58 sessions, average net return -0.2242%, PF 0.669, DD -17.775%.
- V19 reused 20-session benchmark: average net return +2.0925%, explicitly non-independent/post-hoc and not promotion evidence.
- V18 performance evidence: not accepted because the reference remains inaccessible to reproducible audit.
- V20 forward tracking: 10 evaluation horizons currently pending, 0 resolved.

Pending returns remain null. Research opportunity outcomes never become production portfolio performance.

## Market Regime

For the current V20 decision session the verified Market Regime is BULLISH with 151 / 227 trusted participants. The UI also discloses the weaker same-session breadth (64 advances / 82 declines). Market Regime is analytical context only and has no execution-gate or automatic production-risk-budget influence.

## Browser and UI acceptance

Real Chrome runtime acceptance passed on Google Chrome 151.0.7922.108.

Validated viewports:

- 1440 × 1000
- 1024 × 900
- 768 × 900
- 430 × 900
- 390 × 844

The checks verified page loading, Opportunity Workbench, MARKET_ONLY no-fake-score behavior, Health Center, Performance page, no runtime/console errors, and no horizontal overflow at the tested viewports. Screenshots were captured and hashed by the runner.

This is not presented as a human pixel-perfect visual review.

## Sector provenance

Production-verified sector classification remains **0 / 227**. Sector concentration is therefore disabled in production. Seed maps and name/ticker keyword inference are not accepted for production sector risk.

## User portfolio

The user's portfolio is a local monitoring layer only:

- browser localStorage only
- current-session valuation only
- no stale-price fallback
- no server/repository persistence
- no automatic orders
- no automatic buy/sell instructions
- no influence on ranking, model allocation, Champion, or execution gate

## Source and health center

`v20/health.html` is the read-only Decision & Source Health Center. Production blockers are taken only from authoritative V17 `gate.reasons`; contextual warnings are kept separate from execution blockers.

## Deployment readiness

### Vercel

The connected Vercel workspace was audited and exposed Optimum projects only. No dedicated EGX/V20 project was found. Reusing an unrelated Optimum project for V20 is prohibited.

### GitHub Pages

The repository already has a public GitHub Pages site sourced from `main:/` and deployed by the protected `EGX V16.9 Protected App Deploy` workflow. That workflow checks out `main` and uploads the repository as the protected V16.9 application. V20 must not replace or repurpose that Pages environment.

Therefore the current V20 release deployment state is:

**`NOT_DEPLOYED_FROM_V20_RELEASE`**

A public V20 deployment requires a dedicated, isolated hosting target that does not modify or replace V16/V17/V19/main production assets.

## Daily automation readiness

The audited V17 market-data workflow available from the V20 branch has manual/push triggers but no verified end-to-end schedule. A V20-only cron would not guarantee fresh upstream V17 evidence and could merely rebuild stale upstream inputs. Default-branch modification is outside the V20 safety boundary.

Current automation status:

**`MANUAL_OR_EXTERNAL_ORCHESTRATION_REQUIRED`**

## Release claims explicitly forbidden

Until the underlying evidence changes, V20 must not claim:

- Execution Grade
- deployed/production V20 hosting
- profitability
- V18 audited performance
- pixel-perfect human visual acceptance
- production sector concentration
- automatic Challenger promotion

## Release evidence

The persisted machine-readable authority is:

- `data/v20/regression.json#finalAcceptance`
- `data/v20/regression.json#releaseManifest`
- `data/v20/regression.json#releaseManifestRegression`

The Release Manifest Regression must stay green and prevents execution/deployment/performance claims from exceeding the verified evidence.
