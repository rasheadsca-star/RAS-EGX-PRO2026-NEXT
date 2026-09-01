# EGX ONE — Legacy Feature Migration Matrix

Status scope: Research UI migration only. Legacy code/data are forensic inputs and never Production dependencies.

| Legacy capability | EGX ONE status | New location / behavior | Authority note |
|---|---|---|---|
| Top opportunities / Top 5 | MIGRATED + IMPROVED | `Today` → strategy-ranked BUY_CANDIDATE / WAIT_FOR_ENTRY cards | RESEARCH only; each plan has Entry/Stop/T1/T2/plan hash |
| Full-market search | MIGRATED | `All Market` → symbol/name search across Research Universe with readiness filters | Reads current Research UI snapshot |
| Per-symbol analysis | MIGRATED + IMPROVED | `Symbol Analysis` | One screen for price, momentum, RSI, ATR, relative volume, liquidity and current plan |
| Historical price view / history-50 | MIGRATED | `Symbol Analysis` → last 50 clean Research sessions chart | Quarantined history is excluded |
| Support / resistance | MIGRATED + CLEANED | `Symbol Analysis` → 5/10-session support and 20/50-session resistance | Descriptive levels from clean Research history; not Production authority |
| Technical ranking | MIGRATED | `Today` + `All Market` | Descriptive leaderboard is kept separate from strategy decisions |
| Money flow / volume activity | MIGRATED | Relative Volume 20 + current traded value + liquidity | No fabricated proprietary flow score |
| Liquidity ranking | MIGRATED | Median traded value 20 sessions | Research feature |
| Recommendation entry / stop / targets | MIGRATED + IMPROVED | `Today` recommendation cards and per-symbol current plan | Strategy validation required before publication |
| Recommendation outcome history | REPLACED + IMPROVED | `Historical Simulator` | True point-in-time replay; future bars are inaccessible at signal construction |
| Backtest / walk-forward comparison | REPLACED + IMPROVED | `Historical Simulator` + `Engine Comparison` | STOP_FIRST same-bar policy; costs explicit |
| Legacy engine comparison | MIGRATED + HARDENED | `Engine Comparison` | EXACT ledger, reconstructed engine and proxy are labeled separately |
| Portfolio tracking | MIGRATED | `Portfolio` | Local browser portfolio with quantity, buy price, current Research close and current plan link; no broker orders |
| Recommendation / decision journal | MIGRATED | `Decision Journal` | Local immutable-by-user history for decision notes/status reviews |
| Price alerts | MIGRATED | `Alerts` | Local ABOVE/BELOW triggers against Research close; no automatic trade execution |
| Data quality / readiness | MIGRATED + IMPROVED | `Quality & Audit` | Shows coverage, review states and fail-closed Production boundary |
| Lineage / hashes | MIGRATED + IMPROVED | `Quality & Audit` | Publication, strategy and simulator hashes exposed |
| Operational blockers / progress | MIGRATED | `Quality & Audit` | Phase 3 blockers and Phase 4 lock remain visible |
| PWA / mobile install | MIGRATED | manifest + service worker + install prompt | Same web app; no native broker permissions |
| Old UI patch stacks / duplicate screens | CONSOLIDATED | Single root `index.html` Unified Decision Center | No legacy UI runtime dependency |
| Legacy source claims as current Production truth | NOT MIGRATED AS AUTHORITY | Evidence can be shown only at its actual Research/forensic grade | Production certification gates remain mandatory |
| Auto-trading / automatic orders | INTENTIONALLY DISABLED | No order-placement control | Explicitly outside EGX ONE Research authority |

## Historical evidence grades

- `POINT_IN_TIME_HISTORICAL_REPLAY`: EGX ONE technique rebuilt for each historical signal date using information available by that date only.
- `EXACT_LOGGED_LEDGER`: historical recommendation/outcome record persisted by the old engine itself (currently V16.9 evidence).
- `RECONSTRUCTED_FROM_FROZEN_CODE`: old algorithm rerun from its frozen source/data (Gann Fusion X).
- `RECONSTRUCTED_PROXY_FROM_FROZEN_CODE`: proxy recreation rather than an immutable old live ledger (SEPA-X Proxy).
- `NOT_COMPARABLE_NO_IMMUTABLE_OUTCOME_LEDGER`: no auditable historical recommendation ledger/replay was found; no metric is fabricated (currently V17/V18/V20/TFE).

## Migration rule

Feature parity does not mean authority parity. A legacy visualization or workflow can be carried forward, but any claim that depends on unverified legacy market truth remains Research-only until the clean-room Production gates independently certify the data lineage.
