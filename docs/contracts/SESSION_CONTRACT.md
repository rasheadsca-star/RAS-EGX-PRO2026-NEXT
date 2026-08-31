# Session Contract

Each scan resolves the latest completed EGX session through exchange-calendar logic plus validated data availability and consumes exactly one immutable Session Manifest. If sufficient data for that session is unavailable, engine state is `DATA_NOT_READY` and old recommendations are not presented as current.

## Authority mode

Every Session Manifest is hash-bound to an `authorityMode`:

- `RESEARCH` — safe default for research, fixtures, forensic replay, and non-production evaluation.
- `CERTIFIED_PRODUCTION` — the only mode eligible to represent production market truth.

Omitting the mode fails safe to `RESEARCH`; production authority can never be acquired implicitly.

A `CERTIFIED_PRODUCTION` Session Manifest is valid only when all of the following refer to the same market session and immutable lineage:

1. `rawDataVersion` resolves to a finalized acquisition whose `expected_session` equals `marketSession`.
2. `normalizedDataVersion` resolves to a finalized `CERTIFIED_PRODUCTION` data snapshot.
3. `sourceManifest` is exactly the source-manifest hash frozen into that normalized snapshot.
4. The source manifest is a reproducible `CERTIFIED_PRODUCTION` reconciliation manifest.
5. Current-session normalized rows carry a certified reconciliation manifest hash and primary market-observation certificate hash.
6. The persisted reconciliation identity, source-manifest hash, authoritative-bar hash, and primary certificate hash reproduce the current normalized row.

A research snapshot cannot be relabeled as production, and a certified production snapshot cannot be silently downgraded to research. `snapshotHash` binds the authority mode and all Session Manifest versions together.
