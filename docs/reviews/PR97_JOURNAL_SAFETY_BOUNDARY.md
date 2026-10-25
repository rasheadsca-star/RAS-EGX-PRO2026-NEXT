# PR #97 — Transaction journal prototype: safety boundary

The new `history-transaction-journal.cjs` is **NOT wired into the production writer**. Its tests cover durable pre-write intent, interrupted local writes, rollback, and external modification conflicts.

## Non-negotiable production blockers

1. **Cross-run exclusion**: before `begin`, enforce repository-wide writer exclusion for all wrappers/workflows, not only a process-local file. Shared Actions concurrency has a one-pending-run limitation and does not protect external writers.
2. **Persistent recovery**: the journal resides in `data/quarantine/history-transaction-intent.json` and therefore is local to the runner checkout. Ephemeral GitHub runners do not share this filesystem: crash and termination can destroy the journal. Never claim post-run remote recovery based solely on these tests. Move durable log/storage to a persistent place or use a durable Git branch/commit protocol with recovery before any write.
3. **Pre-publication verification**: run the existing producer report binding, negative rejected-candle assertion, R8 integrity check, and published history manifest check after rebase and immediately before push. If any fails, do not push.
4. **Interrupted publication**: `complete()` clears intent after local writes, before any remote push. Production needs a distinct publication-pending state and recovery/roll-forward protocol; otherwise a crash after local completion but before push loses the local changes.
5. **No concurrent mixed-writer checkout**: every direct and indirect writer must be inventoried (including `main-app-intraday-ls1`, import scripts, emergency workflows) and tested against concurrency policy.
6. **Source classification**: duplicated or missing source symbols currently fail closed in optional guarded producer mode. Define deduplication policy before enabling it on live feeds, and preserve 200-row readiness gate unchanged.
7. **Quarantine semantics**: local journal provides snapshots of modified files; it is not a completed per-row quarantine ledger with reasons, prior timestamps, superseded restoration, and crash recovery.

Do not merge this draft PR until these contracts are implemented and independently verified.
