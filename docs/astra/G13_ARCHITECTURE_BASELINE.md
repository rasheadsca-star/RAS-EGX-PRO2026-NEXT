# G13 Architecture Isolation Baseline

Source HEAD: `1bf5bc9e50ceb7bed4cfdb6ac56b66580959369e`

**Gate status: PENDING.** This is a baseline only; no runtime remediation or production cutover was performed.

## Boundary preservation

- G01→G12 GREEN: true
- G12 runtime legacy dependencies: 0
- G12 dependencies closed: 8/8
- productionCutover: false

## Baseline summary

- Logical architecture modules: 30
- Scanned active source files: 79
- Static dependency edges: 202
- HIGH findings: 0
- MEDIUM findings: 2

## Finding classes

- NO_DEDICATED_IMPLEMENTATION_BOUNDARY: 2

## Module physical-isolation map

- canonical-data: DEDICATED_ZONE — astra/core/canonical-data.cjs
- market-calendar: DEDICATED_ZONE — astra/core/market-calendar.cjs
- symbol-master: DEDICATED_ZONE — astra/core/symbol-master.cjs
- corporate-actions: DEDICATED_ZONE — astra/core/corporate-actions.cjs
- market-regime: DEDICATED_ZONE — astra/pipeline/market-regime.cjs
- indicators: DEDICATED_ZONE — astra/analysis/indicators.cjs
- technical-analysis: DEDICATED_ZONE — astra/analysis/technical-analysis.cjs
- support-resistance: DEDICATED_ZONE — astra/analysis/support-resistance.cjs
- relative-strength: DEDICATED_ZONE — astra/analysis/relative-strength.cjs
- vcp: DEDICATED_ZONE — astra/analysis/vcp.cjs
- liquidity: DEDICATED_ZONE — astra/analysis/liquidity.cjs
- strategy-registry: DEDICATED_ZONE — astra/strategies/strategy-registry.cjs
- strategy-runner: DEDICATED_ZONE — astra/strategies/strategy-runner.cjs
- signal-normalizer: DEDICATED_ZONE — astra/pipeline/signal-normalizer.cjs
- evidence-engine: DEDICATED_ZONE — astra/pipeline/evidence-engine.cjs
- agreement-engine: DEDICATED_ZONE — astra/pipeline/agreement-engine.cjs
- ranking-engine: DEDICATED_ZONE — astra/pipeline/ranking-engine.cjs
- risk-engine: DEDICATED_ZONE — astra/pipeline/risk-engine.cjs
- basket-engine: DEDICATED_ZONE — astra/pipeline/basket-engine.cjs
- position-sizing: DEDICATED_ZONE — astra/pipeline/position-sizing.cjs
- morning-confirmation: DEDICATED_ZONE — astra/forward/morning-confirmation.cjs
- portfolio: DEDICATED_ZONE — astra/portfolio/portfolio.cjs
- backtest: NO_PHYSICAL_MAPPING
- walk-forward: NO_PHYSICAL_MAPPING
- forward-ledger: DEDICATED_ZONE — astra/forward/forward-ledger.cjs
- historical-store: DEDICATED_ZONE — astra/core/historical-store.cjs
- migration: DEDICATED_ZONE — astra/migration/g07-migrate.cjs
- data-health: DEDICATED_ZONE — astra/data-health/g11-approved-source-closure.cjs, astra/data-health/g11-current-reviewed-import-preflight.cjs, astra/data-health/g11-current-session-exceptions.cjs, astra/data-health/g11-current-session-refresh.cjs, astra/data-health/g11-current-source-closure.cjs, astra/data-health/g11-data-health.cjs, astra/data-health/g11-decision-dump.cjs, astra/data-health/g11-reviewed-import-preflight.cjs, astra/data-health/g11-source-data-repair.cjs, astra/data-health/g11-v16-domain-exceptions.cjs
- diagnostics: DEDICATED_ZONE — astra/pipeline/diagnostics.cjs
- certification: DEDICATED_ZONE — astra/certification/g06-certify.cjs, astra/certification/g08-certify.cjs, astra/certification/g09-certify.cjs, astra/certification/g10-certify-final.cjs, astra/certification/g10-certify.cjs, astra/certification/g11-carry-forward-guard.cjs, astra/certification/g11-certify.cjs, astra/certification/g11-derived-build-failures.cjs, astra/certification/g11-external-data-finalize.cjs, astra/certification/g11-finalize-evidence.cjs, astra/certification/g11-guard37-evidence.cjs, astra/certification/g11-repair-destructive.cjs, astra/certification/g11-repair-finalize.cjs, astra/certification/g11-source-dispositions.cjs, astra/certification/g12-certify.cjs, astra/certification/g12-r01-parity.cjs, astra/certification/g13-architecture-baseline.cjs, astra/certification/legacy-isolation.cjs

## Interpretation

G13 cannot be certified from this baseline while HIGH findings remain or logical modules cannot be proven isolated behind their declared contracts. Remediation must proceed one issue family at a time, followed by G01→G12 regression and a final G13 certification.

