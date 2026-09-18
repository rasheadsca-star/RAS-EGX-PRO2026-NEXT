# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-18T17:40:52.649Z
- Code HEAD evaluated: bf635d08cd1a0fc77dd56e4800ca9a8914b6e1c4
- Intended mapped universe: 244
- Active universe: 224
- Intentionally excluded: 20
- Latest expected finalized session: 2026-09-17
- Latest available canonical session: 2026-09-17
- Session freshness: CURRENT
- Valid current canonical securities: 211/224
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

- **HIGH CURRENT_SESSION_GAP** — Active intended securities are missing a validation-approved row for the expected finalized session (4 affected securities).
- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe after deterministic legitimate session exceptions (7 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 224/224
- Current valid canonical universe: 211/224
- Decision-ready universe: 208/224
- Regime-ready universe: 208/224
- Current-universe gaps: 4; disposition accounting closes exactly (STALE_DATA=3, SOURCE_INGESTION_FAILED=1).
- Previously unverified history-source mappings reviewed: 0; resolved=0; unresolved=0.
- Stale production-critical records: 12; documented legitimate session exceptions=9; unresolved=3.
- Current DecisionSnapshot: G09-DS-6f4100537bad8342a456a116; semantic hash=6f4100537bad8342a456a1161c07f835f922239710002db300902e2e4f386567.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
