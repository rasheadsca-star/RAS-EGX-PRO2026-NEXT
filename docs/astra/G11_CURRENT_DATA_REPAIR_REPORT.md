# G11 Current Data Repair Report

- Expected session: **2026-09-16**.
- Exact targeted-source identities repaired: **27/42**.
- Remaining identity cases: **15**; production-relevant blockers after alternative-canonical-source check: **18**.
- Original stale set current after repair/recheck: **11/20**; remaining=9.

## Identity disposition counts

- EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE: 3
- PRODUCTION_RELEVANT_EXTERNAL_SOURCE_BLOCKER_NO_APPROVED_CURRENT_ROW: 14
- PRODUCTION_RELEVANT_INVALID_SOURCE_BLOCKER: 1
- REPAIRED_EXACT_SOURCE_ID_CURRENT_ROW_VALID: 24

## Remaining stale cases

- DCCC: latest=2026-07-29; sourceIdentity=SOURCE_RECORD_INVALID; disposition=PRODUCTION_RELEVANT_INVALID_SOURCE_BLOCKER.
- DEIN: latest=2026-09-10; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- EPPK: latest=2026-09-09; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- GPPL: latest=2026-09-08; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- ICLE: latest=2026-09-08; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- MEGM: latest=2026-08-24; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- NDRL: latest=2026-02-04; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- SAIB: latest=2026-09-15; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.
- SPHT: latest=2026-09-13; sourceIdentity=RESOLVED_EXACT_SOURCE_ID; disposition=EXACT_IDENTITY_RESOLVED_CURRENT_SOURCE_ROW_UNAVAILABLE.

No legacy recommendation output, fuzzy symbol substitution, or synthesized carry-forward row is accepted as repair evidence.

## Final G11 recertification

- Gate: **BLOCKED**.
- Source identities repaired: **27/42**; unresolved=15.
- Baseline stale current rows repaired: **11/20**; baseline unresolved=9; current stale records across the repaired universe=17.
- Production strategy: READY=208; legitimate exclusions=0; data-defect blocked=20.
- AMES/GRCA/LUTS/PHGC: AMES=INSUFFICIENT_HISTORY(EMBEDDED_V16_SOURCE_FEATURE_OR_CROSS_SECTION_NOT_READY), GRCA=INSUFFICIENT_HISTORY(EMBEDDED_V16_SOURCE_FEATURE_OR_CROSS_SECTION_NOT_READY), LUTS=READY(DATA_REQUIREMENTS_SATISFIED), PHGC=READY(DATA_REQUIREMENTS_SATISFIED).
- Current canonical=210/228; regime=DEGRADED_PARTIAL_UNIVERSE; legacy-network calls=0.
- CRITICAL=0; HIGH production-relevant=3.
- G12 remains PENDING; production cutover=false.
- DecisionSnapshot: G09-DS-23ef1af5f2d641fe084fc54c (23ef1af5f2d641fe084fc54c1ade8bc6998d6f07a823c6709499e43039e865b3) -> G09-DS-27b6b692e1ca73b47d02d523 (27b6b692e1ca73b47d02d5237a1a245a86116dc29ad68dde15495c416e1625a3); VALIDATION_APPROVED_CURRENT_CANONICAL_INPUTS_CHANGED_BY_G11_SOURCE_DATA_REPAIR.
