# Market Data Readiness Gate (2026-11-01)

The existing Astra G07 reconciliation is a **migration accounting** result, not a guarantee of current executable prices. Its reported 60,288 discovered and 26,270 canonical records span **different entity types**; only H01 covers normalized market history (25,800 records).

Run locally or in CI:

```bash
python scripts/market_data_readiness.py --strict-migration
python -m unittest discover -s tests -p 'test_market_data_readiness.py'
```

Outputs `artifacts/market_data_readiness.json`. The migration pass is a prerequisite, never a trading release gate. The script intentionally reports `tradingReadiness: NOT_PROVEN` and `recommendationsEnabled: false` until independently verified live feed freshness, symbol/date integrity, licensed source, and out-of-sample efficacy exist. No recommendations or deployment settings are changed in this PR.

Next: reconcile the distinct (ticker, session) rows of H01 against the central V3 SQLite database, validate 20/50/100/200-session coverage, check the latest completed trading date against Egyptian Exchange official reports, and only then build a single canonical historical feed.
