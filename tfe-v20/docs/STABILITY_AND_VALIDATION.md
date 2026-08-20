# RC2 Stability & Validation Contract

## Objective
Protect the accepted TFE V20 Fusion RC2 runtime while extending evidence quality outside the production decision path.

## Frozen production runtime
The accepted runtime is pinned by `stability/frozen-runtime-contract.js` using Git blob hashes. The protected surface includes:

- `src/engine.js`
- `src/policy.js`
- `src/confidence.js`
- `src/backtest.js`
- `src/originalScore.js`
- `src/originalIndicators.js`
- `src/math.js`
- `src/quality.js`
- `src/repository.js`
- `api/index.js`
- `public/index.html`
- `public/ui-v169.js`
- `public/styles-v169.css`

Any byte-level drift fails `test/stability-contract.test.js` unless the frozen contract is deliberately and explicitly replaced after a separate acceptance cycle.

## Sidecar rule
All new validation capabilities are outside the production scan path. They may read frozen RC2 outputs/core utilities but the frozen runtime may not import them.

Every sidecar declares:

- `scoringImpact: NONE`
- no production runtime mutation
- no execution permission
- no automatic Champion promotion

No sidecar is called by `/scan` or during UI boot.

## Forward out-of-sample evidence
`sidecars/forward-evidence.js` freezes Decision Log rows into immutable signals with SHA-256 hashes.

Rules:

- entry evaluation starts after the signal session only;
- entry expiry remains 3 sessions;
- max hold remains 10 sessions;
- same-bar target/stop ambiguity remains `STOP_FIRST`;
- transaction cost remains 0.60%;
- unresolved signals remain OPEN/WAITING and are never converted into invented outcomes;
- the snapshot refuses in-place overwrite when generated through `scripts/sidecar-audit.mjs --write-forward`.

Commands:

```bash
npm run sidecar-audit -- --write-forward
npm run forward-evaluate -- evidence/forward/<snapshot>.json
```

Strict forward statistics should only count snapshots captured prospectively. Historical reconstruction must be labelled separately and must never be mixed into the strict forward cohort.

## Official-data verification
`sidecars/data-verification.js` compares a supplied official reference snapshot with observed market data and reports `VERIFIED`, `CONFLICT`, `SESSION_MISMATCH`, `MISSING_OFFICIAL`, or `UNVERIFIED_REFERENCE`.

This report is evidence-only. It does not modify Alpha inputs or RC2 recommendations.

Official input rows use this minimum shape:

```json
[
  {
    "ticker": "COMI",
    "date": "2026-08-19",
    "close": 123.45,
    "official": true,
    "source": "EGX"
  }
]
```

Run:

```bash
npm run sidecar-audit -- --official=/path/to/official.json
```

## History-depth audit
`sidecars/history-depth.js` reports coverage without pretending short history is multi-year evidence.

- `<120`: VERY_SHORT
- `120-249`: SHORT
- `250-499`: ONE_YEAR_PLUS
- `500-749`: MULTI_YEAR
- `>=750`: MULTI_YEAR_STRONG

Robust regime-study eligibility requires at least 500 sessions in this sidecar.

## Long-history validation
`sidecars/long-history-validation.js` runs the frozen `backtestHistory()` on an external directory of longer-history JSON files. It does not tune parameters and does not write back to production.

```bash
npm run long-history -- /path/to/history-directory
```

Each JSON may contain `sessions`, `rows`, or `bars`; the ticker can be supplied in the JSON or inferred from the filename.

## Regime analysis
`sidecars/regime-analysis.js` classifies BULL / BEAR / SIDEWAYS for evidence segmentation only.

`classifyRegimeAtDate()` cuts the benchmark series at the signal date before classification, preventing future benchmark leakage.

For fewer than 200 sessions, the classification is explicitly marked `PROVISIONAL_SHORT_HISTORY`; it is never presented as equivalent to a full 200-session regime classification.

## Red-team gate
Run:

```bash
npm test
npm run red-team
```

The red-team set checks byte-level runtime stability, policy equality, execution lock, sidecar isolation, forward no-lookahead, immutable snapshots, STOP_FIRST, official-data reporting-only behavior, honest history-depth labels, and regime no-lookahead.

## Accepted recorded baseline
The frozen contract records the accepted 2026-08-19 baseline for comparison only:

- scanned: 188
- technically eligible: 4
- publishable: 3
- COPR / FAIT / MPCO
- MILS held for price reconciliation
- historical simulator: 64 entered, T1 73.4%, stop 18.8%, avg net +1.23%, PF 2.33, Wilson lower 61.5%

These historical figures are evidence, not a promise of future performance.

## Production deployment policy
Because validation sidecars are intentionally offline and disconnected from the critical path, adding or changing sidecars does not require a production redeploy. A production redeploy is required only when the protected runtime changes, and such a change must first replace the frozen contract through an explicit acceptance process.
