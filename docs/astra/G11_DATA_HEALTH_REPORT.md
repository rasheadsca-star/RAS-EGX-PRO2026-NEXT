# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-16T16:00:58.952Z
- Code HEAD evaluated: 7f18cf27421bcf24d96e7b0d2ca3e7a981eb40e6
- Intended mapped universe: 243
- Active universe: 242
- Intentionally excluded: 1
- Latest expected finalized session: 2026-09-16
- Latest available canonical session: 2026-09-16
- Session freshness: CURRENT
- Valid current canonical securities: 215/242
- Pipeline-ready V16 source-feature securities: 208/242
- Production strategy readiness: 208/242 Security×Strategy rows
- Current unified-pipeline valid opportunities: 3
- Current unified-pipeline legacy-network calls: 0
- CRITICAL unresolved issue classes: 0
- HIGH unresolved issue classes: 3
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- **HIGH SYMBOL_IDENTITY_UNRESOLVED** — Active mapped securities lack verified canonical symbol/history identity (15 affected securities).
- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (27 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe (34 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 242/242
- Current valid canonical universe: 215/242
- Decision-ready universe: 208/242
- Regime-ready universe: 208/242
- Current-universe gaps: 27; disposition accounting closes exactly (STALE_DATA=12, SOURCE_INGESTION_FAILED=15).
- Previously unverified history-source mappings reviewed: 15; resolved=0; unresolved=15.
- Stale production-critical records: 12; resolved=0; unresolved=12.
- Current DecisionSnapshot: G09-DS-cbf8e96cd7c4c3f6b1a64990; semantic hash=cbf8e96cd7c4c3f6b1a649905fe1932c736ec0dfb380ed522502c118913469e5.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
