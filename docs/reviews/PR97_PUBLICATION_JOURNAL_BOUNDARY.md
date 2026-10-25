# PR97 — publication journal state machine, not yet durable storage

Implemented `scripts/stable/history-publication-journal.cjs` as an **abstract CAS-backed** record state machine. It requires an injected backend supporting `read`, atomic `create` and atomic compare-and-swap `cas`; transitions are PREPARED -> PUSH_PENDING -> PUBLISHED. On uncertain push, remote SHA is compared against base and target commit hashes and the module returns a decision requiring verification; it performs **no automatic rollback or lock release**.

The new unit tests use an **in-memory** fake store, including CAS failure, illegal transition, and ambiguous publication. The successful CI run covers this model only. It does **not** persist any record across GitHub Actions runners and has not been wired into `history-safe-publish.cjs`, production workflows or remote GitHub storage.

Production blockers remain: authenticated genuinely persistent CAS store, immutable run evidence, remote journal and Git publication integration, all-writer lock/fencing, failure-window tests, 200-row gate, quarantine completion and independent PR review.

Do not mark R14 or the durable journal complete, do not turn on guarded mode, and do not merge PR #97.
