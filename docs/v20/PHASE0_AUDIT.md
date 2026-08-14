# EGX PRO V20 — Phase 0 Audit & Reuse Map

## Verified references

- V16 frozen: `release/v16.9.2-frozen-20260806` @ `2351b2ec2bbcf3e36e992021e26b36845e879ab0`
- V17 governance: `develop/v17-rebuild` @ `abd76acb3dc0b472e4f8de985aba7a6c45f87c16`
- V19 research challenger: `v19-egx-chat-gpt` @ `fb5aafb3e3e4cd908831a7cb98de3f952e356c34`
- V18 external reference: `https://egxpro18-r2qgzpdf.manus.space/`

## Lineage result

`develop/v17-rebuild` is 195 commits ahead of the V16 frozen reference and not behind it. `v19-egx-chat-gpt` is 37 commits ahead of V17 and not behind it. Therefore V20 is based on V19 so the integration branch inherits the verified V17 governance spine and V16 history without mutating any reference branch.

## Reuse map

### Reuse without semantic changes

- V16: `V16_9_EQUAL_WEIGHT_BASKET` as production Champion reference and its evidence files.
- V17: canonical session truth, resilient session gate, internal OHLC S/R, liquidity gate, immutable ledger, conservative daily-candle ambiguity, allocation guard, critic/review principles.
- V19: probability/risk-aware challenger outputs, inverse-volatility research weighting and dynamic risk-budget research overlay. These remain shadow/research only.

### Refactor / wrap

- Legacy opportunity rows can say `executionAllowed=true` before the final V17 gate is applied. V20 adds a global fail-closed override so no row can be ACTIONABLE unless the final execution grade is true.
- Legacy score/confidence fields are preserved for auditability but explicitly labelled legacy. V20 separates opportunity score, data confidence and execution confidence.
- Portfolio exposure is controlled by the final governance gate; when execution is not ready, recommended exposure is forced to 0% and cash to 100%.

### Do not reuse as production evidence

- V19 benchmark dominance is not fresh independent evidence. Its own frozen lock requires new forward evidence before production review.
- V18 performance claims are not accepted until the external application and its reports can be audited and the inconsistent trade-count definitions are reconciled.
- Any source or report that cannot prove session, provenance and freshness remains research/reference only.

## Current verified state at integration start

V17 final state is `DEGRADED`, `sessionAligned=true`, `executionGrade=false`, internal S/R coverage 92.5%, freshness 91.25%, critical fields 92.5%, with one critical external S/R conflict and six missing S/R symbols. Research is allowed; execution is not.

V19 V6 is frozen as `SHADOW_RESEARCH_ONLY`; automatic promotion and production promotion are false. Its architecture explicitly records that the reused benchmark is not fresh independent evidence.

## V18 audit state

The V18 URL has been recorded as the independent UI/analysis/backtest/reporting reference. Browser access from the current execution environment is unavailable, so the V18 visual/functional audit remains `PENDING_BROWSER_ACCESS`. This must not block the governance/data integration stages, but no V18 performance claim may enter the production evidence layer before that audit is complete.
