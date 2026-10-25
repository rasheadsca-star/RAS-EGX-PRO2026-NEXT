# PR97 — enforce 200-row production readiness after actual R8/R9 proofs

The publisher prepush proof now distinguishes data integrity from permission to publish an execution-grade update.

- First R9 verifies the exact run/report classification.
- Then R8 verifies historical integrity; the publication manifest gate verifies allowed current-session rows.
- **Finally**, a hard readiness check requires BOTH `bound.acceptedRows >= 200` and `bound.writtenRows >= 200`. Otherwise it throws `PREPUSH_INSUFFICIENT_EXECUTION_ROWS` before the publication journal is initialized or git push is issued.

The full real Git integration fixture was increased from one ticker to **200 synthetic history files**, testing the actual pass path with real R8, R9, publication manifest, writer ref lease, persistent Git publication journal and independent clone verification. The tiny one-row integrity fixture now correctly tests **rejection for publication**, rather than pretending it is execution-grade. Historical tampering and R9-report tampering still fail as independent blockers.

The PR97 CI job for these changes passed. These are 200 **synthetic** accepted/written rows, NOT 200 verified live EGX prices; there is no independent trading-strategy OOS result. The known live baseline (193 accepted, 171 writable history files) fails this gate as designed. Do not weaken the 200-row requirement, merge PR97, or enable guarded production operations until cross-run recovery, complete writer coordination and quarantines are closed.
