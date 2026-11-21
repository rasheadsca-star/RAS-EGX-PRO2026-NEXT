# EGX PRO — authenticated PDF staging server (development only)

## Purpose
This service closes the **storage-and-audit** portion of P0 without turning research signals into approved paper trades.

Current workflow:
1. An operator sends the official PDF to a server via a private, authenticated `POST /api/ingest`.
2. The server checks content type, size, PDF magic and computes SHA-256.
3. It writes the original bytes immutably to a **persistent private volume**, indexed by SHA-256 and SQLite.
4. The existing Python geometry extractor produces `extraction.json`.
5. `validate-extraction.cjs` invokes the central `validator.cjs`, recording `validation.json`.
6. The job remains **QUARANTINED / REVIEW_REQUIRED / VALIDATION_FAILED** and does *not* change `latest.json` or publish new scores.

The same `ingest_bytes()` function is intended to be used by a future official automatic fetch adapter (not currently connected).

## Requirements
- Python 3.12, PyMuPDF 1.26.5, Node 22
- A persistent writable filesystem for `EGX_DATA_DIR`
- A private reverse proxy that handles TLS and restricts administrative access
- `EGX_UPLOAD_KEY`: a random 32+ character secret; never place in frontend bundles, GitHub source, or GitHub Pages
- Do not allow the service to bind to a public network interface directly

## Local demonstration (NOT production)
```bash
python -m pip install pymupdf==1.26.5
export EGX_DATA_DIR=/secure/persistent/egx-pro
export EGX_UPLOAD_KEY="REPLACE_WITH_SECURE_RANDOM_KEY_AT_LEAST_32_CHARS"
python egx-pro-research-12nov2026/operations/ingest_service.py
curl -H "X-EGX-Upload-Key: $EGX_UPLOAD_KEY" -H "Content-Type: application/pdf" \
  --data-binary "@DiscDoc_ID1022_19-Nov-2026_ENG.pdf" \
  http://127.0.0.1:8787/api/ingest
```

The response must say **published:false** and **certified:false**. Do not expose this localhost URL as a user-facing production endpoint.

## Remaining blockers
- Add full authenticated user/session management, CSRF protection where cookie auth is used, rate limiting, anti-malware scanning, file retention, backups and operator audit trails.
- Deploy to a persistent service (GitHub Pages is static; Vercel functions with ephemeral filesystem do not provide persistent local SQLite).
- Integrate upload frontend through a same-origin secured API gateway. The existing static GitHub Pages URL cannot call this localhost service for other users.
- Reconcile the versioned full security master with ISIN and variable tick-size schedules.
- Implement score calculations and previous recommendation reconciliation **only after validated ingestion**, then write session artifacts atomically and advance `latest.json`.
- Implement a recovery policy for interrupted `STAGED` records and concurrency across multiple service replicas.
- Validate against two official PDFs, subsequent trading sessions, and end-to-end failures (wrong dates, corrupt PDFs, duplicate hashes, missing symbols, regression tests).
- Certified Paper Trading remains blocked until all independent acceptance gates pass.

## API statuses
- `401 UNAUTHORIZED`, `413 PDF_SIZE_OUT_OF_RANGE`, `415 PDF_CONTENT_TYPE_REQUIRED`, `422 INVALID_PDF_SIGNATURE`
- `202` with SHA and `QUARANTINED` / `REVIEW_REQUIRED` / `VALIDATION_FAILED` for accepted staging requests.
- `GET /api/ingest/{sha256}` is operator-authenticated status lookup.
- `GET /api/health` confirms the process is running, **not** that the import pipeline is production ready.

## Important
Do not publish raw ingestion errors or secrets. Treat all PDF and issuer text as untrusted input.
