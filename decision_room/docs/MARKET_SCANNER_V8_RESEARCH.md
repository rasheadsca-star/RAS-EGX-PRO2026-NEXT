# EGX PRO Market Scanner — research-only V8 integration

This is a **module in the existing decision room**, not a new database, trading engine or published application.

## Data contract
- Reads the existing `egx_decision.ingest.load` RAW canonical bars, symbol identity, market calendar, and existing `quality.evaluate` results.
- Never opens a writable connection; never changes `quality.passed`, `paper_ready`, `NO_STRATEGY_APPROVED`, or `qualifiedTradeCount=0`.
- One descriptive row per known symbol: recent session, available-bar count, channel statistics, relative volume, ADV20, quality reasons and classification.
- 60 observed valid bars required for channel statistics; missing confirmed exchange sessions within the 60-day calendar window are reported, not hidden. Stale and insufficient-data names remain visible with their reason.
- The statistical lower regression band is a **proxy**, not proof of strong support.

## Research descriptors (NOT calibrated or validated strategies)
- 60-observation log-close regression; ascending only with positive annualized log slope > 0.05, R² >= 0.40 and close > MA50.
- "Near lower channel": recent three-session low within ±3% of the lower channel band.
- "Bounce": final close > prior close and >=1% above recent three-session low.
- Volume confirmation: latest volume / mean of the preceding 20 observed bars >= 1.3.
- Liquidity descriptive screen: ADV20 >= EGP 5m.
- These are static illustrative **visual classifications**. No profitability claim, entry, stop, or targets.

## User interface
Added to the existing `decision_room/egx_decision/render.py` original Arabic decision room:
- New Market Scanner section showing total screened, quality passed, search, category filters, trend and channel metrics, volume, liquidity and full reasons for exclusion.
- The original ranked/watchlist and hard fail-closed quality gates are retained.
- Scanner also lists blocked symbols; they are **not eligible to trade**.

## Tests and constraints
- `python3 -I decision_room/tests/test_market_scanner.py` on synthetic local SQLite only.
- CI references that test in `.github/workflows/decision-room-ci.yml`.
- No historical performance tests or investment recommendations. No merge or deployment in this branch.
- Until tests have run successfully on the branch, implementation is **pending QA**, not production-ready.
