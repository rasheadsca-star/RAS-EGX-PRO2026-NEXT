# EGX PRO V18.2 — Unified Decision Center

## Scope
V18.2 consolidates the useful decision, screening, visualization, risk, evidence and forward-verification capabilities that were previously distributed across the EGX engines into one Shadow/Pilot decision center.

The integration rule is **one canonical truth**: price, RSI, MACD, RVOL, turnover, ATR, support/resistance and chart history are read from `data/quant/stocks`. Other engines contribute strategy/evidence states, not alternative copies of the same market facts.

## 12 unified centers
1. Executive Dashboard
2. Ranked Opportunities
3. Full Market Screener
4. Stock Detail Center
5. Technical Visualization
6. Relative Strength / VCP Leadership
7. Engine Agreement
8. Basket & Risk Center
9. Strategy × Regime Matrix
10. Evidence / Walk-Forward Center
11. Forward Ledger
12. Data Health & Integrity

## Unified feature set
The current feature manifest contains 24 enabled capabilities including Top 5 Now, full-market search/screener, stock detail, technical chart, EMA–MACD continuation, strategy families, RS leadership, high-proximity proxy, VCP, engine agreement, Watch/Near/Blocked diagnostics, V16.9 basket, local portfolio tracker, position sizing, morning confirmation/no-chase, strategy-regime routing, backtest evidence, immutable forward ledger, data health, zero-signal guard, JSON/CSV export and print.

## Evidence boundaries
- `TIER_A_PILOT_NEXT_SESSION` requires a non-research base source.
- V18 RS/VCP research layers cannot create Tier A by themselves.
- Evidence-first ranking is applied before raw score.
- A high decision score is not a success probability.
- Automatic orders remain disabled.
- Morning confirmation remains mandatory for the current Pilot execution path.
- V16.9 basket exposure remains capped at 50%; each current member is 12.5%, and failed/untriggered weight remains cash.

## 52-week integrity
The canonical history currently does not provide the minimum history required for a true 52-week label across the universe. Therefore V18.2 keeps `AVAILABLE_HISTORY_HIGH_PROXY` distinct and forbids false `52_WEEK_HIGH` labels until the history requirement is met.

## Data coherence gate
Candidate technical fields are checked against Canonical Truth using precision-aware tolerances that account for display/storage rounding while remaining tight enough to catch material unit/data-path errors. In particular the historical TMGH/COMI liquidity regression remains protected by direct canonical turnover checks.

## Final automated review — session 2026-09-06
- Schema: `18.2.0-shadow`
- Canonical universe: 199
- Unified candidates: 51
- Pilot: 4
- Conditional: 14
- Research: 14
- Watch: 19
- Near Trigger: 20
- Blocked/diagnostic rows: 20
- Actionable/Conditional total: 32
- EMA–MACD continuation eligible: 12
- Leadership research eligible: 22
- VCP eligible: 24
- Forward issued: 32
- Basket exposure: 50%
- Data Health: PASS
- Canonical consistency mismatches: 0
- Critical integrity failures: 0
- Feature manifest: 24
- UI centers/tabs: 12
- TMGH canonical average turnover 20d: 272,445,676.999 EGP
- COMI canonical average turnover 20d: 511,704,893.444 EGP

## Integrity gates passed
- Unique candidates
- Canonical membership
- Current-session coverage
- Canonical numeric consistency
- Score range 0–100
- No false 52-week labels
- Research cannot independently create Tier A
- Long execution plan sanity
- Basket position cap
- Failed basket weight stays cash
- Forward issue snapshot immutability

## CI
Workflow: `V18.2 Unified Decision Center Validation`

Successful run: `34056122157`

Head commit validated: `531caeba086f1a3e597f8673a5cf704a717a9b0f`

Artifact: `v18-2-unified-decision-center` / ID `9996002615`

Artifact digest: `sha256:d4cf3883b1044a50afd2ac13b04d79e19d13a913ab2e617cc7f300a7fadbc09e`

## Status
The engine is **structurally and data-coherence validated for the current build**. This is not equivalent to a claim that future trading profitability is proven. Professional evidence remains gated until the required test/forward samples are accumulated. The PR stays Draft and the Production branch remains unchanged.
