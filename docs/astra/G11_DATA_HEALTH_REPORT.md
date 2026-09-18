# G11 Full Data Health Certification

- Gate status: **BLOCKED**
- Overall data-health status: **DEGRADED**
- Evaluated source snapshot: 2026-09-18T18:58:22.124Z
- Code HEAD evaluated: b1256018050054bd1d50ad2ccfb6dd1f68c58521
- Intended mapped universe: 244
- Active universe: 224
- Intentionally excluded: 20
- Latest expected finalized session: 2026-09-17
- Latest available canonical session: 2026-09-17
- Session freshness: CURRENT
- Valid current canonical securities: 213/224
- Pipeline-ready V16 source-feature securities: 211/224
- Production strategy readiness: 211/224 Security×Strategy rows
- Current unified-pipeline valid opportunities: 3
- Current unified-pipeline legacy-network calls: 0
- CRITICAL unresolved issue classes: 0
- HIGH unresolved issue classes: 1
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- **HIGH REGIME_INPUT_INCOMPLETE** — Market-regime/production model inputs cover only a subset of the intended active universe after deterministic legitimate session exceptions (2 affected securities).

## Acceptance decision

G11 is blocked because at least one CRITICAL/HIGH production-critical data-health condition remains unresolved. No aggregate coverage percentage overrides these blockers.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 224/224
- Current valid canonical universe: 213/224
- Decision-ready universe: 211/224
- Regime-ready universe: 211/224
- Current-universe gaps: 0; disposition accounting closes exactly ().
- Previously unverified history-source mappings reviewed: 0; resolved=0; unresolved=0.
- Stale production-critical records: 11; documented legitimate session exceptions=11; unresolved=0.
- Current DecisionSnapshot: G09-DS-64c53bd905bd10fde1bb7eac; semantic hash=64c53bd905bd10fde1bb7eac755b1919dd00820508afe41c14b2befb1e6715c3.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **BLOCKED** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
