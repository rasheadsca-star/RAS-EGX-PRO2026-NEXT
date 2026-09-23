# Astra vs EGX Pro Professional V16.9 — Retrospective Simulator

Generated: 2026-09-23T17:17:39.899Z

## Scope
- Historical window: **2026-08-04 → 2026-09-13**
- Resolved V16.9 sessions: **27**
- Recommendation members replayed: **102**
- Unique tickers: **54**

## Critical interpretation
Current Astra G09 is not an independent stock-selection model versus V16.9. It preserves V16.9 source selection order and the same V16.9 entry/stop/target geometry. Therefore this simulator separates **signal parity** from **execution/governance semantics**. A 100% plan-parity result is expected by design and must not be presented as independent alpha validation.

## V16.9 native historical result
- Winning sessions: **12/27 (44.444%)**
- Average net session return: **-0.1417%**
- Profit factor: **0.875**
- Compounded net return: **-4.642%**
- Maximum drawdown: **-18.318%**
- Member target-hit rate: **36.27%**
- Member stop-hit rate: **36.27%**

## Astra current-policy replay on the same historical recommendations
- Issued: **102**
- Activated: **101**
- Final target hits: **39**
- Stop-loss hits: **32**
- Ambiguous daily-OHLC paths: **27**
- Expired entries: **0**
- Still open at end of available history: **3**
- Numeric closed-trade win rate: **63.64%**
- Average numeric gross return: **2.2991%**
- Profit factor on numeric closed trades: **2.4246**

## Signal comparison
- Ranking lineage: **ASTRA_G09_V16_9_SOURCE_ORDER_1**
- Basket lineage: **V16_9_EQUAL_WEIGHT_BASKET_PILOT**
- Historical ticker/plan parity in this replay: **100% by source contract**
- Independent-alpha comparison: **NOT APPLICABLE** until Astra uses a genuinely independent ranking/selection model.

## Methodology notes
- V16.9 native results use the preserved historical live-evaluation methodology, including its holding-period and 0.6% estimated round-trip cost assumptions.
- Astra replay uses the current native Astra outcome engine: next-session activation, 20-session entry expiry, conservative ambiguity handling when daily OHLC cannot establish intraday ordering, and gross return only when exact activation price is known.
- Because execution semantics differ, raw return numbers are not a clean apples-to-apples alpha comparison. The clean alpha comparison is the signal/plan parity result.

