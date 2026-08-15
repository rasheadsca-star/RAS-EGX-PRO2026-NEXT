# V20 Phase 20 — V18 Performance Evidence Audit Gate

## Purpose

V18 remains an important reference for research experience, stock analysis, explainability and UI/UX. Its historical performance claims, however, are not automatically accepted as V20 evidence.

The project requirements record materially conflicting V18 trade-count claims: **16**, **971** and **1138**. These numbers are preserved as audit triggers only. They are not treated as trades, returns, samples or calibration observations until one reproducible V18 source artifact explains the discrepancy.

## Machine-readable authority

- `scripts/v20/build-v18-performance-audit.cjs`
- `data/v20/v18-performance-audit.json`
- `scripts/v20/v18-performance-audit-regression.cjs`
- `data/v20/v18-performance-audit-regression.json`
- `data/v20/performance-evidence-registry.json#externalReferences.v18`

## Required definitions

A V18 performance source cannot be accepted until it provides all of the following in a reproducible evidence boundary:

1. source artifact;
2. trade definition;
3. signal universe;
4. holding period;
5. In-Sample definition;
6. Out-of-Sample definition;
7. Walk-forward definition;
8. Multi-horizon definition;
9. entry timing;
10. transaction-cost treatment;
11. overlapping-position and portfolio-compounding methodology;
12. conservative Target/Stop same-candle ambiguity policy;
13. independent-holdout definition;
14. reconciliation of the 16 / 971 / 1138 trade-count claims.

## Governance invariants

Even if V18 evidence later becomes reproducible and accepted as a separated performance evidence class, the V18 audit itself cannot:

- infer independent evidence;
- calibrate the V20 Decision Score automatically;
- open the V17 Execution Grade gate;
- create production allocation;
- change the active Champion;
- promote a Challenger automatically;
- create a blended headline performance KPI.

Champion / Challenger governance and the authoritative V17 execution gate remain separate.

## Current expected state

Without a reproducible V18 source artifact inside the isolated V20 evidence boundary, the audit status is:

`BLOCKED_UNTIL_REPRODUCIBLE_SOURCE_AND_DEFINITIONS`

and:

`acceptedForPerformanceClaims = false`

This is a truthful blocked state, not a failure of the V20 research platform.

## UI behavior

The V20 Performance Evidence page exposes the V18 audit explicitly:

- contradictory trade counts are shown as unaccepted claims;
- source reproducibility is shown;
- definition coverage is shown;
- missing methodology definitions are listed;
- the user is told that V18 cannot calibrate V20, open Execution Grade, change Champion or promote Challenger while the gate is blocked.

## CI behavior

The integrated V20 workflow builds the V18 audit before the performance registry, runs a dedicated regression, links the audit into the registry, and fails acceptance if the governance invariants are violated or V18 is accepted without reproducible evidence.
