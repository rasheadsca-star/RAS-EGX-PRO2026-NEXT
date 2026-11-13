# EGX PRO independent paper input gate (research only)

The centralized SQLite produced by Claude is a research input, not a production feed. This component consumes its tables **read-only**, never writes to the source database and cannot place trades.

## Correctness rules
- DB `PRAGMA integrity_check` must be `ok`.
- All required tables must exist.
- Only source `paper_ready=1`, no open conflicts, at least 200 RAW sessions, and no future session.
- All last 200 RAW OHLC values must satisfy `low <= min(open,close) <= max(open,close) <= high`. No silent healing.
- When the source has nonstandard official opening/reference prices, hold the ticker for manual source-model review rather than misclassify the candle as executable.
- Output status `PAPER_RESEARCH_INPUT_ONLY` is **not** a trade signal.

## Independent verification on supplied 2026-11-01 database
243 identities checked, 0 passed this stricter gate. Of last 200 RAW bars: ARAB had 17 open/range anomalies, GDWA 23, SPMD 23. These may reflect exchange methodology and must be clarified before using open-price-dependent strategies. 3 local regression tests passed.

Do not alter historical raw values. Differentiate official reference opening price from executed intraday opening trade if source specification supports such distinction.
