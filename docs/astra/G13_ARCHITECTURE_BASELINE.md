# G13 Architecture Isolation Baseline

Source HEAD: `8ea3436e9da92fcf20dbc8550ef311478495ce86`

**Gate status: PENDING.** This is a baseline only; no runtime remediation or production cutover was performed.

## Boundary preservation

- G01→G12 GREEN: true
- G12 runtime legacy dependencies: 0
- G12 dependencies closed: 8/8
- productionCutover: false

## Baseline summary

- Logical architecture modules: 30
- Scanned active source files: 47
- Static dependency edges: 142
- HIGH findings: 34
- MEDIUM findings: 16

## Finding classes

- DATA_HEALTH_DECISION_COUPLING: 2
- DIRECT_DATA_PATH_COUPLING: 3
- DIRECT_FILE_IO_BYPASS: 2
- DIRECT_INTERNAL_IMPLEMENTATION_ACCESS: 4
- DIRECT_NETWORK_ACCESS: 1
- FORBIDDEN_LOGICAL_IMPORT: 8
- NO_DEDICATED_IMPLEMENTATION_BOUNDARY: 16
- PHYSICAL_BOUNDARY_COLLAPSE: 6
- UNREGISTERED_ACTIVE_LAYER: 8

## Module physical-isolation map

- canonical-data: NO_PHYSICAL_MAPPING
- market-calendar: NO_PHYSICAL_MAPPING
- symbol-master: NO_PHYSICAL_MAPPING
- corporate-actions: NO_PHYSICAL_MAPPING
- market-regime: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- indicators: NO_PHYSICAL_MAPPING
- technical-analysis: NO_PHYSICAL_MAPPING
- support-resistance: NO_PHYSICAL_MAPPING
- relative-strength: NO_PHYSICAL_MAPPING
- vcp: NO_PHYSICAL_MAPPING
- liquidity: NO_PHYSICAL_MAPPING
- strategy-registry: SHARED_PHYSICAL_ZONE — astra/strategies/g08-final-overlay.cjs, astra/strategies/g08-internal-strategies.cjs, astra/strategies/g08-recovery-overlay.cjs, astra/strategies/g08-strict-overlay.cjs, astra/strategies/g08-v13-parity-repair.cjs
- strategy-runner: SHARED_PHYSICAL_ZONE — astra/strategies/g08-final-overlay.cjs, astra/strategies/g08-internal-strategies.cjs, astra/strategies/g08-recovery-overlay.cjs, astra/strategies/g08-strict-overlay.cjs, astra/strategies/g08-v13-parity-repair.cjs
- signal-normalizer: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- evidence-engine: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- agreement-engine: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- ranking-engine: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- risk-engine: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- basket-engine: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- position-sizing: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- morning-confirmation: NO_PHYSICAL_MAPPING
- portfolio: NO_PHYSICAL_MAPPING
- backtest: NO_PHYSICAL_MAPPING
- walk-forward: NO_PHYSICAL_MAPPING
- forward-ledger: NO_PHYSICAL_MAPPING
- historical-store: NO_PHYSICAL_MAPPING
- migration: DEDICATED_ZONE — astra/migration/g07-migrate.cjs
- data-health: DEDICATED_ZONE — astra/data-health/g11-approved-source-closure.cjs, astra/data-health/g11-current-reviewed-import-preflight.cjs, astra/data-health/g11-current-session-exceptions.cjs, astra/data-health/g11-current-session-refresh.cjs, astra/data-health/g11-current-source-closure.cjs, astra/data-health/g11-data-health.cjs, astra/data-health/g11-decision-dump.cjs, astra/data-health/g11-reviewed-import-preflight.cjs, astra/data-health/g11-source-data-repair.cjs, astra/data-health/g11-v16-domain-exceptions.cjs
- diagnostics: SHARED_PHYSICAL_ZONE — astra/pipeline/g09-unified-decision-pipeline.cjs
- certification: DEDICATED_ZONE — astra/certification/g06-certify.cjs, astra/certification/g08-certify.cjs, astra/certification/g09-certify.cjs, astra/certification/g10-certify-final.cjs, astra/certification/g10-certify.cjs, astra/certification/g11-carry-forward-guard.cjs, astra/certification/g11-certify.cjs, astra/certification/g11-derived-build-failures.cjs, astra/certification/g11-external-data-finalize.cjs, astra/certification/g11-finalize-evidence.cjs, astra/certification/g11-guard37-evidence.cjs, astra/certification/g11-repair-destructive.cjs, astra/certification/g11-repair-finalize.cjs, astra/certification/g11-source-dispositions.cjs, astra/certification/g12-certify.cjs, astra/certification/g12-r01-parity.cjs, astra/certification/g13-architecture-baseline.cjs, astra/certification/legacy-isolation.cjs

## Interpretation

G13 cannot be certified from this baseline while HIGH findings remain or logical modules cannot be proven isolated behind their declared contracts. Remediation must proceed one issue family at a time, followed by G01→G12 regression and a final G13 certification.

