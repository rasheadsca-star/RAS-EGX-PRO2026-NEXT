# SEPA-X architecture and implementation state

## CURRENT STATE
RC2 remains the frozen reference. SEPA-X reads only shared market inputs and creates its own analytics/output state.

## GAPS FOUND
1. Current short-history store targets ~100 sessions, insufficient by itself for SMA200/R252/52-week hard gates.
2. Verified fundamentals and catalyst coverage are sparse; unknown remains unknown.
3. Market benchmark availability can be degraded; breadth fallback is explicit and reduces evidence richness.
4. There is no persistent database in the frozen baseline suitable for a new engine, so SEPA-X v1 persists immutable scan/history JSON in its own namespace. A database adapter can replace `store.js` later without touching RC2.

## IMPLEMENTATION
- Independent data provider with optional Yahoo 2-year long-history recovery plus current repository history.
- Adjusted-price normalization when adjusted close is supplied.
- Hard gates before quality ranking.
- Market-wide RS percentile (not RSI).
- VCP contraction, volatility compression, volume dry-up, tightness, pivot and entry-state engines.
- Structural stop and R:R validation.
- State transition log and recommendation history.
- API/UI under the SEPA-X deployment root.
- Point-in-time backtest guards + walk-forward framework.

## DATABASE EVOLUTION (future adapter)
Recommended tables: `market_daily_features`, `stock_daily_features`, `fundamental_snapshots`, `technical_setups`, `recommendations`, `recommendation_history`, `engine_runs`, `engine_errors`, `backtest_runs`. Until a DB is attached, JSON persistence is deliberately isolated under `sepa-x/data`.

## REGRESSION RISK
RC2 regression risk is minimized by zero changes to frozen files and a dedicated isolation test that rejects runtime imports from `tfe-v20`.
