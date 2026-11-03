# EGX PRO — Legacy Engine Automation Freeze

Date: 2026-11-03 (Cairo)  
Decision: **STOP automatic execution of weak/redundant/legacy strategy engines; preserve code and research evidence.**

## Scope

79 GitHub Actions workflow files were converted from scheduled, push, or workflow-completion triggers to **manual workflow_dispatch only** in eight Git commits. No strategy source, historical database, official PDF, or stored experiment was deleted.

Grouped changes:
- Astra, legacy main-app, G22, Gann, V16 two-stage supervisor/fan-out
- EGX ONE, V20 consensus, legacy V13/V14 portfolio and scanners
- RC2, Github Pages legacy publications, UCP and dependent orchestrators
- V15/V16 challenger strategies, backtests, pre-close audits
- V17/V18/V20 historical recovery and stale duplicated market scans

## Active systems deliberately preserved

- `update-market-data.yml` — baseline collection; no source deletion
- `egx-central-scheduled-warehouse.yml` — central research data pipeline
- `egx-research-intake-scheduled.yml` — official daily report diagnostics
- `decision-room-daily.yml` — core decision pipeline with source quality gates
- `egx-v4-daily-research-ranking.yml` — 25-stock research/watchlist with no broker orders
- `egx-v4-production-publish.yml` — Git native SHA256 checks, no Vercel direct token
- `egx-portable-backup-and-production-audit.yml` — snapshot backup and live checks
- `security-secret-scan.yml` — repository security scan
- `egx-holiday-daily-watch.yml` — official EGX calendar monitoring

## Rules of operation

1. No legacy engine may become automatically scheduled again without a recorded evaluation comparing incremental performance, data trust, and cost to V4.
2. Manual recovery remains possible from Actions; this is **not** a deletion or strategy ranking judgment.
3. Every legacy push should not create a Production deployment: Vercel project has an Ignore Build Step selecting only actual application/source changes.
4. Do not misrepresent a GitHub commit as a live build; Production sync requires checksum verification.
5. Vercel's current `Deployment rate limited — retry in 24 hours` is a platform quota and is **not** eliminated by repository edits. Reassess quota after scheduled sources settle.
6. V4 signals remain **research-only** pending official ISIN, source, tick-size/board, fees and independent-out-of-sample gates.

## Rollback procedure

Inspect the eight Git commits whose titles begin with `ops: pause`, `ops: suspend`, `ops: freeze`, and `ops: stop` and selectively restore a workflow's original `on:` triggers from Git history after approval. Never restore all 79 automatically.

## Explicit exclusions

- We have **not deleted** any allegedly weak algorithm, because no common independent performance comparison exists yet.
- GitHub Actions triggered manually through the API may still run a parked workflow. Do not dispatch them without explicit authorization.
- Ongoing workflows not in this frozen list might still independently commit; auditing the remaining schedule matrix is a follow-up governance step.
