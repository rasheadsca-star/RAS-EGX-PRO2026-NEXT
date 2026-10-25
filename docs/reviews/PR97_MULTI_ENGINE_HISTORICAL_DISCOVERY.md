# PR97 — Multi-engine historical discovery round 2 (read-only)

Inspected the public GitHub repository trees and available source files:

- `rasheadsca-star/RAS-EGX-PRO2026`: `data/history-50.json` contains one historical record for 21/22 missing symbols, with 18 structurally valid and 3 OHLC-invalid, as documented previously. Its `data/history/<ticker>.json` tree has **none** of the 22 missing tickers, so no independently stored multi-session history could be found in these per-symbol files.
- `rasheadsca-star/astra-v5-egx`: 12 saved `data/replay/sessions/YYYY-MM-DD.json` snapshots spanning 2026-10-07 to 2026-10-25. None of the 22 missing tickers occurred in these snapshots' `predictions` array. These snapshots are explicitly `researchOnly: true`; even if a ticker appears as a predicted candidate, its `currentPrice` is **not** a provenance-qualified OHLCV candle. Some snapshots include derived monitoring values, but this audit deliberately does not convert decision or monitoring data into historical market prices.
- `rasheadsca-star/RAS-EGX0.1`: older history sources discovered; the historical JSON could not be parsed in the inspected connector response, and therefore no completeness or quality claim is made for this repository.
- `rasheadsca-star/Ras--Egx-18-manus`: repository main Git tree currently responds as empty.

Added `history-replay-coverage-audit.cjs` and tests. It classifies replay data as research-only and refuses to treat derived predictions as source-verified historical OHLCV.

**Current conclusion:** The inspected files did not establish a multi-session authenticated price history for any of the 22 currently missing tickers. No canonical price files were modified, and no invented backfill was performed. Separate production blockers remain: accepted rows 193 (need 200), writable history 171 (need 200), quarantine and writer fencing.

Further collection should prioritize primary per-session price sources, immutable source hashes, symbol mapping and session-by-session OHLCV validation, followed by independent cross-source comparison. PR97 remains Draft.
