# Decision Methodology

The technical model is intentionally small and fixed. There is no hidden model-selection score.

## 1. Trend — 30%

`trendRaw = (SMA20 / SMA50 - 1)`

`trendScore = clamp(trendRaw / 0.05, -1, 1) * 100`

A 5% or larger positive SMA20/SMA50 spread saturates at +100; a 5% or larger negative spread saturates at -100.

## 2. RSI(14) — 25%

The RSI component rewards constructive momentum but penalizes overheated conditions.

- RSI < 30: -60
- 30–50: linear from -60 to 0
- 50–65: linear from 0 to +100
- 65–75: linear from +100 back to 0
- >75: increasingly negative, capped at -100

## 3. ATR(14) risk — 20%

`atrPct = ATR14 / close`

`atrScore = clamp((0.08 - atrPct) / 0.06, -1, 1) * 100`

Lower volatility is rewarded; very high daily range is penalized.

## 4. 20-session momentum — 25%

`momentum20 = close_t / close_t-20 - 1`

`momentumScore = clamp(momentum20 / 0.15, -1, 1) * 100`

A +15% 20-session move saturates at +100; -15% saturates at -100.

## Final score

`score = 0.30*trend + 0.25*rsi + 0.20*atr + 0.25*momentum`

Directional thresholds are fixed at +35 and -35.

## Backtest

The walk-forward evaluator computes a signal using only data available through each historical date and evaluates the next-session return after transaction cost. Model weights and thresholds are fixed; they are not re-fit on the test window.

A directional recommendation is permitted only if:
- calendar span >= configured minimum (default 3 years),
- directional trades >= configured minimum (default 100),
- a 95% Wilson interval is available.

Reported fields include sessions, directional trades, wins, losses, win rate, average signed net return, cumulative signed return, maximum drawdown, period, and confidence interval.

## Fundamentals gate

`medium` and `long` horizons return `NO_RECOMMENDATION` until verified fundamentals from the same licensed source are wired and timestamped. Technical price data alone cannot produce an investment-grade medium/long classification.
