# PR97 — Orphaned Git lease recovery: no automatic takeover

The new `history-lease-recovery-policy.cjs` performs a **read-only** decision on a lost or orphaned writer lease. Test cases cover missing owner ref, different SHA, active owner, unknown termination, indeterminate publication state, and a terminated owner with no publication. The policy never silently deletes, steals, expires or overwrites a lock.

A terminated GitHub Actions run is insufficient evidence to reclaim: the publishing transaction needs a **persistent** run journal and comparison of the published main commit and manifest before deciding rollback, roll-forward, or operator-authorized release. `PUBLISH_UNCERTAIN` is a hard block. The status `MANUAL_REVIEW` is *not* permission to delete the lock.

This policy is a unit-tested safety boundary, **not** an automated orphan-lock recovery implementation. It does not query GitHub's Actions API, prove termination, detect publication from immutable run evidence, obtain administrative approval, or implement an atomic delegated reclaim.

Mandatory next tasks: durable published intent; exclusive writer enforcement for all workflows; owner token identity/fencing; real GitHub-hosted permission and lock branch tests; publication transaction end-to-end with simulated terminated runner. PR remains Draft; no production enablement or readiness-threshold change.
