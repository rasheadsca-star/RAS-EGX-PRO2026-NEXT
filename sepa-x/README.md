# SEPA-X — Isolated Superperformance Opportunity Engine

SEPA-X is a **new, independent engine** built beside the frozen RC2 baseline. It does not import RC2 runtime modules and does not mutate RC2 files, scores, recommendations, monitoring, portfolio state, or deployment.

## Isolation contract
- Namespace: `sepa-x/`
- Runtime imports from `tfe-v20/`: **0**
- RC2 mutations: **0**
- Shared market inputs are consumed read-only from repository data sources.
- Execution/order permissions are permanently false in v1.

## Pipeline
Universe → Data Integrity → Liquidity → Market Regime → Sector RS → Trend Template → Market-wide RS → Fundamentals → VCP/Base → Volume → Pivot → Entry Readiness → Risk → Score/Rank → Top 5 Now.

Every major stage returns `pass`, `score`, `reasonCodes`, `raw`, and `timestamp`.

## No fabrication
Missing fundamentals/catalysts stay `null`/`UNKNOWN`, never zero-filled. If 252 sessions are unavailable, the Trend/RS hard gate fails. Extended stocks return `WAIT FOR NEW SETUP`, not BUY.

## Run
```bash
npm test
npm run scan
npm run acceptance
```

The production UI/API serves only a generated real scan in `data/current-scan.json`; if no real scan exists it returns `503 NO_SCAN_AVAILABLE`. No mock production data is allowed.
