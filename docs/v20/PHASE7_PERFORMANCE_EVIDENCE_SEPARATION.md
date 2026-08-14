# V20 Phase 7 — Performance Evidence Separation

## Objective

Prevent historical backtests, internal walk-forward tests, development OOS results, reused benchmark windows, and live-forward tracking from being blended into one performance claim.

## Evidence classes

V20 now registers performance evidence as separate cards:

- **V16 Historical Backtest** — fixed basket-size historical metrics.
- **V16 Internal Walk-Forward** — the published blocked walk-forward metrics used as Champion reference evidence.
- **V19 Development OOS** — 58 development sessions from the frozen V19 v6 artifact. This evidence is retained even though its average net return is negative.
- **V19 Reused Benchmark** — the 20-session benchmark on which V19 v6 is numerically strong, explicitly labelled non-independent because the architecture was informed by diagnostics on the same benchmark.
- **V20 Live Forward** — immutable forward evaluations at 1/3/5/10/20-session horizons. Pending outcomes remain null.

## Governance

- No single headline performance metric is allowed across evidence classes.
- No cross-evidence aggregation is allowed.
- Development and reused benchmark evidence remain separate.
- Reused benchmark evidence cannot promote V19.
- V19 automatic promotion remains forbidden.
- V18 external performance claims remain unaccepted until an auditable, reconciled evidence artifact is ingested.
- Pending forward results are never converted to zero or included in return averages.

## Outputs

- `data/v20/performance-evidence-registry.json`
- `data/v20/performance-evidence-regression.json`

This phase does not change V16 Champion selection, V17 execution governance, V19 shadow status, V20 portfolio exposure, or immutable signal hashes.
