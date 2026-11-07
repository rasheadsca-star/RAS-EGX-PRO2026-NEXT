# EGX quarterly/annual market-report archive — coverage inventory (2026-11-06)
Inventory only. No prices, returns or factor values computed. CSV: `archive_inventory.csv` (62 unique PDFs of 67 uploaded; 5 byte-identical duplicates flagged `dup_of`; the PDFs themselves are NOT in the repo).

## What exists
- **Per-company snapshot table** (Close, 52w range, volume/value, mkt cap, Trailing P/E, Sector P/E, DY%, EGP Net Profit, **Net Profit Date**, last coupon/pay date; ~282-365 company rows, names only, no tickers/ISIN): **27 distinct quarters, 2019-Q2 .. 2026-Q2** (28 files; 2019-Q2 exists in two versions issued 27/06/2019 and 28/10/2019 = a re-issue, usable to audit restatements).
- **Gaps**: 2019-Q1 file lacks P/E columns; 2025-Q2 (30 Jun 2025) missing; 2025-Q4 only as an annual report in a different layout (not parsed).
- **Pre-2019 reports (2015-2018, 16 files)**: 8-12 page market-level quarterly summaries, NO per-company table.
- **Arabic (ARB) files (4: 2015, 2016, 2017 corporate-performance statement, 2020)**: narrative annual reviews, no per-company numeric table. Only the 2025 annual ARB (not in the 4) shows table-like pages (unverified). So the 'both language types' pilot audit gate cannot be met with company-level tables from the Arabic archive today.
- Each quarterly report carries an internal `Issued at <timestamp>`; for most it equals the period-end date (evening), some are issued BEFORE period end (data truncated) and two are re-issues. `Net Profit Date` is the profit's period end (e.g. 31/12/2022 in a Jun-2023 report), NOT its publication date; whether the figure is a 12-month/audited annual figure is not stated in the table.

## Verdict against the frozen F1 prereg (annual audited earnings growth)
- Gate `NOT_MET` stands: no issuer-level public-dissemination timestamp; ARB company tables absent; names need mapping; unknown whether Net Profit is annual/audited/trailing.
- Usable history would be 2019-Q2 onward: development effectively ~2020-2021 (~6 usable quarters for growth that needs two consecutive annual profits), validation 2022-2024 (12 quarters, borderline vs the >=12 requirement).
- A *conservative availability* idea exists but is NOT adopted here: treat a (company, Net Profit Date) figure as available from the first snapshot that contains it (an upper bound on publication, hence late = safe against look-ahead), plus a safety lag. It needs GPT's review and a new versioned prereg; the F1 prereg is immutable.
- Alternative factors using the same snapshots (Trailing P/E, DY%) need a separate prereg; P/E is computed by EGX at the snapshot date, so its point-in-time status is clearer than profit growth, but name->ticker mapping (no guessing) remains the main cost.
No strategy approved. NO_STRATEGY_APPROVED unchanged.
