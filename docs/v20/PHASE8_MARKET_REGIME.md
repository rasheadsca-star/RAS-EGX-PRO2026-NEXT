# V20 Phase 8 — Current Market Regime Evidence

## Objective

Replace the stale market-regime reference in V20 with a point-in-time, full-universe evidence layer without modifying the frozen V16 Champion or allowing regime output to override V17 execution governance.

## Methodology

V20 reuses the frozen V16 `EGX_PRO_MARKET_REGIME_BREADTH_1.0` scoring logic as a methodology reference: advance/decline breadth, percentage above SMA20/SMA50, 5/20-session median momentum and 20-session annualized volatility. V20 maps the reference states to the product vocabulary `BULLISH | NEUTRAL | BEARISH`; `HIGH_VOLATILITY` is retained as an explicit overlay and maps conservatively to `BEARISH` for the three-state UI vocabulary.

## Current-evidence requirements

A symbol participates in the verified regime only when all of the following are true:

- it belongs to the V20 master universe;
- its current market row is aligned to the V20 session and semantically complete;
- it has no current source conflict;
- its history comes from an approved primary OHLC source and passes V20 provenance filtering;
- at least 50 trusted sessions are available;
- the latest trusted history session equals the V20 decision session;
- the latest trusted close reconciles to the current market price within 5%;
- no future rows or synthesized OHLC are used.

The regime is **verified only when at least 60% of the full V20 universe passes those requirements**. The 60% floor is inherited from the V16 methodology's own low-participation warning boundary; it is not presented as a calibrated alpha threshold.

## Governance

- A stale V16 regime is reference evidence only and can never be promoted to the current session.
- Sector leadership is deliberately excluded because V20 Phase 6 found no authoritative sector provenance.
- The market regime does not open the execution gate.
- The market regime does not automatically change production portfolio weights or risk budget.
- V16 remains `V16_9_EQUAL_WEIGHT_BASKET`.
- V19 remains shadow research with no automatic promotion.

## Outputs

- `data/v20/market-regime.json`
- `data/v20/market-regime-regression.json`
- `scripts/v20/build-market-regime.cjs`
- `scripts/v20/market-regime-unit.cjs`
- `scripts/v20/market-regime-regression.cjs`
- `scripts/v20/apply-market-regime-integration.cjs`
- `.github/workflows/v20-market-regime.yml`
- Market Regime panel in `v20/index.html`, wired by `v20/app.js` and covered by `scripts/v20/validate-ui.cjs`.

The dedicated workflow persists only the audited Phase 8 evidence/integration/UI files. Because pushes made by `github-actions[bot]` do not recursively trigger another Actions workflow, final integrated validation is initiated by a subsequent user-authored V20-scoped commit and must run against the persisted evidence head.

## Verified 2026-08-13 evidence

The final Phase 8 evidence build is current to the V20 decision session `2026-08-13` and is classified `BULLISH` with classification score `98`.

- Full V20 universe: 227 symbols.
- Verified regime participants: 151 symbols (66.52%), above the 60% verification floor.
- Current semantically complete snapshot rows: 181/227 (79.74%).
- Session breadth: 64 advances, 82 declines, 5 unchanged; advance/decline ratio 0.78.
- Above SMA20: 78.8%.
- Above SMA50: 88.1%.
- Median 5-session return: +3.02%.
- Median 20-session return: +12.22%.
- Median annualized 20-session volatility: 46.15%.
- Live Yahoo refresh success count: 156; cached verified-history fallback count: 6.
- The older V16 `2026-08-05` `RISK_ON` result remains explicitly stale and was not promoted to current evidence.

The daily breadth is weaker than the medium-term trend evidence, so the UI explicitly discloses that `BULLISH` is **not** a buy instruction. V17 remains the execution authority; while its execution gate is closed, V20 remains `RESEARCH_ONLY`, with zero actionable positions and zero applied exposure regardless of the market-regime label.
