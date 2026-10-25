# PR97 — Writer lease is an API contract, not a deployed distributed lock

The experimental `history-writer-lease.cjs` now demands a backend implementing **atomic create-if-absent**, verified owner-ref reads, and **atomic compare-and-delete**. The safe-publish prototype takes an acquired lease handle with `verify()`, replacing the prior trivially asserted `lockConfirmed: true` boolean. Unit tests exercise competing owners, stolen lease, backend failure, and losing the lease after rebase. **The tests use an in-memory backend.**

This work is NOT a completed real GitHub lock:

- GitHub REST create-ref is atomic on existing refs in normal Git semantics, but **GitHub REST delete-ref does not necessarily support atomic compare-and-delete**; a read followed by delete is NOT a safe substitute. An authenticated ref backend fulfilling this contract has not been implemented or verified.
- A Git ref pointing to an ordinary shared commit is not a unique owner or a lease expiry protocol. A real lock requires owner identity, fencing token, stale-holder recovery, and every history writer honoring it.
- No existing GitHub Actions history-writing workflow has been migrated, and `publish()` is not invoked by a live workflow.
- Only guarding at fetch, rebase, and push does not guard individual history writes by other tasks; all production writers must agree to fencing.
- Ephemeral-runner recovery, publication-pending persistence, and deterministic push retries remain absent.

**Policy:** Keep PR #97 Draft, the guarded integration disabled in production, and the 200-row readiness threshold unchanged. Do not substitute this simulated lease for the real backend.
