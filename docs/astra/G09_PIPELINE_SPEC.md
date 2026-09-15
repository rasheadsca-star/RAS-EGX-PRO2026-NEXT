# G09 Unified Internal Decision Pipeline

Status: **GREEN (shadow/internal only)**

## Pipeline

Canonical Data → Market Regime → Production-Eligible Strategy Farm → Signal Normalization → Evidence Engine → Strategy Agreement → Decision Ranking → Risk → Basket / Position Sizing → Execution Plan → DecisionSnapshot.

## Production eligibility

Only `PORTFOLIO_BASKET_EQUAL_WEIGHT` is a direct production-eligible strategy in G09. The source-pinned V16 two-stage selection model is an embedded component of the approved V16.9 basket methodology, not an independent production voter. Retired/experimental strategies remain research-only. QUANT_EDGE remains HISTORICAL_OUTPUT_ONLY.

## Regime

Version `EGX_PRO_MARKET_REGIME_BREADTH_1.0` ports the recovered V16 breadth/trend/volatility classification thresholds into a pure internal function tied to the same session. No confidence probability is invented.

## Ranking

Version `ASTRA_G09_V16_9_SOURCE_ORDER_1` preserves the V16.9 source selection score/order. No unexplained weighted score was added. Ties: source selection score descending, ticker ascending. The score is **not** described as probability of success.

## Risk and basket

Recovered V16.9 rules are used: entry ±0.08 ATR around close, stop -0.90 ATR, first target +1.20 ATR, maximum pilot portfolio allocation 50%, equal member exposure cap, failed/unfilled weight remains cash. Regime max-trade-risk limits position sizing downstream of signal validity.

## Evidence independence

Evidence is family-deduplicated. Selection-model evidence and basket-membership evidence share MODEL_SELECTION and count once independently while both raw records remain traceable.

## Snapshot semantics

DecisionSnapshot semantic hashing excludes generatedAt but binds canonical snapshot identity, session, regime/config versions, strategy execution hashes, evidence/agreement/ranking/risk/basket versions, market states, opportunities and diagnostics. Issued snapshots are deep-frozen by the internal pipeline.

## Boundaries

G09 makes zero legacy-network calls and has no legacy fallback. The existing application runtime is not cut over; all 8 known legacy runtime dependencies remain for G12. G10-G19 remain pending.
