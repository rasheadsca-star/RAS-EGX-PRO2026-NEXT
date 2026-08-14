# V20 Phase 19 — Research Evidence Experience

## Purpose

Expose the governance and evidence already built in V20 as research workflows that a user can inspect without converting research context into execution permission.

## New research pages

### Immutable Signal History — `v20/history.html`

Reads the immutable V20 signal archive and forward-evaluation evidence. It shows the issued session/revision/hash, execution status at issuance, applied exposure/cash, Champion, opportunity status counts, frozen trade-plan values, and 1/3/5/10/20-session forward states.

Pending horizons remain `Pending`/`null`. Applied Portfolio and Research Opportunity outcomes are shown separately.

### Backtest Readiness Center — `v20/backtest.html`

Explains why the V20 Research Decision Score cannot currently be presented as independently backtested/calibrated alpha. Existing V19 Development and reused benchmark evidence are not relabeled as V20 Score performance. V18 remains unaccepted without reproducible audit.

The required future methodology includes frozen score versions, point-in-time features, no look-ahead, conservative entry/exit semantics, costs, walk-forward and independent holdout separation, and immutable signal preservation.

### S/R Remediation Audit — `v20/remediation.html`

A read-only diagnostic of the current V17 Internal Support/Resistance execution blockers. It exposes current mathematical gaps, missing candidate symbols, source conflicts, available current market evidence, available cached history evidence, identity/session/provenance state, and S/R blockers when present.

It never edits V17 and explicitly states that closing a numeric gap does not guarantee Execution Grade until the authoritative V17 gate is rebuilt.

### Top 5 Research Watch — `v20/top5.html`

Ranks the five highest current V20 Research Decision Score profiles while preserving the actual status and execution gate. It shows score/tier, trade-plan alignment, conservative Net R/R, evidence coverage, independent confidence dimensions, technical readiness, entry/stop/targets, strengths, weaknesses and evidence gaps.

The page explicitly enforces:

`Score ≠ Confidence ≠ Execution Permission`

It has no order action and does not turn research rank into ACTIONABLE, allocation or production permission.

## Browser validation policy

The extended research pages are validated separately with real Chrome runtime smoke testing before being treated as accepted UI surfaces. Temporary validation workflows must be removed after their evidence is persisted so the permanent V20 main isolation guard remains narrow.

## Release semantics

These research pages do not change:

- V17 execution authority;
- V16 Champion status;
- V19 shadow/research governance;
- production allocation;
- immutable signal hashes;
- sector production provenance policy;
- performance evidence classification;
- deployment status.

They provide visibility and research workflow only.
