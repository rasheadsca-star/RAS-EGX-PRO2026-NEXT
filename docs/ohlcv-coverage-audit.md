# Phase 1 - OHLCV coverage audit

This read-only tool counts **distinct sessions** by ticker, reports duplicate ticker/session pairs and invalid OHLCV rows, and flags 20/50/100/200-session coverage.

It does not claim that archived sessions are current, that market closures/corporate actions have been checked, or that trading/paper recommendations are ready. Review SQLite table/column mappings before running.

```bash
python scripts/ohlcv_coverage_audit.py --db /path/to/warehouse.sqlite --table candles --symbol ticker --session session --output artifacts/coverage.json
python -m unittest discover -s tests -p 'test_ohlcv_coverage_audit.py'
```

Output is audit-only; no runtime changes. Next production gate must verify date validity using actual EGX holiday calendar, source identity, provenance, adjustment, freshness, and independent backtest.
