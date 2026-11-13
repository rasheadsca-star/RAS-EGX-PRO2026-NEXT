# Verified G07 OHLCV archive audit — 2026-11-01
Source: GitHub Actions artifact `10416488107` (`astra-g07-migration-evidence-35019349149`), `.astra-g07/run1/canonical/records.jsonl`.

## Measured (not estimates)
- 25,800 canonical market rows; 201 tickers; 25,800 unique (ticker, sessionDate) pairs.
- Zero duplicate ticker/date pairs, zero conflicting pairs.
- Zero basic OHLC/volume invalid rows and zero Friday/Saturday dates.
- Coverage: >=20 sessions 200 tickers; >=50 sessions 199; >=100 sessions 196; >=200 sessions **0**.
- Date span 2024-10-23 to **2026-09-15**; 349 union dates.
- 5,798 symbol-date gaps versus the *union of archive dates*, affecting 200 tickers. **These are candidate gaps, not independently verified missing official exchange sessions**, since trading suspensions, illiquidity and symbol listing periods require separate checks.
- 52 tickers do not cover all of the 20 newest union dates.
- Canonical entities report validationStatus `UNKNOWN` — no freshness or official price certification follows from this audit.

## Release status
**Historical G07 coverage audit completed locally; market-data production gate BLOCKED.** Nothing from this archive is promoted to live/paper recommendations. Remaining work: compare V3 and other branches, verify official sessions/holiday calendar and legal sources, reconcile gaps, ingest post-September data, get >=200 sessions where strategies require it, and run CI audit job.

Outputs from local audit: `EGX_G07_Ticker_Coverage.csv`, `EGX_G07_Data_Exceptions.csv`, `EGX_G07_Audit_Summary.json` (distributed in chat).
