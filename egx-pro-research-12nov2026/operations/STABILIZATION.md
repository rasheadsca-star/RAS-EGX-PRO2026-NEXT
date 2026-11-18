# EGX PRO — Daily Official Report Ingestion / Stabilization Contract

Status: **PROTOTYPE / NOT PRODUCTION READY**. This branch does not replace any trading engine.

## Observed issues on 2026-11-18
- Research landing page is static and depends on `egx-pro-research-12nov2026/latest.json`.
- `latest.json` still points to 2026-11-17 after a page for 2026-11-18 was created.
- Per-session static HTML is not a server-backed ingest pipeline. Consequently a new file or page can exist without the canonical pointer being published.
- The 2026-11-18 page is marked provisional: extraction covered 205 rows with 185 basic-valid rows but not a full ISIN and tick-size audit. **Do not claim production-grade recommendations**.
- GitHub Pages cannot accept and durably persist browser-uploaded PDF files by itself.

## Required architecture (proposed; not yet implemented)
1. **Scheduler**, run after close on trading days (Egypt-local timezone, holiday calendar, plus retry). Determine session date from PDF content, not run date.
2. **Official source fetcher**: use the official EGX Services_Reports page and/or an explicitly verified report download endpoint; validate HTTP status, PDF signature, page count, source identity, trading date, hash, and avoid duplicate ingestion. Do not scrape unsupported endpoints or guess URL patterns.
3. **Fallback endpoint** (authenticated backend): accept the PDF chosen in the app, max 30 MB, verify MIME/magic, scan, SHA-256, author and audit log; store it in a private immutable staging bucket. No GitHub write token in the web UI. Show progress and final job result.
4. **Parser**: extract the listed-stocks main-market table, retaining currency, symbol, issuer name, ISIN, open, high, low, close, value, volume and price precision. Preserve source page and row provenance. Reject OCR guesses.
5. **Quality gates**: `acceptedRows >= 200` only if verified full coverage; validate monotonic session date, positive prices, high>=max(open,close), low<=min(open,close), positive volume/value, unique ISIN, symbol mapping against versioned security master, legal tick increments, acceptable excluded-row categories, index/date checks, and source hash. Quarantine unknowns. If the PDF has fewer than 200 legitimate traded rows, require an explicit reviewed exception, not fabricated data.
6. **Ranking engine**: nine isolated strategies with exactly defined change / close-in-range / traded value inputs. Record normalized scores, exclusions, seed/config version, and inputs; never reuse an old ranking as today's ranking.
7. **Risk-plan engine**: determine entry/stop/target with per-symbol tick size, gap and liquidity filters; annotate percent risk, R multiple, and scenario. Risk % is price distance, *not* probability of loss.
8. **Previous-recommendation evaluation**: link prior immutable signal IDs; check whether entry was touched, stop and targets touched; if intraday ordering cannot be proven from daily OHLC, mark `ORDER_UNKNOWN` and never count as a realized win. Track unfilled recommendations separately from executed paper trades and close-to-close reference performance.
9. **Two-phase publisher**: write session artifacts to staging, run schema and regression tests, publish immutable `sessions/YYYY-MM-DD/` page and JSON, then atomically update the canonical `latest.json` pointer on the same release only after all checks pass. Make every step idempotent.
10. **Status and alerting**: record `last_attempt`, `last_success`, source URL, source hash, date, accepted/excluded counts, error code, fallback required; warn in-app and notify operator on failure. Do not silently show a stale report as current.

## Hard constraints
- Preserve original engines and historical session snapshots.
- No writes to main without explicit approval and a reviewed PR.
- No promotion to paper-trading-approved or real-money recommendations until 200+ accepted rows, complete ISIN/tick audit, independent validation and regression tests.
- Do not make an API token available in JavaScript running in the browser.
- All source files should be immutable; reprocessing the same hash should not create duplicate sessions.
- Distinguish statuses: `FETCH_FAILED`, `UPLOAD_REQUIRED`, `PDF_STAGED`, `VALIDATION_FAILED`, `REVIEW_REQUIRED`, `PUBLISHED_RESEARCH`, `CERTIFIED_PAPER_ONLY`.
- A new session may be in quarantine while the prior valid session remains displayed, labeled with its exact date.
- Manual upload must trigger the **same** validator and scoring pipeline as automatic fetch, not a separate ad hoc calculation.

## Current branch deliverable
`egx-pro-research-12nov2026/operations/index.html` is an isolated **local preflight prototype**:
- Select a local PDF, check signature/size/number of pages, try to read the reporting date, compute SHA-256 and export a machine-readable preflight record.
- It does **not** upload or store the PDF, run recommendations, publish a page, or update the central database.
- It uses PDF.js from a CDN; production must pin and self-host a reviewed package version and provide an offline/network-error fallback.

## Acceptance criteria for a production milestone
- Three sequential trading sessions ingest automatically, without manual commits, and `latest.json` agrees with newest validated release.
- Simulated fetch failure causes visible in-app `UPLOAD_REQUIRED`; an authorized user uploads the official PDF; the backend acknowledges and processes it through the same ingestion pipeline.
- Wrong date, duplicate file, incomplete PDF, corrupted PDF, unknown ISIN, mispriced tick and row-loss are each rejected with explanatory messages.
- For every prior recommendation: `NO_ENTRY`, `STOP`, `T1`, `T2`, `ORDER_UNKNOWN` can be independently recomputed.
- Nine strategy results remain isolated, versioned and reproducible.
- Failed deployment leaves the last-known-good page and source database intact.
- Build and full regression suite must pass before publication.

Reference official report index: https://egx.com.eg/en/Services_Reports.aspx
