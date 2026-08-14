# V20 Phase 9 — Forward Outcome Resolver

## Objective

Turn immutable V20 signal archives into auditable 1/3/5/10/20-session forward evidence **without** rewriting issued signals, inventing trading sessions, or relabeling research opportunity outcomes as production portfolio performance.

## Performance semantics

Each forward evaluation has two explicitly separate result spaces:

1. **Applied Portfolio** — derived only from the exposure and position weights actually issued in the immutable signal core. If issued exposure was 0%, the applied portfolio is cash. Once the requested horizon actually exists, its gross/net return is therefore 0%; before that horizon exists it remains pending.
2. **Research Opportunity Evaluation** — diagnostic evaluation of eligible issued trade plans. It is never applied to production, never opens the execution gate, and never becomes Champion performance.

Legacy `portfolioReturnGrossPct` / `portfolioReturnNetPct` fields are reserved for **Applied Portfolio only**. Research returns live under `researchEvaluation`.

## Trading-session calendar

No weekday/weekend assumption is allowed. Post-signal sessions are accepted only from actual trusted OHLC dates observed across multiple identity-verified symbol histories.

- Calendar method: multi-symbol trusted OHLC date consensus.
- Consensus floor: 50% of trusted refreshed histories.
- Minimum vote count: 5 symbols.
- No accepted calendar date may be after the current V20 completed session.
- If horizon N does not yet have N accepted post-signal sessions, the evaluation stays `PENDING` and all return fields remain `null`.

The consensus rule is a data-quality guard, not an alpha parameter.

## Research entry/exit policy

- Direction: long only for current V20 trade plans.
- Entry opportunity: **open of the first accepted market session after signal issuance only**.
- Entry occurs only when that open is inside the immutable issued entry range.
- If first-session open is outside the entry range, state is `NOT_ENTERED`; the resolver never waits for a later session to create a better fill.
- If target and stop are both touched in the same daily candle, the outcome is conservatively treated as stop.
- If a later session gaps below stop, exit is the actual lower open.
- If a later session gaps above target, credited exit is capped at Target 1.
- If no target/stop exit occurs before the requested horizon, exit at that horizon session close.
- Round-trip transaction cost: the V20 central 0.60% policy, charged only after a real entry.
- AVOID, invalid-relation, hard-review, or rebuild-required plans are excluded from research outcome scoring.

## Immutable evidence

The resolver verifies each archive by recomputing `sha256(JSON.stringify(immutableCore))` and matching it to `immutableSignalHash`. It never edits files under `data/v20/signal-archive/`.

## Permanent integration

Phase 9 is integrated into the existing V20 archive cycle rather than a separate long-lived workflow. `scripts/v20/archive-signal.cjs` performs the immutable archive step and then runs, in order:

1. `forward-evaluation-unit.cjs`
2. `resolve-forward-evaluation.cjs`
3. `forward-evaluation-regression.cjs`

The main V20 workflow then rebuilds the separated Performance Evidence Registry from that freshly resolved forward evidence. A temporary Phase 9 workflow was used during rollout and was removed after the archive-cycle integration passed the normal V20 main pipeline.

## Self-contained authoritative evidence

`data/v20/forward-evaluation.json` is the **single authoritative persisted forward-evidence file**. Schema v3 embeds:

- `resolutionStatus` — counts and accepted-session status produced by the resolver in the same cycle.
- `evaluationRegression` — the leakage/immutability/return-semantics regression produced immediately after resolution.
- `authoritativeEvidence` — explicitly declares the main file authoritative and marks sidecars non-authoritative.

`data/v20/forward-resolution-status.json` and `data/v20/forward-evaluation-regression.json` remain optional derived/debug sidecars. They may be regenerated in CI and are never used as the persisted source of truth. This prevents stale sidecars from disagreeing with the latest `forward-evaluation.json` saved by the main workflow.

`phase3-regression.cjs` independently requires the embedded status/regression, verifies their counts against the evaluation rows, confirms zero same-session fabrication, and rechecks immutable signal hashes. A main run therefore cannot pass merely because an old sidecar says the forward evidence was valid.

## Current 2026-08-13 signals

Both archived signal revisions have:

- `executionStatus = RESEARCH_ONLY`
- `recommendedExposurePct = 0`
- `cashPct = 100`
- all issued `positionWeightPct = 0`

Therefore the real applied production portfolio is cash, not a research basket. At the current V20 as-of session (`2026-08-13`) there is not yet a trusted post-signal market session, so all ten 1/3/5/10/20 horizon records must remain `PENDING` with null returns.

The last verified resolver cycle had 30 requested opportunity tickers, 28 trusted histories, 27 live Yahoo refreshes and one cached verified fallback. `KORA` and `BONY` had no acceptable Yahoo history. The consensus calendar correctly accepted **zero** sessions after `2026-08-13`, so no forward return was manufactured.

## Outputs

- `scripts/v20/forward-evaluation-core.cjs`
- `scripts/v20/resolve-forward-evaluation.cjs`
- `scripts/v20/forward-evaluation-unit.cjs`
- `scripts/v20/forward-evaluation-regression.cjs`
- permanent integration in `scripts/v20/archive-signal.cjs`
- `data/v20/forward-evaluation.json` schema v3 — authoritative/self-contained
- `data/v20/forward-resolution-status.json` — derived sidecar only
- `data/v20/forward-evaluation-regression.json` — derived sidecar only
- `scripts/v20/phase3-regression.cjs` — independent embedded-evidence acceptance

## Governance invariants

- V16 remains `V16_9_EQUAL_WEIGHT_BASKET`.
- V19 remains shadow research with no automatic promotion.
- V17 remains the execution authority.
- Research forward returns never become production performance.
- Pending horizons never receive zero or fabricated returns merely because the calendar date has passed.
- No automatic order is created by forward resolution.
