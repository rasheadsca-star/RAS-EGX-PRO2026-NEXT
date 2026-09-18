# G11 Full Data Health Certification

- Gate status: **GREEN**
- Overall data-health status: **HEALTHY**
- Evaluated source snapshot: 2026-09-18T19:05:47.977Z
- Code HEAD evaluated: 309fdd31273216e647ebf66329e40dce2051a414
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
- HIGH unresolved issue classes: 0
- G07 quarantine leakage: PASS
- QUANT_EDGE: OUTPUT_INTEGRITY_ONLY
- Production eligibility: 1/18 unchanged
- G12: PENDING; all 8 legacy runtime dependencies remain.

## Material findings

- No unresolved material data-health finding.

## Acceptance decision

All G11 production-critical conditions are satisfied or covered by deterministic legitimate exclusions.

The G11 run is non-cutover/shadow certification only. It does not change strategy eligibility, remove legacy dependencies, or start G12.
## Exact final evidence closure

- Searchable active universe: 224/224
- Current valid canonical universe: 213/224
- Decision-ready universe: 211/224
- Regime-ready universe: 211/224
- Current-universe gaps: 0; disposition accounting closes exactly ().
- Previously unverified history-source mappings reviewed: 0; resolved=0; unresolved=0.
- Stale production-critical records: 11; documented legitimate session exceptions=11; unresolved=0.
- Current DecisionSnapshot: G09-DS-af58e4773aaefc9560040705; semantic hash=af58e4773aaefc9560040705a6ca55117c32d3c6f74ce23ee3ce360fc4bea050.
- Current pipeline opportunities: 3; legacy-network calls=0.
- G11 remains **GREEN** unless all CRITICAL and production-relevant HIGH findings are cleared by validation-approved evidence.
