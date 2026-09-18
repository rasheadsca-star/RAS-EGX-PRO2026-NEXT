# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-18T15:21:44.762Z
- Code HEAD evaluated: b49c0f1e2e2b1e8b8616fb8e553fa6246f43f55c
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
- HIGH unresolved issue classes: 3
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- **HIGH SYMBOL_IDENTITY_UNRESOLVED** — Active mapped securities lack verified canonical symbol/history identity (1 affected securities).
- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (13 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe after deterministic legitimate session exceptions (15 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 224/224
- Current valid canonical universe: 210/224
- Decision-ready universe: 208/224
- Regime-ready universe: 208/224
- Current-universe gaps: 13; disposition accounting closes exactly (STALE_DATA=12, SOURCE_INGESTION_FAILED=1).
- Previously unverified history-source mappings reviewed: 1; resolved=0; unresolved=1.
- Stale production-critical records: 13; documented legitimate session exceptions=1; unresolved=12.
- Current DecisionSnapshot: G09-DS-728d6c41072bbddd664fe014; semantic hash=728d6c41072bbddd664fe01429ae1133ff2f068ac1b89d750827335297a0e10e.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
