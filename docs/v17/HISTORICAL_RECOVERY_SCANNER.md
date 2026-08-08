# V17 Short-Window Recovery Research Prototype

## Contract

The scanner is an independent research module. It does not read or write the daily basket, canonical V17 decision snapshot, recommendation ledger, stable production data, or execution state.

Operating mode: `SHORT_WINDOW_RESEARCH`.

Approved terminology:

- available-window adjusted high
- available-window adjusted low
- recovery research rank

The local store is approximately a 69–115-session prototype window. It is not the full-history scanner and its results must not imply verified multi-year coverage.

## Inputs and safety

The scanner reads `data/history/*.json` and the corporate-action review registry. Shared history is never rewritten. Comparable levels use `adjustedClose`. Raw OHLC is not comparable across adjustment events; reconstructed adjusted OHLC, if needed, is explicitly marked `DERIVED`.

Symbols fail closed when history is insufficient, stale, missing adjusted close, unverified, affected by a split-like discontinuity, or present in corporate-action review. Yahoo adjustment data is treated as non-authoritative and cannot resolve a review by itself.

## Output

`data/v17/historical-recovery/current.json` separates two independent axes. Every data-valid stock appears in `bottomUniverse`, sorted primarily by distance from the short-window adjusted low, with one location class:

- `EXTREME_BOTTOM`
- `NEAR_BOTTOM`
- `BOTTOM_ZONE`
- `ABOVE_BOTTOM_ZONE`

Recovery evidence is classified separately:

- `NO_RECOVERY`
- `BOTTOMING`
- `EARLY_RECOVERY`
- `RECOVERY_CONFIRMED`
- `RECOVERY_EXTENDED`
- `DATA_REVIEW_REQUIRED`

Weak stocks are never hidden from `bottomUniverse`. `topRecoveryOpportunities` is a separate ranked subset limited to the first three bottom-location classes and requiring `BOTTOMING`, `EARLY_RECOVERY`, or `RECOVERY_CONFIRMED` evidence.

The output includes short-window horizon metrics and explicit 52-week availability. If 52-week coverage is incomplete, its values remain null with `INSUFFICIENT_52_WEEK_COVERAGE`. Reserved 3-year, 5-year, and full-history horizon objects remain unavailable until the V17-only long-horizon store exists. Staleness is measured using market sessions actually observed across the local EGX history store, so ordinary weekends and dates without an observed exchange session do not create false stale flags.

The standalone interface is Arabic-first and RTL. Technical JSON keys, ticker symbols, and stage codes remain stable in English; separate Arabic display names, stages, and explanations are supplied for human-readable output.

The contract excludes trading directives, allocation fields, order fields, execution instructions, and ledger fields.

## Local commands

```text
node --test tests/v17/historical-recovery-*.test.cjs
node scripts/v17/historical-recovery/scanner.cjs
node scripts/v17/historical-recovery/validate-output.cjs
```

Before and after scanner work, collect changed and untracked paths from Git and pass them to `scripts/v17/frozen-path-check.cjs`. The check rejects the frozen V16.9 directories, artifacts, and workflows.
