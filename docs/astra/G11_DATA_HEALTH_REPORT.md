# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-18T17:54:35.150Z
- Code HEAD evaluated: c742dfaa4e534af7afc3b5d29f68d29f64586e2a
- Intended mapped universe: 244
- Active universe: 224
- Intentionally excluded: 20
- Latest expected finalized session: 2026-09-17
- Latest available canonical session: 2026-09-17
- Session freshness: CURRENT
- Valid current canonical securities: 213/224
- Pipeline-ready V16 source-feature securities: 209/224
- Production strategy readiness: 209/224 Security×Strategy rows
- Current unified-pipeline valid opportunities: 3
- Current unified-pipeline legacy-network calls: 0
- CRITICAL unresolved issue classes: 0
- HIGH unresolved issue classes: 2
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (2 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe after deterministic legitimate session exceptions (6 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 224/224
- Current valid canonical universe: 213/224
- Decision-ready universe: 209/224
- Regime-ready universe: 209/224
- Current-universe gaps: 2; disposition accounting closes exactly (STALE_DATA=1, SOURCE_INGESTION_FAILED=1).
- Previously unverified history-source mappings reviewed: 0; resolved=0; unresolved=0.
- Stale production-critical records: 10; documented legitimate session exceptions=9; unresolved=1.
- Current DecisionSnapshot: G09-DS-4ea1ce7a520c1e8624782aa8; semantic hash=4ea1ce7a520c1e8624782aa87f2c64a369ad90f961c88119362fcec5696c652e.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
