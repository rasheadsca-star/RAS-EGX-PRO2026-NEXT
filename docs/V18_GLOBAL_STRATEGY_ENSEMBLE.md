# EGX PRO V18 — Global Strategy Ensemble

## Objective

Build an EGX decision platform that competes with professional global screeners and strategy labs by combining independent strategy families, market-regime routing, canonical data truth, portfolio construction and strict evidence separation.

V18 does **not** copy proprietary source code or hidden algorithms from commercial products. It borrows public product design ideas and combines them with published quantitative research, then validates every idea independently on EGX data.

## Why V18 exists

The current EMA–MACD daily app can legitimately miss fresh crossovers, but a binary `0 recommendations` result is not a professional representation of a bullish market when other internal engines are already detecting valid trend, breakout and basket candidates.

The current repository already contains strong building blocks:

- V13.4: trend-follow, breakout and pullback with backtest / walk-forward separation.
- V13.5: adaptive recommendation and forward tracking.
- V15: BREAKOUT_CONTINUATION, MOMENTUM_ACCELERATION, TREND_RESUMPTION, LIQUID_LEADERS, HOT_MOMENTUM, PRE_BREAKOUT_ACCUMULATION and REVERSAL_CONFIRMATION.
- V16: breadth-based market regime and sector leadership.
- V16.9: equal-weight basket pilot with blocked walk-forward validation and next-open confirmation.
- EMA–MACD: useful as a continuation / timing family, but not as the only gate.

## Public ideas used as inspiration

### Trade Ideas

Useful concepts:

- multiple strategy competition rather than one permanent formula;
- backtesting as a filter before live use;
- simulated / paper validation before risking capital;
- strategy-specific risk parameters.

Reference: https://www.trade-ideas.com/ai-strategy-lab/
Reference: https://www.trade-ideas.com/2026/07/23/backtest-trading-strategy-before-risking-money/

### TrendSpider

Useful concepts:

- multi-factor scanners;
- reusable condition builder across scanner / alert / strategy testing;
- backtesting, forward testing and explicit analysis of test limitations;
- random-control comparison to avoid mistaking a rising market for strategy alpha.

Reference: https://help.trendspider.com/articles/what-is-the-strategy-tester
Reference: https://help.trendspider.com/kb/scanner/market-scanner
Reference: https://help.trendspider.com/kb/strategy-tester/read-and-analyzing-test-results

### TradingView

Useful concepts:

- indicator confluence instead of single-indicator dependence;
- multiple moving averages and oscillators normalized to a common rating;
- explicit separation of technical ratings from analyst/fundamental views.

V18 improves on this by keeping correlated indicators from being counted as independent evidence.

Reference: https://www.tradingview.com/support/solutions/43000614331-technical-ratings/

### MarketSmith / CAN SLIM style tooling

Useful concepts:

- relative-strength leadership versus the broad market;
- daily + weekly context;
- price/volume confirmation around pivots and breakouts;
- avoid buying a strong stock without market context.

Reference: https://get.investors.com/wp-content/uploads/2023/05/MS-How-to-Read-Stock-Charts.pdf

## Research ideas to validate on EGX

1. **Time-series momentum / moving-average trend**
   - Trend persistence exists across many markets, but moving averages are reactive and should be combined with risk control.
   - Moskowitz, Ooi & Pedersen (2012), Time Series Momentum.
   - Marshall, Nguyen & Visaltanachoti (2017), Time series momentum and moving average trading rules.

2. **52-week-high / price leadership**
   - Nearness to the 52-week high can add information beyond simple past return momentum.
   - George & Hwang (2004), The 52-Week High and Momentum Investing.

3. **Volatility-managed momentum**
   - Momentum risk varies materially over time; exposure should scale down in high-risk regimes.
   - Barroso & Santa-Clara (2015), Momentum Has Its Moments.
   - Daniel & Moskowitz (2016), Momentum Crashes.

## V18 architecture

### 1. Canonical Data Truth Layer

One calculation of price, volume, turnover, ATR, RSI, MACD and moving averages is authoritative.

Rules:

- no UI-specific duplicate liquidity formulas;
- no unit conversion inside individual strategy widgets;
- source conflicts block production-grade signals;
- every recommendation stores session date and data hash / provenance where available.

### 2. Market Regime Router

Regimes evolve from simple BULLISH/BEARISH into:

- TREND_EXPANSION
- SELECTIVE_BULL
- SECTOR_ROTATION
- CHOP
- HIGH_VOLATILITY
- RISK_OFF
- CAPITULATION
- RECOVERY

Inputs:

- advance / decline breadth;
- percentage above MA20 / MA50 / MA100;
- new highs / lows;
- market turnover and volume breadth;
- median ATR / realized volatility;
- sector participation and relative strength.

Every strategy family has a regime compatibility matrix.

