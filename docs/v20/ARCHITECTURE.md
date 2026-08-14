# EGX PRO V20 — Integrated Decision Platform Architecture

## Composition

V20 is not a merge-by-copy. It is a governed composition:

1. **V17 Governance Spine** — session truth, data health, execution gates, immutable ledger, S/R and liquidity validation.
2. **V16 Champion Reference** — `V16_9_EQUAL_WEIGHT_BASKET` remains the production Champion until fresh independent evidence passes release review.
3. **V19 Research Intelligence** — probability ranking and risk-budget challenger remain isolated research signals.
4. **V18 Experience Reference** — UI/UX, stock analysis, explainability, backtesting and reporting ideas are imported only after independent audit.
5. **V20 Integration Contract** — one decision snapshot that can never upgrade execution eligibility beyond the V17 final gate.

## Non-negotiable invariants

- `main`, V16 frozen, V17 and V19 reference branches are never mutated by V20 development.
- Active Champion is `V16_9_EQUAL_WEIGHT_BASKET` until an explicit release review changes it.
- `automaticPromotion=false` and `promotionAllowed=false` in the integrated layer.
- A local row-level execution flag cannot override the global execution gate.
- If `executionGrade=false`, V20 must show zero recommended exposure and no ACTIONABLE opportunities.
- Current research candidates and historical Champion references are never presented as current executable recommendations when their sessions do not align.
- V19 challenger output is research-only until fresh independent evidence exists.
- V18 performance evidence is rejected until its definitions and backtest inconsistencies are audited.
- Existing V17 immutable ledgers/hashes are read-only inputs; analytical enrichment must not rewrite prior signal identity.

## Integrated decision contract

`scripts/v20/build-integrated-decision-snapshot.cjs` produces `data/v20/current.json` with:

- market/data/execution status;
- verified session date;
- coverage, freshness, critical fields, conflicts and missing symbols;
- Champion/Challenger governance state;
- portfolio risk state, exposure and cash;
- top research opportunities with explicit status: `ACTIONABLE | WATCH | WAIT | AVOID`;
- S/R and liquidity provenance;
- separate data confidence and execution confidence;
- V19 shadow candidates in a separate research section;
- V18 external reference state.

## Fail-closed precedence

Execution eligibility is evaluated in this order:

1. V17 final `executionGrade` and readiness must be true.
2. Session must be aligned and verified.
3. Candidate must not be blocked/precision-risk/conflicted.
4. Candidate must pass V17 liquidity eligibility.
5. Candidate S/R must be execution-eligible.
6. Trade geometry must be valid.
7. Portfolio allocation guard must pass.

If any earlier gate fails, later positive flags cannot upgrade the decision.

## Evidence separation

- Historical V16 evidence: benchmark/reference.
- V17 current-session evidence: governance and execution readiness.
- V19 evidence: challenger research/shadow only.
- V18 evidence: pending independent audit.
- Forward evidence: future immutable V20 paper ledger stage; never mixed with historical backtests.
