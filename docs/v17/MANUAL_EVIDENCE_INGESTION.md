# V17 Manual Official Evidence Ingestion

Use this path when an important issuer provides an official PDF but no reliable automated index. Manual official evidence is preferable to automated unverified data.

## Required metadata

Create a local JSON file containing at least:

```json
{
  "documentId": "TICKER-ANNUAL-2025-OFFICIAL",
  "ticker": "TICKER",
  "legalName": "Exact issuer legal name",
  "sourceId": "COMPANY_IR",
  "sourceUrl": "https://official-domain.example/report.pdf",
  "documentType": "FINANCIAL_STATEMENTS",
  "reportingPeriodEnd": "2025-12-31",
  "publicationDate": "2026-03-20",
  "effectiveAvailableDate": "2026-03-20T00:00:00Z",
  "retrievedAt": "2026-08-09T00:00:00Z",
  "language": "AR_EN",
  "currency": "EGP",
  "units": 1000,
  "statementScope": "CONSOLIDATED",
  "periodType": "ANNUAL",
  "exchange": "EGX",
  "securityClass": "ORDINARY_EQUITY",
  "parserVersion": "v17.5-text-first-1"
}
```

Run:

```powershell
node scripts/v17/historical-recovery/acquisition/manual-ingest.cjs --file C:\path\official.pdf --metadata C:\path\metadata.json --pdftotext C:\path\pdftotext.exe
```

The command verifies the company against the V17 identity registry, hashes and archives the raw document under the ignored local cache, extracts text first, and reports ambiguity. It never inserts extracted numbers directly into the decision model.

If the result is `PARSER_REVIEW_REQUIRED` or `MANUAL_FIELD_MAPPING_REQUIRED`, inspect the original PDF and record only verified values in `pilot-evidence.json`. Every value needs currency, unit, reporting period, statement scope, document ID, and page reference. Safe derivations must name their components. Do not use OCR values without independent visual validation.

After review, run:

```powershell
node scripts/v17/historical-recovery/acquisition/orchestration/build.cjs
node scripts/v17/historical-recovery/acquisition/orchestration/validate.cjs
```

A failed validation means the evidence remains out of the integrated model. Never edit shared production maps or history to complete this workflow.
