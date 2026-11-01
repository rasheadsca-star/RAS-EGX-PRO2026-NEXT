# EGX PRO — Daily pipeline runbook (research preview)

Order of stages (each is separately fail-closed; each exits 2 and leaves the previously served data untouched):

1. **Collect** — existing repo collectors keep writing `data/history/<TICKER>.json` (S1; Mubasher scrape; unchanged by this PR).
2. **Ingest** — `python3 decision_room/ingest_daily.py --src data/history --db <central.sqlite> --report ingest_report.json`
   Staged copy → validate → insert only NEW sessions (tier `SINGLE_PROVIDER`) → flag revisions as OPEN conflicts → integrity check → atomic swap (`<db>.prev` kept). NOOP when nothing is newer.
3. **Decide + publish** — `python3 decision_room/run_daily.py --db <central.sqlite> --out public/ --journal journal/decision_journal.jsonl`
   Builds snapshot → staged release dir + MANIFEST → append-only hash-chained journal → atomic symlink swap `public/current` → `job_health.json` last.
4. **Monitor** — `public/job_health.json` (`status`, `serving`, `error`) and the page's own >4-day stale banner. A FAILED job never replaces a good release.

## Hard limits (unchanged)
`NO_STRATEGY_APPROVED`; H1 experimental only; entry/stop/target hidden; no real orders; ingested bars are never OFFICIAL and are never allowed to rewrite history.

## Stages added in v3.2
0. **Preflight** (`tools/preflight.py`): required settings by name, source freshness (<=4 days), storage reachable + usage ledger readable + cost guard below 80%. Any failure = red run, nothing published.
1. **Fetch** `central_store.py fetch` (SHA-256 + size + integrity_check + schema; no silent fallback to an older DB) for the DB and the journal.
2. **Ingest** now also compares EVERY already-canonical date (not only the last) and records new disagreements >0.5% as OPEN `INGEST_REVISION` conflicts even when no new session arrived (status `REVISIONS_RECORDED`); re-runs do not duplicate them.
3. **Persist** `central_store.py publish --expect-parent <sha fetched>` only after publish succeeded (blob -> read-back SHA -> manifest -> pointer last). Immutable versions; `restore` re-verifies before re-pointing.
4. **Preview** `preview/prepare_preview.py` resolves the `current` symlink into real files, verifies MANIFEST and health, writes vercel.json (no-store, noindex); deploy is a preview deployment to `egx-pro-decision-preview` only; `preflight.py deploy` checks the live URL serves the expected snapshot hash.

## What is NOT done yet (blocking production, stated honestly)
* No bucket, no credentials and no Vercel project exist yet -> the daily workflow is disabled and cannot run; see `docs/SETUP_OWNER.md`. The S3 code path is tested with a fake client only; it has never talked to a real S3/R2.
* No public preview URL exists. The `vercel deploy` step is unexecuted code.
* Corroboration/official-disclosure ingestion (to calibrate provider disagreement) is a separate source and is not built.
