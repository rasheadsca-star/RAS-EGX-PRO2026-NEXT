# Canonical Schemas and Executable Contracts — G06

Authoritative executable implementation: `astra/contracts/canonical-contracts.cjs`.

## Canonical entities

The contract exports **19 executable schemas**:

1. `ImplementationProvenance`
2. `SecurityMaster`
3. `MarketSession`
4. `CanonicalMarketSnapshot`
5. `IndicatorSnapshot`
6. `StrategyExecution`
7. `StrategySignal`
8. `EvidenceItem`
9. `AgreementSnapshot`
10. `DecisionSnapshot`
11. `RiskPlan`
12. `BasketPlan`
13. `RecommendationRecord`
14. `MorningConfirmationRecord`
15. `ForwardOutcome`
16. `PortfolioPosition`
17. `DataHealthRecord`
18. `DiagnosticRecord`
19. `MigrationProvenance`

Validation is dependency-free and executable in Node 22 through `validateEntity()` / `assertValidEntity()`.

## SecurityMaster

Owns stable `securityId`, ticker/normalized ticker, company name, sector, listing status, aliases/previous symbols and effective-date ranges. Symbol aliases never replace stable security identity.

## MarketSession

Requires `sessionId`, `sessionDate`, `timezone`, market status and trading-day identity. `timezone` is fixed to `Africa/Cairo`.

## CanonicalMarketSnapshot

Requires snapshot/security/ticker/session identity plus OHLC, volume, turnover, previous close, returns, volatility, liquidity metrics, technical inputs, S/R inputs, data source, source timestamp, freshness, validation status and schema version. Unknown volume/turnover/source timestamp may be null; OHLC required by this canonical snapshot contract must not be fabricated.

## StrategyExecution and StrategySignal

`StrategyExecution` is the lossless envelope for all 18 discovered strategy identities. It preserves provenance, raw input, raw output, normalized signal, eligibility, rejection reason, evidence, diagnostics and execution version. Normalization never destroys or substitutes the raw payload.

Strategy version identity is deterministic from strategy identity + known semantic version + source commit + parameter hash + rules/config hash.

## EvidenceItem and AgreementSnapshot

Evidence is typed by source kind and includes point-in-time session/as-of identity plus provenance/quality. Agreement references eligible strategy executions and explicitly carries method-independence metadata.

## DecisionSnapshot

`decisionSnapshotId` binds:

- canonical market snapshot
- market regime
- strategy execution refs/versions
- agreement
- evidence
- ranking version
- risk version
- `sessionDate`
- `asOfSessionDate`
- `generatedAt`
- application version
- code version

`buildDecisionSnapshotId()` is deterministic. Decision surfaces must not mix snapshot IDs.

## RiskPlan, BasketPlan and position sizing

Risk and basket plans are downstream of ranking. They cannot generate alpha evidence. Basket failures have an explicit failed-weight policy.

## Immutable forward records

`RecommendationRecord` is immutable after issuance. `assertRecommendationImmutable()` checks rank, entry/stop/targets, evidence, regime, strategy set and identity fields. Morning confirmation and forward outcome are separate entities linked by recommendation ID.

## Migration provenance

`MigrationProvenance` requires stable migration/canonical IDs, source ID, nullable legacy engine/version/strategy IDs, `sourceBranch`, exact `sourceCommit`, source path, original identity/timestamp where available, session date where available, SHA-256 content hash, migration version/timestamp, transformation rules, validation status and source relationship.

`migrationStableId()` makes reruns deterministic. `reconcileClass()` classifies overlap without a latest-row-wins policy.

## Time fields and writers

| Field | Meaning | Authorized writer class |
|---|---|---|
| `generatedAt` | wall-clock record materialization | producing module |
| `sessionDate` | EGX trading session identity | market-calendar / canonical-data |
| `asOfSessionDate` | latest session allowed in decision inputs | analysis/decision orchestrator |
| `sourceDate` | date declared by original source | source adapter / migration |
| `importedAt` | ingest/migration timestamp | migration / canonical ingest |
| `evaluatedAt` | later evaluation timestamp | forward verification / confirmation / backtest / walk-forward |

`assertTimeSemantics()` rejects the use of `generatedAt` as an implicit replacement for missing `sessionDate` or `asOfSessionDate`.

## Data health status model

Required future G11 dimensions are exported as constants:
`UNIVERSE_COVERAGE`, `OHLC_COVERAGE`, `VOLUME_COVERAGE`, `TURNOVER_COVERAGE`, `HISTORY_DEPTH`, `INDICATOR_COVERAGE`, `SUPPORT_RESISTANCE_COVERAGE`, `STRATEGY_COVERAGE`, `EVIDENCE_COVERAGE`, `STALE_DATA`, `MISSING_SESSIONS`, `DUPLICATE_SESSIONS`, `SYMBOL_MAPPING`, `MIGRATION_COVERAGE`.

This contract defines measurement vocabulary only; G11 remains pending.
