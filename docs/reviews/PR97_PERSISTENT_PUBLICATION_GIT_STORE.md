# PR97 — Persistent Git publication journal backend (R14 groundwork)

`scripts/stable/history-publication-git-store.cjs` implements the previously abstract `publicationJournal({read,create,cas})` backend using dedicated refs `refs/heads/egx-publication-intent/<runId>`.

Records are encoded as `record.json` Git blobs and immutable commits. `PREPARED` creates the ref with an expected-absent (zero-old-object) lease; subsequent `PUSH_PENDING` / `PUBLISHED` create descendant commits and advance the ref with `--force-with-lease=ref:priorSha`. Reads use `git ls-remote` and fetch exact commit IDs, so a fresh runner/checkout can recover the latest committed state. The ref is never deleted or reused.

The new CI tests use a real **local bare Git server** with two independent clones, demonstrating persisted state, independent writer transition, stale-state rejection, and post-push remote SHA reconciliation. The CI job for this implementation completed successfully.

**NOT CLOSED:** This backend is not used by `history-safe-publish.cjs` or the production producer. We have not shown it works with GitHub-hosted ref protection, token scopes, or loss/retry of a remote push. It records metadata only: no durable copies of original history files, no immutable full assessment, no server-verified successful main publication, and no multi-run recovery authority. A privileged adversary who can overwrite protected refs still invalidates its integrity. All history writers must honor the shared lock; none has been migrated.

PR #97 remains Draft. Do not merge or enable guarded production mode; retain the unchanged 200-row history readiness threshold.
