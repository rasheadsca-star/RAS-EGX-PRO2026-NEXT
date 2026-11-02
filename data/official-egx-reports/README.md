# Official EGX report evidence — fail-closed

No session PDF is bundled here. Never create a placeholder PDF or synthetic price row.

To authorize a **new** independent paper-research snapshot, place an actual downloaded EGX session report at `data/official-egx-reports/YYYY-MM-DD.pdf` and a manually reconciled `YYYY-MM-DD.json` beside it.

The JSON must have `schemaVersion: "egx-official-pdf-reconciliation-v1"`, the same `session`, `reviewMethod: "MANUAL_PDF_ROW_RECONCILIATION"`, an ISO `reviewedAt`, an official HTTPS `pdfSourceUrl`, and the exact `pdfSha256`. Its `rows` require at least **80** distinct records with `ticker`, checksum-valid `isin`, numeric `close`, integer `volume`, `sourcePage` and `verifiedAgainstPdf: true`.

The gate checks PDF bytes/hash, extractable session date, ticker and matching close/volume numeric cells near each ticker, symbol-map ISIN and the persisted same-session closing price and volume. A reviewer must inspect each source page and reconcile the cells; passing the automated gate does **not** prove licensing, historical OHLCV quality, OOS profitability, or execution readiness.

A missing, scanned/unextractable, inconsistent, or non-official PDF blocks publication. The existing frozen V4 2026-10-29 display and previous independent paper files must remain unchanged. This gate does not authorize changes to the upstream market-data fetch workflows, which need their own provenance controls.

Official source: https://www.egx.com.eg/en/Services_Reports.aspx
