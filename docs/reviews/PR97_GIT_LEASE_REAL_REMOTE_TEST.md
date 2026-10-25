# PR97 — Real Git lease-transport proof (local bare remote)

Added `history-git-lease-backend.cjs` with `git ls-remote`, non-force `git push` for creation, and `git push --force-with-lease=REF:SHA origin :REF` for conditional deletion. Unlike earlier mock-only tests, the new tests create a **real temporary bare Git remote and two separate local writer repositories**.

Verified in GitHub Actions CI:
- Writer A creates a unique orphan-commit lease; writer B is denied while the ref exists.
- Once A releases, writer B can acquire its distinct token.
- An overwritten remote lease invalidates A's `verify()`.
- The Git transport's compare-and-delete refuses to delete when the remote SHA differs from the expected owner's SHA.

**Critical constraints:** Not tested against the actual GitHub-hosted repository and its branch protection or authorization. Unique non-ancestor lease-token commits are test fixtures; no production token creator, expiry, reliable stale-owner reclaim/fencing, fully shared writer coordination, or durable publication journal exists. A non-force Git push is not an unconditional create-only primitive if its target could fast-forward; unique root tokens are required and races need additional proof. The `history-safe-publish.cjs` caller still must supply a verified lease object. No live workflow invokes it.

PR #97 remains Draft. Do not activate guarded history integration or claim crash-safe / race-safe production publication.
