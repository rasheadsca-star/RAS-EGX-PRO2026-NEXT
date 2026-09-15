# Feature registry V18.0

| Name | Availability | Lookback | Missing policy | Family | Rationale |
|---|---|---:|---|---|---|
| return_1/5/20 | session close | 1/5/20 | block | momentum | price persistence |
| distance_sma20 | session close | 20 | block | trend | trend state |
| volume_ratio20 | session close | 20 | block | liquidity | participation |
| atr_pct14 | session close | 14 | block | volatility | normalized risk |
| median_turnover20 | session close | 20 | block | execution | capacity proxy |
| target_distance | session close | structural 20 | block | geometry | target difficulty known before entry |
| stop_distance | session close | structural 10 | block | geometry | downside distance known before entry |

All values use rows at or before the signal close. No fundamental feature is admitted until publication/effective/ingestion timestamps are available.
