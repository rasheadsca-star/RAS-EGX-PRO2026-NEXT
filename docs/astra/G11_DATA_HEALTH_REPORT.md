# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-18T14:58:19.243Z
- Code HEAD evaluated: 2ce656421b0d0242fb6a92f026a3878ba01bf153
- Intended mapped universe: 243
- Active universe: 226
- Intentionally excluded: 17
- Latest expected finalized session: 2026-09-17
- Latest available canonical session: 2026-09-17
- Session freshness: CURRENT
- Valid current canonical securities: 210/226
- Pipeline-ready V16 source-feature securities: 208/226
- Production strategy readiness: 208/226 Security×Strategy rows
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
- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (16 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe (18 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 226/226
- Current valid canonical universe: 210/226
- Decision-ready universe: 208/226
- Regime-ready universe: 208/226
- Current-universe gaps: 16; disposition accounting closes exactly (STALE_DATA=15, SOURCE_INGESTION_FAILED=1).
- Previously unverified history-source mappings reviewed: 1; resolved=0; unresolved=1.
- Stale production-critical records: 15; resolved=0; unresolved=15.
- Current DecisionSnapshot: G09-DS-5118b099a50d002b33a51358; semantic hash=5118b099a50d002b33a51358824255a2f4bf449d8b829bfd8f6e84f835941658.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
