# V17 Professional Decision Engine — Pre-open Research Contract

Status: FROZEN BEFORE 2026-08-31 OPEN

This contract is research-only and has no production authority.

- Champion selection core remains V16.
- Evidence anchor is the immutable 2026-08-30 fresh-forward snapshot with SHA-256 `89a9e2ae85a94b6a18ffeb08daff691577db452dd10abd2b7de9e352a188573e`.
- Critical same-session sources: V16, market regime, Triple Engine.
- V20 and Meta are optional evidence inputs; stale optional inputs are explicitly degraded and never silently treated as current.
- Entry study is NEXT_SESSION_ONLY using the frozen entry zone.
- Gap-down recovery fill is prohibited.
- Opening above the entry zone without retrace is recorded as NO_CHASE observation.
- Maximum concurrent observed positions is two, in frozen priority order.
- No same-observation slot reuse.
- Maximum hold is three observed sessions.
- Same-bar target/stop rule is STOP_FIRST.
- Round-trip cost assumption remains 0.60%.
- Original recommendations and snapshot geometry are immutable.
- Outcome-dependent retuning is prohibited.
- Append-only research decisions are hash chained.
- No automatic orders, no automatic promotion, scoringImpact=NONE, alphaWeight=0, productionAuthority=false.

The 2026-08-31 observation must be evaluated against this contract without changing it after the market opens.
