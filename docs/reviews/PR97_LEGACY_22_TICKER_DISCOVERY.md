# PR97 — Evidence-led legacy coverage discovery (2026-10-25)

Source examined: `rasheadsca-star/RAS-EGX-PRO2026`, `main:data/history-50.json`, Git blob SHA `27b855ec1babcb0f520caff0b521ac52fde4411a`, generated `2026-07-02T21:06:39.356Z`. No new market retrieval was performed. This source is an older persisted snapshot, not an official exchange validation.

Comparison basis: `RAS-EGX-PRO2026-NEXT:data/stable/v15-price-truth.json` at the PR97 baseline, showing 193 accepted / 171 updated / 22 missing (2026-10-25).

**Verified structural discovery:** 21 of the 22 missing symbols have **one** `2026-07-02` entry each in the legacy `history-50.json`. `ACTF` has no entry in that file. Under the basic OHLCV constraints (`low <= open,close <= high`, positive values, nonnegative volume, ISO date), **three fail**: `BONY` (low 4.80 > open 4.78), `TANM` (low 5.08 > open 5.07), `QNBE` (low 51.86 > open 51.75). Their rows MUST NOT be silently corrected. The other 18 are **structural candidates only**: VLMRA, KORA, UBEE, KRDI, AIHC, AIDC, GGRN, GPIM, DGTZ, VLMR, VALU, TAQA, ACAP, NAPR, NARE, CPME, TYCN, CRST.

None of these 18 has been shown to have an independently authenticated source, a complete historical price series, or overlap verification with current sessions. One isolated historic observation does not establish 20-, 50-, 100-, or 200-session coverage.

Added the read-only `history-legacy-candidate-triage.cjs` helper and unit tests. **No canonical history data is imported or edited**; PR remains Draft. A later authorized promotion process must check historical source provenance, ticker identity, actual date, overlap conflicts, price adjustments and at least one real session before updating a ticker's canonical series.

Important: Even if 18 missing files were legitimately completed, the accepted price row count for the current session remains **193**, short of the hard threshold of 200. Historical backfill cannot invent seven new accepted current-session rows. Do not confuse coverage recovery with session readiness.

## Additional cross-archive ACTF evidence (metadata only)

A later repository search found `ACTF.CA` listed with an empty array in `data/history-50.json`, while separate `RAS-EGX-PRO2026` outputs report **ACTF: 7 available sessions (2026-07-08 through 2026-07-15)** in `data/history-health.json` and **ACTF: 25 recovered rows** in `data/git-history-recovery-status.json`. These reports reflect different times/methodologies and are NOT interchangeable proof that 25 current canonical candles exist. The underlying verified OHLCV rows have NOT been retrieved or reconciled yet. Investigate archive snapshots, source provenance, and date overlap before any data movement.

`astra-v5-egx/data/replay/sessions/2026-10-22.json` and `2026-10-25.json` are 158–160 KB research decision snapshots. Their top-level fields include dataHealth, predictions, risk engines and input hashes, not standalone price-history series; scanning nested structures for the 22 exact ticker codes found no candidate rows in the inspected 2026-10-25 snapshot. The ASTRA replay record explicitly has `researchOnly: true` and `automaticExecution: false`. Do not treat a signal replay or market-health count as authenticated OHLC history.

The old `data/history-seed-import-report.json` documents a third-party Kaggle/Yahoo seed (latest session 2026-02-04, nonofficial). Its listed newly imported 11 tickers do not cover the 22 missing symbols. This is source lineage context, not current-session execution grade.
