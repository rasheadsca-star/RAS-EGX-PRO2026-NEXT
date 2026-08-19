# TFE V20 Fusion RC1 — Developer Handoff

Standalone research engine embedded **inside** `develop/v20-integrated-decision-platform` without changing MAIN APP, V17, or the existing V20 Native engine.

## Contract

- V17 remains the authoritative production/safety backbone.
- V20 Native remains discovery/provenance intelligence; its `nativeResearchScore` is never a TFE scoring input.
- A freshness bridge uses the current recorded full-market history universe, then TFE re-scores OHLC/volume independently.
- `RESEARCH_ONLY` is immutable in this RC: no broker execution, no production allocation, no automatic orders, and no automatic Champion promotion.
- Fail closed on broken OHLC, insufficient history, stale/update-failed history, explicit symbol-identity failure, corporate-action review flags, and unofficial historical seed warnings.
- Local-reference price divergence is treated as review evidence because the upstream local-reference adapter does not guarantee session-date alignment. A very high `latest_close_conflict` (>=20%) creates a **publication hold** until price reconciliation; it does not silently become a recommendation.

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

## Current runtime

Production review URL:

`https://egx-tfe-v20-fusion-rc1.vercel.app`

The deployed runtime is pinned to an immutable Git commit and emits `x-tfe-source-commit` so reviewers can match the running code to the repository revision.

## Endpoints

- `/health` — immutable policy and permission contract
- `/scan?limit=20` — scans the fresh current full-market history universe, applies independent TFE analysis, publication quality gate, V20 provenance overlay and V17 safety overlay
- `/analyze?ticker=ETEL` — single ticker analysis + publication state
- `/simulate?ticker=ETEL` — recorded-session single-symbol simulator
- `/simulate?scope=market&symbols=220` — aggregate recorded full-market simulator

## Final acceptance snapshot — 2026-08-19

### Runtime tests

The exact published commit was fetched into an independent Vercel test runner and executed with Node's test runner:

- **38/38 tests passed**
- **0 failed**
- **15/15 destructive/adversarial tests passed**

Covered invariants include immutable RESEARCH_ONLY permissions, no caller-input mutation, invalid-OHLC rejection, date de-duplication, stale/update-failed fail-closed behavior, explicit symbol identity failure, stale local-reference review semantics, high-conflict publication hold, corporate-action blocking, deterministic ranking, V17 inability to override execution lock, next-session-only simulator entry, transaction-cost inclusion, conservative STOP_FIRST same-bar policy, structural RR floor, pullback cap, and T1 <= T2.

### Full-market live scan

- Current recorded market session: **2026-08-19**
- Current verified history candidates scanned: **188**
- Technically eligible: **11**
- Publishable research candidates: **10**
- Withheld for price reconciliation: **1**
- V20 Native overlay session: 2026-08-16
- V17 overlay session: 2026-08-13
- Execution remains blocked.

### Recorded full-market simulator

The fixed RC policy was simulated across all 188 current-history candidates, using only bars available at each signal date:

- Symbols completed: **188/188**
- Simulator errors: **0**
- Entered trades: **120**
- T1 hit rate: **65.8%**
- Stop rate: **27.5%**
- Positive trade rate: **65.8%**
- Average net result after 0.60% round-trip cost: **+0.66% per entered trade**
- Profit factor: **1.49**
- Wilson 95% lower bound for T1 hit rate: **57.0%**

These figures are historical research evidence, not a guarantee of future performance.

## Reviewer notes

The engine intentionally does not claim a guaranteed hit-rate. During development, aggressive parameter searches produced attractive in-sample numbers that degraded on blind symbols; those profiles were rejected rather than promoted. The fixed RC policy favors auditability, conservative publication rules, and repeatable behavior over headline backtest accuracy.

See `docs/VALIDATION_REPORT.md` for the destructive-critic findings, rejected experiments, and the final acceptance evidence.
