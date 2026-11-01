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

## What is NOT done yet (blocking production, stated honestly)
* The central SQLite is not stored in the repo. A scheduler needs a durable home for it (release asset / ledger branch / storage bucket) — owner decision.
* No hosting target (Vercel/Pages-preview) is linked to this repo, so no public preview URL exists. The built release is a plain static folder (`public/current/index.html`) deployable anywhere.
* Corroboration/official-disclosure ingestion (to calibrate provider disagreement) is a separate source and is not built.
