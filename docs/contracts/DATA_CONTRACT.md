# Data Contract
The EGX Market Data Store is the only engine input. Every bar is keyed by ticker+session and contains validated OHLCV plus source lineage. Missing values remain UNKNOWN, never zero. Cross-source material conflicts, suspicious jumps, invalid OHLC, or unresolved corporate actions block readiness. A fresh price may never be combined with stale dependent features.
