# PR97 — Publication journal wired into safe-publish prototype

The `history-safe-publish.cjs` publisher now accepts an optional `journal: {store,input}`. The store can be `publicationJournal(gitBackend({cwd:root}))` backed by Git ref commits, and the publisher checks the run ID, base SHA, target SHA, and manifest digest before a push.

After rebase and R8/R9/publication proof, the publisher:
1. Gets local target and remote-tracking base commit IDs.
2. Persists PREPARED and then PUSH_PENDING through the journal CAS backend **before** calling git push.
3. Verifies lease ownership and attempts the git push.
4. Reads the remote branch SHA after a successful transport result and compares it with the journal's exact target SHA.
5. Only after exact remote confirmation marks PUBLISHED through durable CAS.

On transport error, the record stays PUSH_PENDING. On different remote branch SHA, it also stays PUSH_PENDING; there is no silent overwrite, rollback, automatic retry or lock release.

The new CI integration tests cover confirmed publication, failed push retaining PUSH_PENDING, wrong remote head, and mismatched target commit. They use an in-memory journal in the publisher integration test; the separate `history-publication-git-store.test.cjs` tests Git persistence across two independent local Git clones. This is NOT yet a single end-to-end test combining a true Git backend, complete R8/R9 evidence, writer fencing, and remote publish.

**Not production ready**: No deployed workflow invokes `publish()`, existing writers can bypass the lock, guarded producer remains OFF, no true GitHub-hosted remote permission test, no durable full price-data rollback across dead runners, and a final post-rebase phase-B baseline and complete proof remain to be independently verified. The journal parameter is optional for legacy tests; do not treat that as production enforcement. Remain Draft; do not relax the 200-row gate.
