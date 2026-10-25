# PR97 — Real Git end-to-end publication tests

The new `tests/stable/history-real-publication-e2e.test.cjs` creates a real temporary bare Git repository and independent clones. It exercises actual `history-safe-publish.cjs` using the real Git reference-based writer lock and Git-commit-backed publication journal.

Tested sequences:
- Acquire exclusive Git writer ref, persist PREPARED/PUSH_PENDING, perform a real rebase and push, confirm remote main SHA, persist PUBLISHED, and confirm that a new independently cloned checkout can read the finalized record.
- Reject a push to the test remote with a pre-receive hook; the journal remains PUSH_PENDING and a separate clone correctly diagnoses that the remote main SHA is still at the original commit.
- Reject a competing writer while the exclusive Git lock ref is occupied.

**Critical test limitation:** The e2e fixture injects `proofCheck: () => ({status:'PASS', ...})`. It does NOT validate real R8/R9 or an actual 200-row market session. It proves Git transport + journal + lock orchestration only, not price integrity or trading readiness. Local bare Git server, NOT GitHub hosted. No testing yet of runner kill mid-commit, all existing workflow writers, expiry/reclaim, remote service outages, or authorization policies.

Keep PR #97 Draft. No production guarded integration, no main branch merge, no reduction of 200-row gate.
