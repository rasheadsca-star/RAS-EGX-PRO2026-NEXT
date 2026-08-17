# QUANT EDGE V1 — Independent Probabilistic Market Engine

QUANT EDGE is a fully isolated, SHADOW-only EGX analysis engine created for clean comparison against MAIN APP.

## Non-negotiable invariants

- No import or reuse of MAIN APP recommendation, score, or ranking logic.
- No order execution path. `allowExecution=false` and all outputs declare `executionAllowed=false`.
- Broker/Research Consensus is confirmation evidence only; it cannot turn a core `REJECT` into `BUY`.
- External broker influence is capped at 15 confidence points.
- No forced Top-5. The engine may publish zero recommendations.
- TP-before-SL probability is not shown as an empirical probability until a walk-forward/out-of-sample calibrator has enough observations.

## Pipeline

`Independent bars -> Market Regime -> Quant Features -> Setup Scores -> Core Confidence -> Broker Intelligence -> Clean Gate -> Dynamic Trade -> Shadow Tracking`

Initial setups:
1. Relative Strength Momentum
2. Volatility Expansion
3. Smart Pullback

Market regimes: `BULL_TREND`, `BEAR_TREND`, `SIDEWAYS`, `HIGH_VOLATILITY`, `RISK_OFF`, `RECOVERY`.

## Broker Intelligence input

```js
{
  ticker: 'SWDY',
  source: 'Broker/Research House',
  sourceType: 'OFFICIAL_RESEARCH_REPORT',
  publishedAt: '2026-08-17T08:30:00+03:00',
  ageSessions: 0,
  rating: 'BUY',
  target: 74.5,
  stop: 65.5,
  horizon: 'SHORT_TERM',
  originReportId: 'unique-original-report-id',
  verified: true
}
```

Re-publications of the same research share `originReportId` and count once. Long-term valuation reports use `horizon: 'LONG_TERM_FUNDAMENTAL'`; they are retained as context but do not trigger a swing entry.

## Source weights

- Official research report: 1.00
- Official broker app/site: 0.95
- Official broker social channel: 0.80
- Trusted media quote: 0.60
- Aggregator with named analyst/source: 0.50
- Unknown source: 0.00

Short-term freshness: 0–2 sessions 100%, 3–5 75%, 6–10 40%, then stale.

## Probability calibration

`confidenceProxy` is a model score, not a claimed probability. `tp1BeforeSl` and `tp2BeforeSl` stay `null` until `EmpiricalProbabilityCalibrator` receives walk-forward buckets with at least 30 observations per bucket.

## Tracking

`tracking.tripleBarrierOutcome()` records TP1/TP2/SL/time outcomes, MFE, MAE and sessions observed. If stop and target are touched in the same daily bar and intraday ordering is unknown, tracking uses the conservative rule: SL first.

## Tests

```bash
npm run quant-edge:test
```

## Live research adapters

Live collectors for Rumble/Thndr, Ostoul, Mirage and other research houses belong in separate source adapters. They must emit this engine's normalized contract and preserve original source/report ID/timestamp for auditability. The quantitative core must never scrape or depend directly on a broker site.
