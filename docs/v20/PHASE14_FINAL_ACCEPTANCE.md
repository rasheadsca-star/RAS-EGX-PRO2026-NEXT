# V20 Phase 14 — Independent Final Acceptance

## Purpose
Produce one conservative acceptance verdict from the existing V20 evidence without allowing a green research/platform result to imply Execution Grade.

## Required separation
The final critic treats these as different questions:

1. **Is V20 internally coherent and usable as a research / investment-decision-support platform?**
2. **Has the authoritative V17 gate granted production Execution Grade?**

A platform may pass the first and fail the second. That is the expected current state.

## Current verdict vocabulary
- `RESEARCH_PLATFORM_READY_EXECUTION_NOT_READY`
- `RESEARCH_PLATFORM_NOT_READY`
- `EXECUTION_PLATFORM_READY_SUBJECT_TO_USER_DECISION`

The execution-ready verdict is impossible while `data/v17/resilient-session-status.json.executionGrade !== true`, while V17 execution readiness is false, or while V17 production reasons remain.

## Evidence consumed
The critic reads current V20 and V17 evidence directly, including:
- governance / risk regressions;
- trade-plan regression;
- semantic data-quality and null-semantics regressions;
- point-in-time technical history regression;
- sector provenance audit/regression;
- separated performance registry/regression;
- self-contained forward evidence/regression;
- market-regime evidence/regression;
- Market Explorer regression;
- local user-portfolio regression;
- UI contract;
- real Chrome browser-smoke evidence;
- V17 resilient session gate.

## Limitations are not hidden
A research-platform pass does not erase limitations such as:
- V17 execution blockers;
- 0 production-verified sector classifications;
- pending forward outcomes;
- partial current technical coverage;
- V18 performance not accepted without reproducible audit;
- no human pixel-level visual review claim;
- legacy R/R mismatches remaining audit-only;
- partial semantic OHLC rows.

## Output
`data/v20/final-acceptance.json` is the authoritative Phase 14 critic output. It includes an acceptance matrix, production blockers, limitations, critic findings, and invariants that prevent execution or governance overclaims.
