# V20 Phase 5 — Semantic Data Quality + User Portfolio

## Scope

Phase 5 tightens row-level market-data truth and adds a user-owned portfolio monitor without changing the frozen Champion, V17 execution governance, or V19 shadow status.

## 1. Semantic current-session quality

`data/market.json` can contain numeric placeholders such as `open=0`, `high=0`, or `low=0`. Numeric presence alone is not evidence of a valid OHLC field.

V20 now:
- treats non-positive price / previous close / OHLC values as missing;
- requires `high >= low`, `high >= open`, `high >= currentPrice`, `low <= open`, and `low <= currentPrice` before an OHLC set can be marked valid;
- sanitizes invalid OHLC rather than passing it downstream as a valid number;
- keeps a valid current price available even when OHLC completeness is partial;
- records `dataQualityIssues`, `ohlcValid`, and semantic completeness per current-market row;
- does not rewrite or upgrade V17 global coverage/freshness/execution metrics.

`data-quality-regression.cjs` independently verifies that zero OHLC placeholders are not exposed as valid numeric values and that `COMPLETE_FOR_CURRENT_SCOPE` always requires valid OHLC.

## 2. User Portfolio ("محفظتي")

The user portfolio is intentionally separate from V20's model portfolio.

Properties:
- stored only in browser `localStorage`;
- no server or repository persistence;
- user enters ticker, average buy price, and quantity;
- P&L is calculated only when Market Explorer has a current-session price;
- stale or missing prices are not used as current valuation;
- holdings do not affect opportunity ranking, V16 Champion, V19 Challenger, model allocations, or V17 execution gate;
- no automatic orders or automatic buy/sell instructions are produced;
- output is monitoring/review state only.

Risk-monitoring flags can surface:
- no current-session price;
- source conflict;
- partial current data quality;
- global execution gate closed;
- reference stop reached/breached;
- reference target 1 reached/exceeded.

Reference stop/target flags are contextual comparisons to the current V20 plan, not automatic trade instructions.

## 3. Acceptance

The V20 workflow now requires:
- semantic data-quality regression;
- full existing governance / R-R / trade-plan / technical-history / leakage / Market Explorer regressions;
- user-portfolio formula and separation regression;
- UI contract validation for local-only portfolio storage and current-session-only valuation.

No V16, V17, V19, or `main` files are modified.
