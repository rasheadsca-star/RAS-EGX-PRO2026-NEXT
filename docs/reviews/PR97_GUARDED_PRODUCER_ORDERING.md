# PR97 guarded producer: integration state and ordering contract

The optional `EGX_HISTORY_GUARDED_INTEGRATION=1` path is a **prototype**, not authorized for production. It intentionally fails closed with fewer than the existing 200 execution-grade historical writes and whenever an explicitly rejected current-session producer candle remains. In main's known 193-accepted/171-history state it MUST reject; do not weaken the threshold or disable the gate to force success.

The guarded execution sequence is currently:
1. Determine session and read sources. **Do not run the legacy destructive history repair in guarded mode**; it is deferred until represented in a journal.
2. Normalize/classify and deduplicate accepted rows (but reject duplicate raw input symbols in the adapter).
3. Form full R9 assessment and identify accepted history files and exact removable rejected candles.
4. Capture R8 pre-merge baseline.
5. Check the unchanged readiness threshold and refuse to proceed if rejected contamination requires reconciliation.
6. Merge accepted rows. Verify R8, R9, manifest and negative publication gate. Put frozen assessment outside the checkout.

**Critical gaps:**
- No journal-protected integration yet. A crash during `mergeIntoHistory` could leave partial files. Do not turn the environment flag on for production.
- No supported reconciliation commit for the four already polluted candles in production. The guarded path currently detects them and blocks.
- `history-prepush-proof.cjs` is available but not wired to a real GitHub push/rebase workflow; do not claim publish safety.
- No durable cross-run lock; no remote journal, no tested GitHub-branch publication transaction.
- A post-rebase fresh, persistent **phase B** baseline and complete proof protocol still require implementation. Do not rebaseline after a failed check.
- Existing unrelated deployment workflows may fail or overwrite history. Their status does not establish readiness of this PR.

All claims above require independent code review and end-to-end simulation before a production change.
