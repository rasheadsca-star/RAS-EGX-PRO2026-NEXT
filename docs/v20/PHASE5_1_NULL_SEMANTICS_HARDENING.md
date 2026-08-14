# V20 Phase 5.1 — Null Semantics Hardening

## Why this phase exists

Phase 5 correctly sanitized invalid current-session OHLC fields to `null`, but a downstream Market Explorer helper used `Number(null)`, which converts JavaScript `null` to numeric zero. That reintroduced `0` into fields that had already been marked missing. The same helper pattern existed in several V20 production builders and UI formatting helpers.

## Contract

For V20 production decision-support layers:
- `null`, `undefined`, and empty string are missing values and must remain missing;
- missing values must never be converted to numeric zero merely by coercion;
- zero remains valid only where the field semantics explicitly allow zero;
- UI formatting renders missing numeric values as an em dash, never `0`;
- Snapshot nulls must remain null in Market Explorer;
- technical nulls must not become zero in Stock Profiles;
- current-session price checks still require positive price;
- no hardening step may upgrade V17 execution status.

## Immutable archive exception

`scripts/v20/archive-signal.cjs` and the corresponding Phase 3 hash regression deliberately retain their historical numeric canonicalization semantics. They are excluded from the null-semantics refactor to avoid changing the canonical hashes of previously issued signals.

## Enforcement

`apply-null-semantics-hardening.cjs` is deterministic and idempotent. It only replaces known unsafe helper patterns and fails if the expected source shape changes unexpectedly.

`null-semantics-regression.cjs` verifies:
- hardened source guards are present;
- UI missing values render as missing;
- null fields survive Snapshot → Market Explorer propagation;
- technical nulls are not fabricated as zeros;
- immutable archive compatibility semantics are preserved.
