# Legacy Feature Migration Report

| Old feature/source | Useful concept | Rejected | Astra-native rebuild | New artifact/component |
|---|---|---|---|---|
| V13/V16 search UX | Full-universe discoverability | Legacy recommendation/decision state | Search over versioned Astra market-universe artifact; current status joined only from Astra ledger | `market-universe.json`, `astra-market-portfolio.js` |
| V16 portfolio UI | Purchase price follow-up and P/L | Any influence on ranking/decision; public persistence | Browser-only versioned localStorage, read-only Astra context | `egxpro.astra.portfolio.v2` |
| RC2/V17 history | Recommendation timeline UX | Mixing legacy recommendations into Astra KPIs | Immutable Astra Recommendation Records + separate Outcome Records | `recommendation-ledger.json`, `recommendation-outcomes.json` |
| Legacy performance summaries | KPI ideas | Mixed engines and unclear denominators | Reconciled Astra-only KPIs with explicit numerator / denominator | `performance-summary.json`, by-rank, by-regime |
| Legacy charts | Historical visualization | Synthetic intraday path | Daily OHLC candlestick chart with volume and Astra decision overlays | `astra-performance-history.js` |

## Architecture boundary

No legacy decision logic is migrated. Search/technical fields from older indexes are display-only upstream/reference data. Current recommendation membership, rank, entry, stop, targets and decision identity come only from Astra DecisionSnapshot-linked artifacts.
