# QUANT EDGE V1.1 — Independent Probabilistic EGX Shadow Engine

QUANT EDGE is an isolated, SHADOW-only research engine for clean comparison with MAIN APP. It does not import or reuse MAIN recommendation, score, ranking, trade-plan, or historical-reconstruction logic for signal generation.

## Hard invariants

- `allowExecution=false`; every signal/output declares `executionAllowed=false`.
- Independent public data is required and attested by the snapshot provenance boundary.
- MAIN APP may be read only after QUANT output is complete, for downstream comparison; comparison is never fed back into QUANT.
- Broker/research evidence can confirm or reduce an already valid quant signal, but can never turn a core `REJECT` into `BUY`.
- Broker influence is capped at 15 confidence points.
- Unknown/unverified sources have zero influence.
- No forced Top-5: zero recommendations is valid.
- Empirical TP-before-SL probabilities remain `null` until a walk-forward bucket has at least 30 completed observations.

## Independent data pipeline

`Mirage public delayed EGX universe -> Yahoo daily OHLCV (.CA) -> ^CASE30 benchmark -> Independent Snapshot -> Regime/Features/Setups -> Walk-Forward Calibration -> Broker Confirmation -> Clean Gate -> Shadow Journal`

The live feed never reads `data/recommendations.json`, ranking files, MAIN scores, or MAIN history during signal generation. `engines/quant-edge/data/independent-snapshot.json` contains an explicit provenance attestation and SHA-256 is recorded in output manifests.

If Mirage public discovery is unavailable, a curated public Reuters ticker seed is used only for discovery; historical OHLCV still comes from the independent Yahoo chart source. The feed must meet minimum symbol coverage and history depth before it can be marked `ANALYSIS_GRADE`.

## Quant setups

1. `RELATIVE_STRENGTH_MOMENTUM`
2. `VOLATILITY_EXPANSION`
3. `SMART_PULLBACK`

Market regimes: `BULL_TREND`, `BEAR_TREND`, `SIDEWAYS`, `HIGH_VOLATILITY`, `RISK_OFF`, `RECOVERY`.

Every accepted signal receives a dynamic entry zone, ATR-aware stop, TP1, TP2 and time stop. `RISK_OFF`, weak liquidity and low core confidence are hard gates.

## Broker Intelligence

Public collectors are intentionally strict. A research item needs an explicit ticker, rating/call and original publication date to influence the engine. Re-publications share an origin ID and count once. Long-term fundamental reports are retained as context but do not create a swing entry.

Configured discovery targets include Rumble/Thndr research, Ostoul Capital and Mirage Brokerage. The collector never bypasses login, OTP, paywalls or subscription controls. An explicitly authorized JSON export may be supplied with `QE_BROKER_AUTHORIZED_JSON`; its root must declare `authorizedForQuantEdge: true` and each recommendation must be explicitly `verified: true`.

Source quality weights remain:
- Official research report: 1.00
- Official broker app/site: 0.95
- Official broker social: 0.80
- Trusted media quote: 0.60
- Named-source aggregator: 0.50
- Unknown: 0.00

Freshness: 0–2 sessions 100%, 3–5 75%, 6–10 40%, then stale.

## Walk-forward calibration

Calibration uses expanding past-only signal windows. For each historical signal date, only bars available at that date are used for the decision; later bars are used only to label the triple-barrier outcome. Broker research is excluded from probability calibration so the probability measures the quantitative core.

The report stores temporal 80/20 holdout validation, Brier scores, Wilson 95% intervals, and production confidence buckets. A bucket is not exposed as a probability until it has at least 30 completed signals.

## Triple-barrier tracking

Same-day target/stop ordering is unknowable from daily OHLC, so a same-bar conflict is conservatively counted as stop first. If TP1 occurred on an earlier session and stop is hit later, the tracker preserves TP1 as the first barrier and records `stoppedAfterTp1=true`.

## Outputs

Generated under `engines/quant-edge/data/`:

- `independent-snapshot.json` — independent OHLCV universe and provenance
- `broker-collection.json` — audited research collection diagnostics
- `calibration.json` — walk-forward observations/buckets/validation
- `shadow-latest.json` — current QUANT EDGE basket and rejected universe
- `shadow-journal.json` — persistent signal/outcome journal
- `vs-main-latest.json` — downstream-only comparison with MAIN
- `manifest.json` — hashes, independence statement and run summary
- `acceptance-report.json` — release/quality gate

## Commands

```bash
npm run quant-edge:test
npm run quant-edge:feed
npm run quant-edge:brokers
npm run quant-edge:calibrate
npm run quant-edge:pipeline
npm run quant-edge:acceptance
```

`quant-edge:pipeline` is the canonical end-to-end run. The GitHub Actions workflow `QUANT EDGE Shadow Lab` runs tests, the live independent pipeline and the acceptance guard, then persists shadow artifacts on `develop/v17-rebuild` only.
