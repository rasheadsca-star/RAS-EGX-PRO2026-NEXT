# EGX ONE
Unified Production-Grade Egyptian Exchange Decision Engine — clean-room foundation.

Current milestone: Phase 0/1 foundation. This branch is intentionally isolated from all legacy runtime code. Legacy engines are forensic/research inputs only.

## Non-negotiable invariants
- One market data truth and one immutable session snapshot per scan.
- Data Readiness blocks all features/ranking/recommendations.
- Missing data is UNKNOWN, never fabricated zero.
- Deterministic output for identical data/config/code.
- No forced Top 5 and NO_TRADE is valid.
- No auto-trading.
- Forward evidence starts only after freeze and is append-only.
- Legacy/Yahoo/Mubasher migration is RESEARCH_ONLY and cannot grant Production Authority.

## Run
`npm test`

## Research warehouse migration
`LEGACY_HISTORY_COMMIT=<exact-sha> LEGACY_HISTORY_DIR=<dir> npm run research:migrate-history`
