# EGX PRO Standalone Target Architecture — G06

## Status and scope

This document defines the G06 target architecture only. It does not cut over production, execute the full historical migration, redesign the UI, or mark G07/G12+ complete.

Discovery baseline is preserved at **20 engines, 18 strategy families/modules, 19 historical store groups and 8 actionable legacy runtime/build dependencies**. No material G06/G07 discrepancy was found in the discovery manifests.

## Target pipeline

`Canonical Market Data → Market Regime → Internal Strategy Farm → Signal Normalization → Evidence Engine → Agreement → Ranking / Decision Score → Risk / Basket / Position Sizing → Execution Plan → Immutable Forward Ledger → Forward Verification → Historical Analytics`

The target production invariant is:

`runtimeLegacyDependencyCount = 0`

Legacy implementations may be read only for discovery, migration, golden-master parity and historical provenance. They are forbidden as production runtime dependencies after cutover.

## Core architecture rules

1. **No God Engine.** Boundaries are machine-defined in `ARCHITECTURE_BOUNDARIES.json`.
2. **Point-in-time data first.** `canonical-data` owns validated market snapshots. Strategy code cannot fetch legacy engines or substitute persisted legacy decisions for live calculations.
3. **One decision identity.** `DecisionSnapshot.decisionSnapshotId` binds canonical market snapshot, regime, strategy executions, evidence, agreement, ranking/risk versions, session/as-of dates, application version and code version. Decision-related Top 5, stock detail, regime and S/R surfaces must reference the same snapshot.
4. **Raw output preservation.** Every `StrategyExecution` retains raw input, raw output, normalized signal, eligibility/rejection, evidence, diagnostics and deterministic version identity.
5. **Immutable issuance.** `RecommendationRecord` is append-once/immutable. `MorningConfirmationRecord` and `ForwardOutcome` are separate records and cannot rewrite original rank, plan, evidence, regime or strategy set.
6. **Evidence classes remain separate.** Development, reused holdout, retrospective/backtest, validation and true forward evidence are not merged into one statistic.
7. **Missing means unknown.** Nullable fields remain null/unknown; migration never invents missing provenance or values.
8. **Raw legacy archive and normalized history are separate.** Original records are retained immutably and normalized records back-reference provenance.
9. **No general latest-row-wins.** Historical overlap is classified and reconciled by identity, provenance and content hash.
10. **QUANT_EDGE remains `legacy-output-only`.** Its historical outputs can be preserved and reported; no internal production algorithm may be fabricated under that name.

## Required module boundaries

The authoritative machine-readable list is `ARCHITECTURE_BOUNDARIES.json` and includes 30 modules:

- data/reference: `canonical-data`, `market-calendar`, `symbol-master`, `corporate-actions`
- analysis: `market-regime`, `indicators`, `technical-analysis`, `support-resistance`, `relative-strength`, `vcp`, `liquidity`
- strategy: `strategy-registry`, `strategy-runner`, `signal-normalizer`
- decision: `evidence-engine`, `agreement-engine`, `ranking-engine`
- risk/execution planning: `risk-engine`, `basket-engine`, `position-sizing`, `morning-confirmation`, `portfolio`
- validation/history: `backtest`, `walk-forward`, `forward-ledger`, `historical-store`, `migration`, `data-health`, `diagnostics`, `certification`

Every module declares responsibility, allowed imports, forbidden imports, allowed data access, forbidden runtime services, inputs, outputs, persistence ownership and versioning requirements.

## Provenance for branch-only/diverged implementations

No branch name alone is an acceptable historical identity. The executable `ImplementationProvenance` contract requires:

- `sourceBranch`
- `sourceCommit`
- `sourcePath`
- `detectedEngineVersion`
- `detectedStrategyVersion`
- `extractedAt`
- `evidenceHash`
- relationship: `SAME | SUPERSEDED | DIVERGED | EXPERIMENTAL | UNKNOWN`

Competing branch implementations remain separate until evidence proves their relationship. A missing exact commit blocks parity execution for that case; it does not authorize choosing a branch tip.

## Strategy version identity

A strategy version is not inferred from display text. `buildStrategyVersionId()` hashes:

`strategyId + semantic/internal version + sourceCommit + parameterHash + ruleConfigHash`.

The 18 discovered strategy identities are registered in the executable contract. If one historical row lacks a component of version identity, the component is recorded as unknown in provenance; historical attribution is not silently upgraded.

## Time semantics

Fields are distinct by contract:

- `sessionDate`: trading-day identity, written by `market-calendar` / `canonical-data`
- `asOfSessionDate`: maximum market session information allowed into an analysis/decision, written by the decision/analysis orchestrator
- `generatedAt`: wall-clock materialization timestamp, written by the record producer
- `sourceDate`: source-declared date, written by source adapters/migration
- `importedAt`: ingestion/migration timestamp
- `evaluatedAt`: outcome/confirmation/backtest evaluation timestamp

`generatedAt` cannot stand in for `sessionDate` or `asOfSessionDate`. Tests enforce explicit fields and offset-aware timestamps. EGX session timezone is `Africa/Cairo`.

## Historical reconciliation contract for G07

Stable reconciliation uses semantic record type, engine/strategy provenance, branch+commit+path, original timestamp, session date, recommendation/decision identity and SHA-256 content hash. Overlaps are classified as:

`exact duplicate | semantic duplicate | versioned successor | conflicting record | partial duplicate | independent evidence | unresolved`.

Conflicts are preserved until deterministic provenance evidence resolves them. Migration is designed to be idempotent through stable IDs, hashes, uniqueness constraints, deterministic transforms and checkpoints.

## Runtime dependency elimination

`LEGACY_REMOVAL_PLAN.json` covers all 8 discovered dependencies with replacement module, prerequisite, removal step, isolation test and cutover criterion. G06 creates the replacement contracts only; it does **not** remove the dependencies or mark G12 green.

The executable `legacy-isolation.cjs` skeleton detects old deployment requests, legacy engine imports, proxy rewrites, iframe paths, persisted-decision fallbacks and uncontrolled remote strategy execution. It intentionally scans the future target runtime path rather than declaring the existing monorepo clean.

## Data health contract

Future G11 health records use machine-readable dimensions for universe/OHLC/volume/turnover/history/indicator/SR/strategy/evidence/migration coverage plus stale data, missing sessions, duplicate sessions and symbol mapping. Overall status is `GREEN | AMBER | RED | UNKNOWN`; missing coverage cannot be converted to a neutral zero.

## G07 preparation boundary

`MIGRATION_MANIFEST.json` maps 19/19 discovered store groups. Exact record counting and actual migration are deferred to G07 extraction. `PARITY_MANIFEST.json` prepares representative cases for all 18 recoverable strategy identities plus QUANT_EDGE output-integrity-only checks. Branch-only parity cases with unresolved exact commits are explicitly blocked from execution until the commit is pinned.
