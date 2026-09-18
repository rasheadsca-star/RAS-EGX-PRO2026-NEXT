# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-18T16:18:28.411Z
- Code HEAD evaluated: d2da4f675ceeed6c18d9f5e8cf3436b2db4e9360
- Intended mapped universe: 243
- Active universe: 224
- Intentionally excluded: 19
- Latest expected finalized session: 2026-09-17
- Latest available canonical session: 2026-09-17
- Session freshness: CURRENT
- Valid current canonical securities: 210/224
- Pipeline-ready V16 source-feature securities: 208/224
- Production strategy readiness: 208/224 Security×Strategy rows
- Current unified-pipeline valid opportunities: 3
- Current unified-pipeline legacy-network calls: 0
- CRITICAL unresolved issue classes: 0
- HIGH unresolved issue classes: 2
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (9 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe after deterministic legitimate session exceptions (11 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 224/224
- Current valid canonical universe: 210/224
- Decision-ready universe: 208/224
- Regime-ready universe: 208/224
- Current-universe gaps: 9; disposition accounting closes exactly (STALE_DATA=8, SOURCE_INGESTION_FAILED=1).
- Previously unverified history-source mappings reviewed: 0; resolved=0; unresolved=0.
- Stale production-critical records: 13; documented legitimate session exceptions=5; unresolved=8.
- Current DecisionSnapshot: G09-DS-dcc39709d3803a255a5b0f6d; semantic hash=dcc39709d3803a255a5b0f6d682c3870123a9f7c31172a10f4a61b80916eddf9.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
