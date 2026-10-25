# PR #97 — Concurrent history writers: blocking finding (2026-10-25)

Review basis: main `05c77642b887e2580b5b461550ad412e780b06ed`. This document is a **risk finding, not a completed production fix**.

## Verified concurrent writer hazard
- `.github/workflows/v16-daily-recommendation-scan.yml:46-48,327`: group `egx-main-app-v1692-p2-canonical`, `cancel-in-progress: false`, `git add data/history`.
- `.github/workflows/mobile-hotfix-deploy.yml:29-31,167`: group `egx-v16-immediate-market-rescan-pages`, `cancel-in-progress: true`, `git add data/history`.
- `.github/workflows/main-app-market-coverage-repair.yml:21-23`: third group `main-app-v1692-market-coverage-repair`; inspect commit steps to establish whether it modifies per-ticker history.

The first two can execute concurrently because their concurrency groups differ. A transaction journal local to one runner does **not** protect against independent GitHub Actions runners. `cancel-in-progress: true` risks interrupting a writer at an arbitrary stage.

## Merge-blocking acceptance criteria
1. Review **every** workflow/script that can write `data/history/<ticker>.json` or stage/commit/push that path, including indirectly invoked scripts. Text-search results and workflow `git add` are candidates, not complete proof of mutation.
2. All direct/indirect history-writing workflows must use one shared `concurrency.group` with `cancel-in-progress: false`; account for workflow nesting and separate triggers. A repository-level locking protocol may be needed if uncoordinated actors or non-Actions writers exist. Grouping protects only Actions runs participating in that group.
3. Add a static CI guard enumerating eligible writers (including indirect invoked scripts) and verifying shared group/no cancel. Include negative fixtures: wrong group, missing group, `cancel-in-progress: true`, hidden indirect writer.
4. Implement and fault-test intent journal + recovery with recovery before any new write, reject/publish gate before `git push`, and compare accepted manifest SHA-256 with stored history for every accepted ticker.
5. The guarantee is limited: recovered, completed runs expose consistent state. Direct readers during an incomplete local transaction may observe intermediate state; published readers must only consume completed, validated commits. Do not claim atomic cross-file visibility.
6. Confirm source/date/manifest exclusions; quarantine metadata consistency and deduplication; restoration; and preserved historical sessions.

## Outstanding evidence
- Independent full consumer/writer classification from Claude's read-only CSV, including line-by-line verification of the eight candidate workflows.
- Raw input records for the 15:15 and 16:04 scans (MIPH, FAIT, EALR, SEIG).
- Official EGX suspension/resumption evidence for POUL/ORHD.

Until all acceptance criteria pass, keep this PR Draft and unmerged. PR #96 is separate. Do not relax the 200-row handoff gate.
