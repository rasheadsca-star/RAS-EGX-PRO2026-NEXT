# TFE V20 Fusion RC1 — Developer Handoff

Standalone research engine embedded **inside** `develop/v20-integrated-decision-platform` without changing MAIN APP, V17, or the existing V20 Native engine.

## Contract

- V17 remains the authoritative production/safety backbone.
- V20 Native remains the full-market discovery/research source.
- TFE re-scores OHLC/volume history independently; `nativeResearchScore` is provenance only and never a scoring input.
- `RESEARCH_ONLY` is immutable in this RC: no broker execution, no production allocation, no automatic orders, and no automatic Champion promotion.
- Fail closed on broken OHLC, insufficient history, stale/update-failed history, corporate-action review flags, unofficial historical seeds, and severe latest-close source conflicts.

## Final fixed policy

- Minimum history: 60 sessions
- Core score: >= 70
- Fusion research score: >= 72
- Liquidity score: >= 55 + eligibility gate
- S/R confluence: >= 55 with >= 2 strong methods
- Structural net R/R: >= 0.70 after 0.60% round-trip cost
- Pullback distance: <= 0.70 ATR; otherwise DO NOT CHASE
- Entry expiry: 3 sessions
- Maximum holding window: 10 sessions
- T1: precision target at 0.8 effective-risk units, capped by structural resistance
- T2: structural resistance
- Same-bar ambiguity in simulator: STOP_FIRST

## Endpoints

- `/health` — immutable policy and permission contract
- `/scan?limit=30` — V20 discovery -> independent TFE analysis -> V17 safety overlay
- `/analyze?ticker=ETEL` — single ticker analysis
- `/simulate?ticker=ETEL` — recorded-session simulator with next-session-only entry

## Tests

Run from this folder:

```bash
npm test
```

Local release audit on 2026-08-19: **33/33 passed**, including **13/13 destructive/adversarial tests**.

## Reviewer notes

The engine intentionally does not claim a guaranteed hit-rate. During development, aggressive parameter searches produced attractive in-sample numbers that degraded on blind symbols; those profiles were rejected rather than promoted. The fixed RC policy therefore favors auditability and conservative gating over headline backtest accuracy.

See `docs/VALIDATION_REPORT.md` for the adversarial findings and rejected experiments.
