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

The dedicated workflow persists the regime evidence and the integration contract. Its evidence commit then triggers the main V20 validation workflow, so the integrated platform must still pass all existing governance, data, portfolio, archive and UI gates.
