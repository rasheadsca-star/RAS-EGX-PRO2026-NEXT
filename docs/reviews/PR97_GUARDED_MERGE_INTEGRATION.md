# PR #97 — Journal-backed guarded merge, non-production

The guarded producer (`EGX_HISTORY_GUARDED_INTEGRATION=1`) now uses `scripts/stable/history-guarded-merge.cjs` instead of the legacy direct merge. It stages accepted price-history updates, writes a local disk intent journal, applies the changes, and runs the R8 historical-integrity callback. On a normal exception or injected interruption, it attempts to restore all affected files from the original bytes; the test suite covers this behavior.

**Limits**:
- The journal is in the runner checkout. It is not durable if a GitHub Actions runner disappears and is not locked against other runners. The guarded flag must remain **OFF** in production until persistent storage and comprehensive writer locking are supplied.
- `complete()` removes the local journal after the in-run R8 callback. Subsequent report generation, full R9 assessment/publication verification, git pull/rebase, and push are outside this transaction and are **not rollback-protected**.
- The guarded producer currently declines scans with fewer than the unchanged 200 verified *history writes*. Its real known dataset (193 accepted, 171 writable) must fail closed, and the four stale rejected candles must be quarantined by an independently verified flow first.
- `history-prepush-proof.cjs` is an independently tested CLI, **not** connected to the publishing workflow. The phase B post-rebase snapshot, durable publication-pending journal, and all-writer coordination are still missing.
- This implementation is a prototype for failure-mode testing and review, **not a permission to merge PR #97**.

Required next phase: freeze assessment and full report together outside Git checkout, apply journal under a cross-run lock, integrate rejected-candle quarantine and R9 checks before completing the journal, persist publication intent outside ephemeral runner, and perform R8/R9/prepush proofs after rebase immediately before push. Provide interruption tests at each transition.
