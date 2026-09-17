# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-17T09:04:04.344Z
- Code HEAD evaluated: 9026e57b5f053f666ae2c5de3fbf168617484925
- Intended mapped universe: 243
- Active universe: 228
- Intentionally excluded: 15
- Latest expected finalized session: 2026-09-16
- Latest available canonical session: 2026-09-16
- Session freshness: CURRENT
- Valid current canonical securities: 216/228
- Pipeline-ready V16 source-feature securities: 208/228
- Production strategy readiness: 208/228 Security×Strategy rows
- Current unified-pipeline valid opportunities: 3
- Current unified-pipeline legacy-network calls: 0
- CRITICAL unresolved issue classes: 0
- HIGH unresolved issue classes: 3
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- **HIGH SYMBOL_IDENTITY_UNRESOLVED** — Active mapped securities lack verified canonical symbol/history identity (1 affected securities).
- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (12 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe (20 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 228/228
- Current valid canonical universe: 216/228
- Decision-ready universe: 208/228
- Regime-ready universe: 208/228
- Current-universe gaps: 12; disposition accounting closes exactly (STALE_DATA=11, SOURCE_INGESTION_FAILED=1).
- Previously unverified history-source mappings reviewed: 1; resolved=0; unresolved=1.
- Stale production-critical records: 11; resolved=0; unresolved=11.
- Current DecisionSnapshot: G09-DS-3e84f0479722a41534c2d9d9; semantic hash=3e84f0479722a41534c2d9d94f48f9650c4f203a53cbdfa022408f66e5cfaec7.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
