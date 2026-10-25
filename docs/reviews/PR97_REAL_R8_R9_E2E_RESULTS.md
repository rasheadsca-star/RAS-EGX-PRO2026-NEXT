# PR97 real Git publication with actual R8/R9 gates

The new `tests/stable/history-real-proofs-e2e.test.cjs` uses actual `history-safe-publish.cjs` and does **not** inject a successful fake proof. It builds a miniature historic-price fixture, captures an R8 baseline, writes a bound R9 report and assessment, commits them, acquires a real Git ref lease, writes publication states to real Git commit storage, rebases, verifies actual R8/R9/manifest gates, publishes to a bare Git remote, and proves an independent fresh clone can read the PUBLISHED state.

Negative cases commit modified R9 report and a modified prior-session history; both are blocked before push by the actual verification gates. The PR97 GitHub Actions workflow passed.

**Scope:** The fixture uses **one ticker** to test proof wiring. It is *not* evidence that production's unchanged **200-row** execution-readiness gate passes. No live EGX data or production workflow is changed. This is a local bare Git remote, not the hosted GitHub repository. All-writer exclusion, durable original-history rollback across killed runners, quarantine reconciliation, phase-B proof and native workflow publication integration remain open blockers. Keep PR97 Draft and guarded producer disabled.
