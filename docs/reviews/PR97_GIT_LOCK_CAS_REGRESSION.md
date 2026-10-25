# PR97 — CAS-verified Git history lock creation (regression R29)

Git ref lease acquisition previously used a **plain non-force git push** to create `refs/heads/egx-history-writer-lease`. This was not unconditionally create-only: a descendant token could fast-forward an occupied ref if the acquisition pre-read was stale. Therefore the original claim of atomic creation was too strong.

Change: `history-git-lease-backend.cjs` now uses `git push --porcelain --force-with-lease=REF:0000000000000000000000000000000000000000 REMOTE TOKEN:REF`. The zero expected old-object SHA is Git's explicit **must-not-already-exist** comparison. The existing `history-writer-lease.cjs` verifies the ref after creation; release still uses expected-owner conditional deletion.

Regression fixture: A acquires the ref; a new commit descended from A's token is pushed to the occupied ref through `createRef`; the push must be rejected and the original token must remain in the remote. The test runs against a real local bare Git repository and has passed CI.

**Scope / remaining blockers**:
- Tested on a local bare Git remote, NOT GitHub's actual hosted ref endpoints or branch policies.
- The new conditional create closes a specific fast-forward takeover window. It is **not** a complete lock system: no lease timeout, stale-run fencing, safe reclaim, all-writer migration, remote journal, or publication-pending proof.
- The producer's guarded mode remains disabled in production and the PR remains Draft. No data/history files or 200-row threshold were modified.

Next: prove unique owner-token lifecycle and real-runner permission/ref policies in an isolated GitHub test branch, with the user's express approval before any live remote lock mutation.
