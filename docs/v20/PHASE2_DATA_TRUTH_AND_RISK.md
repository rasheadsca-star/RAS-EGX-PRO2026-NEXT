# V20 Phase 2 — Data Truth, Cost-Aware Trade Plans, and Portfolio Risk

## Scope

This phase remains isolated to `develop/v20-integrated-decision-platform`. It does not modify V16, V17, V19, or `main`.

## Added layers

### 1. Policy Registry

`data/v20/policy-registry.json` centralizes:

- V17 final execution gate authority.
- 0.60% conservative round-trip transaction-cost policy.
- Champion-compatible production allocation rules.
- hard 50% total allocation cap.
- four-position / 12.5% single-position caps.
- separation of production weighting from adaptive shadow research.
- confidence dimensions and fail-closed rules.

Net R/R is now calculated after costs but is not silently promoted into a new production gate. Production gating remains governed by V17 and the frozen Champion policy until independent calibration exists.

### 2. Model Registry

`data/v20/model-registry.json` explicitly records:

- V16.9 as the protected production Champion reference.
- V17 as governance/data-truth/execution-gate authority.
- V19 V6 as shadow research only, with no automatic promotion and no accepted fresh independent evidence.
- V18 as an external UI/analysis/reporting reference whose performance evidence remains unaccepted pending audit.

### 3. Data Truth Builder

`scripts/v20/build-data-truth.cjs` derives V20-only evidence:

- `data/v20/master-universe.json`
- `data/v20/current-market-snapshot.json`
- `data/v20/source-health.json`

It preserves source provenance and does not claim V20 can upgrade V17 execution quality.

### 4. Cost-Aware Trade Plans

`scripts/v20/build-integrated-decision-snapshot.cjs` now separates:

- opportunity score
- market confidence
- data confidence
- model confidence
- execution confidence

For long trades, risk math uses `entryHigh` conservatively and applies the centralized round-trip cost to both net reward and net risk.

### 5. Portfolio Risk Engine

`scripts/v20/build-portfolio-risk.cjs` creates:

- a production plan using Champion-compatible equal weighting only when the global execution gate is open.
- a separate quality-weighted shadow research plan that is never applied to production.
- zero applied exposure and 100% cash whenever the global V17 execution gate is closed.

### 6. Regression

`scripts/v20/regression.cjs` now checks:

- Champion protection.
- no automatic promotion.
- local row flags cannot override the global gate.
- no applied exposure while the V17 gate is closed.
- allocation and per-position caps.
- net R/R cannot exceed gross R/R after costs.
- shadow weights never leak into production.
- V20 data-truth session consistency.

## Current expected behavior

With the current V17 state still non-execution-grade, V20 must remain `RESEARCH_ONLY`, produce no `ACTIONABLE` rows, keep applied portfolio exposure at 0%, and keep 100% cash. Shadow research allocations may be displayed only as research evidence.
