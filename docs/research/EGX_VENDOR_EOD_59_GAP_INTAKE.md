# EGX PRO — Licensed daily OHLCV gap intake (research staging)

This workflow prepares an up-to-date vendor request covering every **active** mapped security missing
valid session history, not the potentially empty array in a failed `v15-price-truth` run.
It does **not** fix live prices by itself or certify any market-source content.

## Source candidates and due diligence

- **EGID / EGX licensed source**: obtain signed fields, ISIN/security class, listing status, daily OHLCV, volume, dates, currency, corporate actions and redistribution/use rights.
- **ICE**: EGX daily/historical EOD API/data licensing, independently verify full symbol universe and exact 26-Oct-2026 EOD coverage.
- **DirectFN / Mubasher licensed institutional feed**: request exact historical daily records, not only a public web page that has shifted to the next day.
- Other vendors: stage only if their agreement explicitly covers model research/paper trading. Yahoo Finance public quote data has use/redistribution restrictions and must not be silently transferred to production.

Providers should return **120–250+ authenticated, unadjusted daily sessions per valid listed symbol**; where the issuer is new or recently listed, require all sessions since listing and listing date. No fabricated prelisting rows. For each row require:
`ticker,isin,currency,date,open,high,low,close,volume,source,source_url,source_session_date,final_eod,license_ref,corporate_action_status,second_source,second_source_url,second_session_date,second_close`.

For institutional electronic delivery, include **immutable feed provenance**, exchange session close-final flag,
EGX holiday calendar, security identifier mapping/renames and split/dividend event ledger. A web page returning HTTP 200 is not a source-session certificate.

## Automated outputs

The recovery workflow creates:
- `licensed-provider-gap-request.csv`: all active gaps, expected session, currency, historical bars available and error category.
- `licensed-provider-upload-template.csv`: precise CSV schema for a vendor response.
- `licensed-vendor-intake-review.json`: row-level reject/hold/ready-for-human-review evidence, no implied market trade readiness.

For a **licensed** downloaded vendor CSV, in a trusted local copy or explicitly approved
one-off GitHub Actions workflow with secure upload, run:

```shell
EGX_VENDOR_CSV=/secure/vendor-eod.csv \
 EGX_RECOVERY_OUT=/tmp/egx-review \
 python3 scripts/research/egx-licensed-ohlcv-intake.py
```

The intake rejects session-date inconsistency, future/backfilled later rows, wrong instrument currency,
impossible OHLC, noninteger volume, duplicated date, nonfinal EOD and missing source URL.
It quarantines absent mapped ISIN or missing independent source close, unresolved corporate action and
missing contractual use proof. Even `REVIEW_READY` remains **productionEligible=false** and
`promotionApproved=false`.

## Critical G11 gap

As of the latest certified read-only 2026-10-26 G11 diagnostics on 237 active symbols:
**179 current canonical vs 214 required** and **175 pipeline-ready vs 190 required**.
The old-engine 539 candidate bars do **not** directly cover this latest session.

Correct path: vendor data -> row review -> documented per-symbol identity and corporate actions ->
independently approved 12.8 importer in a separate isolated change -> recompute v15, full history,
G11 and G09, hold-out paper trading. Never modify live snapshots to satisfy counts.

Sources to evaluate:
- https://www.egidegypt.com/
- https://developer.ice.com/fixed-income-data-services/catalog/egyptian-exchange-egx
- https://www.directfn.com.eg/delayed.aspx