### 3. Strategy Farm

Independent families compete. Initial production/research roster:

- EMA_MACD_CONTINUATION
- BREAKOUT_CONTINUATION
- PRE_BREAKOUT_ACCUMULATION
- TREND_RESUMPTION
- PULLBACK_TO_20MA
- RELATIVE_STRENGTH_LEADERS
- 52_WEEK_HIGH_LEADERSHIP
- MOMENTUM_ACCELERATION
- VOLATILITY_CONTRACTION_BREAKOUT
- REVERSAL_CONFIRMATION
- SECTOR_LEADERSHIP
- BASKET_PROBABILITY

Each family must have:

- eligibility conditions;
- ranking score;
- entry trigger;
- invalidation / cancellation trigger;
- stop method;
- target / exit method;
- compatible regimes;
- transaction-cost assumptions;
- historical metrics;
- validation metrics;
- test metrics;
- forward metrics.

### 4. Ensemble / Confluence Layer

Do **not** average every indicator.

Confluence is based on independent evidence classes:

- Trend
- Momentum
- Relative Strength
- Price Structure
- Volume / Liquidity
- Market Regime
- Sector Regime
- Fundamental / disclosure evidence when reliable
- Strategy forward evidence

Correlated signals such as EMA20/EMA50 and SMA20/SMA50 cannot each count as full independent votes.

### 5. Evidence Gate

Signal states:

- `RESEARCH_ONLY`
- `BACKTEST_SUPPORTED`
- `VALIDATION_SUPPORTED`
- `TEST_SUPPORTED`
- `FORWARD_PILOT`
- `PRODUCTION_ELIGIBLE`

A beautiful backtest is not production evidence.

Minimum professional validation must include:

- development / validation / untouched test split;
- rolling or blocked walk-forward;
- realistic EGX transaction cost and slippage assumptions;
- same-bar stop/target conflict handled conservatively;
- no future leakage;
- random-control or benchmark comparison;
- minimum resolved forward sample before claims about forward reliability.

### 6. Risk and Portfolio Engine

Risk is applied after candidate quality, not used to hide all candidates.

Controls:

- ATR-normalized stop;
- volatility-scaled position sizing;
- maximum single-position exposure;
- maximum portfolio open risk;
- sector concentration cap;
- correlation / duplicate-theme cap;
- cash remains cash when a candidate fails morning confirmation.

### 7. Morning Confirmation

After-close candidates are not blindly executed next session.

Checks:

- opening gap inside allowed range;
- no immediate stop violation;
- first 10–15 minute liquidity confirmation when real intraday data is available;
- no material adverse disclosure between close and open;
- failed member weight is not automatically redistributed inside a basket.

### 8. Professional Output — no more misleading binary zero

The UI must show separate layers:

- **A — Pilot / Production Candidate**: passed the strongest currently available evidence gate and still requires execution confirmation.
- **B — Conditional Opportunity**: strong setup or multi-engine confluence, but one execution/evidence condition remains.
- **C — Watch**: interesting but incomplete.
- **D — Rejected**: explicitly explain why.

If the market is Risk-On and multiple canonical stocks pass continuation criteria, a screen that shows zero candidates must raise a diagnostic warning instead of silently claiming there are no opportunities.

## First implementation in this branch

Files:

- `data/v18-global-strategy-policy.json`
- `scripts/stable/v18-global-strategy-ensemble.cjs`
- `.github/workflows/v18-global-strategy-ensemble.yml`

The first engine:

- merges V16.9 basket, V15 extended opportunities, V13.4 / V13.5 recommendations and an EMA–MACD continuation shadow family;
- reads liquidity from canonical `data/quant/stocks` values;
- scores independent source / strategy confluence;
- keeps Pilot, Conditional and Watch states separate;
- raises a Risk-On zero-signal regression warning;
- never enables automatic orders.

## Acceptance criteria before merging to production

1. GitHub workflow passes syntax and regression checks.
2. Current-session canonical data coverage is at least 80% of the tracked universe.
3. TMGH / COMI type high-turnover stocks cannot be rejected by a false `<20m turnover` unit bug.
4. A Risk-On session cannot display `0 opportunities` if at least two canonical continuation candidates pass policy.
5. Historical / validation / test / forward metrics are labeled separately in the UI.
6. Every candidate shows the strategies that voted for it and the conditions that did not pass.
7. No automatic broker execution in V18 Shadow.

## Next engineering milestones

- add 52-week-high and cross-sectional RS features to the canonical feature store;
- add volatility-contraction / VCP research family;
- create strategy-regime compatibility matrix trained only on prior data;
- add random-control benchmark to strategy reports;
- build unified V18 Decision Board UI;
- start a clean forward ledger from the first V18 shadow session;
- promote only strategies that pass the predefined forward-evidence thresholds.
