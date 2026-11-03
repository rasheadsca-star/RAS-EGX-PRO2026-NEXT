# EGX PRO — P0 enablement and owner-controlled release gates (2026-11-03)

**Operational state:** RESEARCH ONLY / NO_STRATEGY_APPROVED.
**Do not represent source-page dates as independently verified official closing prices.**

## What is installed on default branch main

- `.github/workflows/egx-research-intake-scheduled.yml`: runs 17:30 UTC Sunday–Thursday (19:30 Cairo in Nov 2026). It fetches the EGX official PDF, verifies session date, OHLCV and coverage, stores a 30-day GitHub Actions audit artifact (PDF itself is NOT uploaded), and raises an issue on failure. Optionally extracts a **nonbinding current EGX30 index ISIN/Reuters list** with observed-on date. No DB writes, trading signals or production deploy. Friday/Saturday are explicitly excluded; public holidays should fail safely for missing PDF and request a dated report.
- `.github/workflows/decision-room-daily.yml`: also installed with a 20:45 UTC Sun–Thu schedule, but has **four mandatory explicit authorization variables** in addition to the private store and Vercel credentials. If not configured it is intentionally SKIPPED. No production deploy is allowed. The code SHA is pinned to reviewed commit `7132e56f7caf3f6074a962a09067d8503e4bbba6`, not an unreviewed branch.
- The full daily research preview verifies **served HTML, snapshot JSON, source session and manifest hashes over HTTP**. Vercel READY alone is insufficient.
- The existing PR #198 is DRAFT. Do not merge it to main until regression gates and data provenance are resolved.

## Private durable storage — necessary owner action

The repository is **PUBLIC**. Never commit/upload `central.sqlite`, secrets, backup blobs or a plaintext database to this repository or its public Releases. The existing backend `decision_room/central_store.py` supports **private S3/R2-compatible storage** and has tests for immutable gzip snapshots, SHA-256, atomic restore, crash recovery and non-destructive cost caps. A private bucket and credentials **do not yet exist as verified project configuration**; no agent should assert otherwise.

To provision storage, the owner must select an S3-compatible private bucket (e.g., Cloudflare R2), accept provider billing/terms and create a narrowly scoped access key. Restrict API credentials to the bucket/prefix and necessary read/write/list/head; no public access and no delete permission.

GitHub **Secrets** (repository Settings -> Secrets and variables -> Actions):
- `EGX_STORE_BUCKET`
- `EGX_STORE_ENDPOINT`
- `EGX_STORE_ACCESS_KEY_ID`
- `EGX_STORE_SECRET_ACCESS_KEY`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PREVIEW_PROJECT_ID`

GitHub **Variables**:
- `DECISION_ROOM_DATA_REF` — an independently validated history-data ref (not arbitrary latest)
- `EGX_STORE_PREFIX=egx-central`
- `EGX_STORE_LIMIT_BYTES`, `EGX_STORE_LIMIT_CLASS_A`, `EGX_STORE_LIMIT_CLASS_B` — optional lower-than-default budgets
- `DECISION_ROOM_ENABLED=false`
- `STORAGE_OWNER_APPROVED=false`
- `EGX_IDENTITY_APPROVED=false`
- `EGX_SOURCE_PIPELINE_APPROVED=false`

These authorization switches must **remain false** until their associated acceptance tests pass. Do not set any to true merely to clear a skipped workflow.

With the official base SQLite available **privately** and credentials in a protected runtime:

```bash
python3 decision_room/central_store.py check-config
python3 decision_room/central_store.py bootstrap --db /secure/central.sqlite
python3 decision_room/central_store.py fetch --dest /secure/restore-test.sqlite
sha256sum /secure/central.sqlite /secure/restore-test.sqlite
```

**Acceptance:** returned hashes match exactly, SQLite `PRAGMA integrity_check` is OK, a second `bootstrap` is rejected, a failed verification never changes `LATEST.json`, and restore of an older manifest is demonstrated. Never copy a real DB to GitHub Actions artifacts from the public repository.

The store guard refuses writes near 80% of the configured budget; deletion and retention are intentionally not automated. Verify the provider's actual fee schedule and user authorization before any chargeable provisioning.

## ISIN ↔ symbol identity verification

- Official EGX index pages publish ISIN, Reuters code and company name for their **CURRENT** constituent baskets. Example: `https://beta.egx.com.eg/en/market/indices/constituents?index=CASE30`. This is a genuine source for mapping proposals **within basket coverage**, not a historical effective-date certificate or full 243-symbol mapping.
- `decision_room/tools/official_isin_indices.py` extracts and SHA-logs current pages, verifies Egyptian ISIN check digits, checks cross-index ticker/ISIN conflicts, and emits **UNAPPROVED** proposals. `observed_on` records the date the page was examined; `effective_from` remains blank unless independently documented.
- `decision_room/tools/egx_identity_reference.py` validates an independently obtained historical EGX crosswalk with effective dates. **Format validation alone never marks aliases verified.**
- Official PDF prices do not carry a confirmed ticker merely because name+previous-close matches. The 128 provisional November 2 rows remain unapproved, and the historical 110 `OFFICIAL_EGX` bars require independent identity evidence too. Quarantine or keep `NO_STRATEGY_APPROVED` until each identity is checked.

## Before enabling the full daily workflow

- [ ] 243 historical instrument IDs are reconciled to independent official dated ISIN/reuters evidence, or each unsupported symbol is excluded with reason.
- [ ] Private bucket created and credential scope confirmed; base+delta restore and cost safety independently demonstrated.
- [ ] Historical RAW/ADJUSTED isolation and split/dividend/tick-size/commission assumptions independently reviewed.
- [ ] Two successive dated real official EGX sessions pass retrieval, coverage, mapping, atomic merge, durable persistence, snapshot hash and live-preview GET.
- [ ] Source data reference is explicit and its update policy tested; failing EOD must never silently reuse old recommendations.
- [ ] Frozen walk-forward / untouched holdout shows a positive net expectancy. The prior negative result is not an approved strategy.
- [ ] Independent owner review, audit closeout and controlled release approval.

**Full daily preview is not equivalent to trading readiness.** Keep the automatic trading order execution disabled, regardless of scheduling state.
