# PR97 safe-publish proof-of-concept — NOT production authorized

Added `scripts/stable/history-safe-publish.cjs` with an explicit opt-in API. It refuses to proceed without a caller-supplied `lockConfirmed=true`, immutable input files, a clean checked-out target branch, a clean status before the fetch/rebase, and an R8/R9/manifest **post-rebase** proof. It uses `git rebase origin/main` without `-X ours` and attempts a normal push only after all checks. Negative tests assert that no push occurs after invalid/dirty input or a failed proof.

**This is not a production-ready or comprehensive concurrency solution.**

- `lockConfirmed` is only a caller assertion. It does **not** acquire, verify, lease, or renew a repository-wide lock. No deployed workflow invokes this wrapper.
- No branch change detection or persistent transaction publication-pending phase exists across runners. An ephemeral runner can lose the local journal and frozen input between update and push.
- A mocked-test confirmation of not pushing is not evidence that all real history writers comply. Writers running in other workflows still use unsafe rebase or update paths.
- A normal push may lose a race; failure must be treated as a failed transaction, never silently retried with `-X ours`.
- This wrapper assumes the complete prepared history/report commit already exists on the target branch and does not stage or commit it. End-to-end publication and recovery are still unimplemented.
- Never turn on the guarded producer flag or merge the draft PR before independent real-runner testing with all writer classes locked and persistent evidence recovery.

Priority next: enforce shared locking with a durable lease/commit protocol (not a boolean), publish immutable run evidence, then test all lifecycle failure windows and writer races.
