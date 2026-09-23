# Astra PRO v3 vs EGX Pro Professional V16.9 UI CLAUDE

Generated: 2026-09-23T17:28:00.324Z

## Identity
- Current Astra: **EGX PRO — Astra PRO ANALYTICS v3**
- Comparator: **EGX Pro Professional V16.9 UI CLAUDE**
- Comparator engine: **TFE V20 Fusion RC2**
- Frozen RC2 source: **cf5f9e2f4db9e81dc8245becf45f280aa42dc010**

## Current-session recommendations
- Session: **2026-09-23**
- Astra: **MAAL, QNBE, ACTF**
- UI CLAUDE / RC2: **SAUD**
- Overlap: **none**

## Same-window neutral execution comparison
Window: **2026-08-04 → 2026-09-13**. Both sides are evaluated with next-session entry, 3-session entry expiry, 10-session max hold, STOP_FIRST same-bar rule, and 0.60% round-trip cost.

| Metric | Astra current signal lineage | UI CLAUDE / RC2 frozen |
|---|---:|---:|
| Issued signals | 102 | 50 |
| Eligible episodes after overlap suppression | 78 | 50 |
| Entered | 69 | 34 |
| Target 1 % | 43.48% | 73.5% |
| Stop % | 52.17% | 23.5% |
| Positive trades % | 46.38% | 73.5% |
| Avg net / entered trade | -0.29% | 1.2% |
| Profit factor | 0.89 | 2.07 |
| Expired entries | 9 | 16 |
| Signal dates | 27 | 25 |
| Unique tickers | 54 | 46 |

## UI CLAUDE built-in full-history simulator
- Entered: **83**
- T1: **74.7%**
- Stop: **22.9%**
- Positive: **74.7%**
- Avg net: **1.15%**
- Profit factor: **2.08**
- Wilson 95% lower T1: **64.4%**

## Interpretation constraints
- The same-window table is the primary apples-to-apples comparison.
- Astra historical signals come from its preserved V16.9-source decision history; RC2 signals are regenerated with the frozen RC2 algorithm using only data available through each signal date.
- No future bar is used to create a signal. Future bars are used only to resolve entry/exit outcomes.
- This is research/backtest evidence, not a guarantee of future returns.

